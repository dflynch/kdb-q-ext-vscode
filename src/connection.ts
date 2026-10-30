import * as net from "node:net";
import * as tls from "node:tls";
import { getSystemErrorMap, getSystemErrorMessage } from "node:util";
import { encode } from "./codec/encode";
import { badmsg } from "./codec/errors";
import { wrapper } from "./protection";
import { defaults } from "./servers";
import type { Secure } from "./tls";

export type Server = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  // How long to wait for the server to connect and log in, in milliseconds,
  // or 0 to wait as long as it takes, as hopen does
  timeout?: number;
  // The largest result to take, in bytes, uncompressed
  limit?: number;
  // Whether to evaluate queries protected; off unless set, though the
  // servers setting turns it on by default
  protect?: boolean;
  // TLS, if it's set, as tcps:// in q
  tls?: Secure;
};

// What a query returns: the response as it arrived, a q IPC message, to be
// decoded where it's shown, not in the extension host, whose heap every
// extension in the window shares; whether it's protected evaluation's
// reply; and the roundtrip, in whole milliseconds
export type Result = {
  message: Uint8Array;
  wrapped: boolean;
  roundtrip: number;
};

// A system error's number, as Node has it on every system
function errno(name: string): number | undefined {
  for (const [number, [code]] of getSystemErrorMap()) {
    if (code === name) {
      return number;
    }
  }
  return undefined;
}

// q's error for a failing system call, as hop. OS reports: and the OS's
// message, capitalised as the OS's own messages that q quotes are
function oserror(
  word: string,
  errno: number | undefined,
  cause: unknown,
  message = "",
): Error {
  const reason = errno === undefined ? message : getSystemErrorMessage(errno);
  const text = reason.charAt(0).toUpperCase() + reason.slice(1);
  return new Error(`${word}. OS reports: ${text}`, { cause });
}

// A result over the size limit, in bytes as q sends it, said in megabytes
// as set. Refusing closes the connection, which stops the server sending
// the rest.
function tooBig(size: number, limit: number): Error {
  return new Error(
    `size limit: the result exceeds ${limit / 1e6} MB before deserialization`,
    {
      cause: `${size} bytes, over the limit of ${limit}`,
    },
  );
}

const what = ["async message", "sync message", "response"];

const lost = "connection closed unexpectedly";

// A connection to a q process, running one query at a time. Cancelling a
// query means closing the connection: the server can't be interrupted, and
// closing stops it sending the rest of a result. Anything the server sends
// besides the response to a query also closes it, so that nothing it sends,
// such as a tickerplant's updates after an accidental subscription, goes
// unnoticed; and nothing it sends is ever evaluated.
export class Connection {
  private pending?: {
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
    // When the query was sent, from performance.now()
    sent: number;
  };
  // Why the connection closed, once it has
  private reason?: Error;
  private ended: (reason: Error) => void = () => {};
  // Resolves with why the connection closed, once it has, however it did
  readonly closed = new Promise<Error>((resolve) => {
    this.ended = resolve;
  });
  // A message's header, then the message, as they arrive
  private header = Buffer.alloc(8);
  private headerLength = 0;
  private message?: Buffer;
  private received = 0;

  private constructor(
    private socket: net.Socket,
    private limit: number,
    private protect: boolean,
    rest: Buffer,
  ) {
    socket.on("data", (chunk) => this.receive(chunk));
    // However it closes, unless closed here, the connection closed
    // unexpectedly, with the OS's reason where there is one
    socket.on("error", (cause: NodeJS.ErrnoException) =>
      this.end(oserror(lost, cause.errno, cause, cause.message)),
    );
    socket.on("close", () => this.end(new Error(lost)));
    this.receive(rest);
  }

  // Connect and log in. The server answers the login with one byte, the
  // protocol version it agrees to, or closes the connection to refuse it.
  // Failures are q's errors for hopen. Aborting the signal closes the
  // socket, however far it's got.
  static open(server: Server, signal?: AbortSignal): Promise<Connection> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("cancelled"));
        return;
      }
      const socket = server.tls
        ? tls.connect({ host: server.host, port: server.port, ...server.tls })
        : net.connect(server.port, server.host);
      // Logging in waits for the TLS handshake, which checks the server's
      // certificate
      const connected = server.tls ? "secureConnect" : "connect";
      // Connecting, then with TLS shaking hands, then logging in. Once TCP
      // has connected, an error without a system call is TLS's.
      let phase: "connecting" | "handshake" | "login" = "connecting";
      const tcp = () => {
        phase = server.tls ? "handshake" : "login";
      };
      socket.setNoDelay(true);
      // A deadline for connecting and logging in together; the socket's own
      // timeout would restart with every write and read
      const timeout = server.timeout ?? 2000;
      const timer =
        timeout === 0
          ? undefined
          : setTimeout(() => fail(new Error("timeout")), timeout);
      const login = () => {
        phase = "login";
        // Version 3: compression, timestamps, timespans and GUIDs
        socket.write(
          `${server.user ?? ""}:${server.password ?? ""}\x03\x00`,
          "utf8",
        );
      };
      // q names the host when it can't be found, and says hop otherwise.
      // TLS fails as hop too, with what the TLS library reports.
      const error = (cause: Error) => {
        // Trying each of a name's addresses fails with all their errors
        const last = (
          cause instanceof AggregateError ? cause.errors.at(-1) : cause
        ) as NodeJS.ErrnoException;
        // A server that resets the handshake, as one without TLS does, is
        // q's protocol error
        if (phase === "handshake" && last.code === "ECONNRESET") {
          fail(oserror("hop", errno("EPROTO"), cause));
          return;
        }
        if (
          server.tls &&
          phase !== "connecting" &&
          last.syscall === undefined
        ) {
          // OpenSSL's reason, as q gives, where there is one, and without
          // the hint Node adds, as the system's CAs are trusted already
          const reason =
            (last as { reason?: string }).reason ??
            last.message.replace(/; if the root CA .*$/, "");
          fail(new Error(`hop. SSL reports: ${reason}`, { cause }));
          return;
        }
        const word = last.syscall === "getaddrinfo" ? server.host : "hop";
        fail(oserror(word, last.errno, cause, last.message));
      };
      const refused = () => fail(new Error("access"));
      const accepted = (chunk: Buffer) => {
        done();
        resolve(
          new Connection(
            socket,
            server.limit ?? defaults.limit,
            server.protect ?? false,
            chunk.subarray(1),
          ),
        );
      };
      // Only the listeners added here: the socket has Node's own too
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        socket.off("connect", tcp);
        socket.off(connected, login);
        socket.off("error", error);
        socket.off("close", refused);
        socket.off("data", accepted);
      };
      const fail = (reason: Error) => {
        done();
        socket.destroy();
        reject(reason);
      };
      const aborted = () => fail(new Error("cancelled"));
      signal?.addEventListener("abort", aborted, { once: true });
      socket.once("connect", tcp);
      socket.once(connected, login);
      socket.once("error", error);
      socket.once("close", refused);
      socket.once("data", accepted);
    });
  }

  query(text: string): Promise<Result> {
    if (this.reason) {
      return Promise.reject(this.reason);
    }
    if (this.pending) {
      return Promise.reject(new Error("query already running"));
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, sent: performance.now() };
      this.socket.write(this.protect ? encode(text, wrapper) : encode(text));
    });
  }

  // Close the connection, cancelling the query if one is running
  close(): void {
    this.end(new Error("query cancelled"));
  }

  private end(reason: Error): void {
    if (this.reason) {
      return;
    }
    this.reason = reason;
    this.ended(reason);
    this.socket.destroy();
    this.pending?.reject(reason);
    this.pending = undefined;
  }

  // Messages can arrive in any number of pieces, and a piece can hold the end
  // of one message and the start of the next
  private receive(chunk: Buffer): void {
    try {
      while (chunk.length > 0 && !this.reason) {
        if (!this.message) {
          const n = Math.min(8 - this.headerLength, chunk.length);
          chunk.copy(this.header, this.headerLength, 0, n);
          this.headerLength += n;
          chunk = chunk.subarray(n);
          if (this.headerLength < 8) {
            return;
          }
          // In the sender's byte order, so that a big-endian message gets as
          // far as the decoder's error for it. Past a header that's wrong,
          // there's no telling where the next message starts.
          const length = this.header[0]
            ? this.header.readUInt32LE(4)
            : this.header.readUInt32BE(4);
          if (this.header[0] > 1 || this.header[1] > 2 || length < 8) {
            throw badmsg("a message header that isn't q's");
          }
          if (this.header[1] !== 2 || !this.pending) {
            throw new Error(`unexpected ${what[this.header[1]]}`);
          }
          if (length > this.limit) {
            throw tooBig(length, this.limit);
          }
          // Outside Node's pool of small buffers, which other code shares,
          // so that the message has a buffer of its own to pass on
          this.message = Buffer.allocUnsafeSlow(length);
          this.header.copy(this.message);
          this.received = 8;
        }
        const n = Math.min(this.message.length - this.received, chunk.length);
        chunk.copy(this.message, this.received, 0, n);
        this.received += n;
        chunk = chunk.subarray(n);
        // A compressed message's length uncompressed comes after its header:
        // checked before the rest arrives, and bounding what decompressing
        // it allocates
        if (
          this.message[2] === 1 &&
          this.received >= 12 &&
          this.received - n < 12
        ) {
          const length = this.message[0]
            ? this.message.readUInt32LE(8)
            : this.message.readUInt32BE(8);
          if (length > this.limit) {
            throw tooBig(length, this.limit);
          }
        }
        if (this.received === this.message.length) {
          const message = this.message;
          this.message = undefined;
          this.headerLength = 0;
          this.respond(message);
        }
      }
    } catch (error) {
      // Thrown from a socket event, it would go uncaught
      this.end(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // The response to the query
  private respond(message: Buffer): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.pending = undefined;
    // As a Uint8Array: VS Code passes typed arrays to a webview by their
    // constructor's name, and sends a Buffer as JSON
    pending.resolve({
      message: new Uint8Array(
        message.buffer,
        message.byteOffset,
        message.length,
      ),
      wrapped: this.protect,
      roundtrip: Math.floor(performance.now() - pending.sent),
    });
  }
}
