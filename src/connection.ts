import * as net from "node:net";
import { getSystemErrorMessage } from "node:util";
import { decode } from "./codec/decode";
import { encode } from "./codec/encode";
import { badmsg } from "./codec/errors";
import type { Value } from "./codec/types";

export type Server = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  // How long to wait for the server to connect and log in, in milliseconds
  timeout?: number;
  // The largest result to take, in bytes, uncompressed
  limit?: number;
};

// An error the server signalled, with q's text as the message
export class QError extends Error {}

// A result over the limit. The extension host's heap is capped, and going
// over it kills the host, so results are refused well before: a general
// list decodes to up to about 60 times its size. Refusing closes the
// connection, which stops the server sending the rest.
export class OverLimit extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super("the result is too big");
  }
}

const what = ["async message", "sync call", "response"];

// A connection to a q process, running one query at a time. Cancelling a
// query means closing the connection: the server can't be interrupted, and
// closing stops it sending the rest of a result. Anything the server sends
// besides the response to a query also closes it, so that nothing it sends,
// such as a tickerplant's updates after an accidental subscription, goes
// unnoticed; and nothing it sends is ever evaluated.
export class Connection {
  private pending?: {
    resolve: (value: Value) => void;
    reject: (error: Error) => void;
  };
  // Why the connection closed, once it has
  private reason?: Error;
  // A message's header, then the message, as they arrive
  private header = Buffer.alloc(8);
  private headerLength = 0;
  private message?: Buffer;
  private received = 0;

  private constructor(
    private socket: net.Socket,
    private limit: number,
    rest: Buffer,
  ) {
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (cause) =>
      this.end(new Error("the connection failed", { cause })),
    );
    socket.on("close", () => this.end(new Error("the connection closed")));
    this.receive(rest);
  }

  // Connect and log in. The server answers the login with one byte, the
  // protocol version it agrees to, or closes the connection to refuse it.
  // Failures are q's errors for hopen.
  static open(server: Server): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(server.port, server.host);
      socket.setNoDelay(true);
      // A deadline for connecting and logging in together; the socket's own
      // timeout would restart with every write and read
      const timer = setTimeout(
        () => fail(new Error("timeout")),
        server.timeout ?? 2000,
      );
      const login = () => {
        // Version 3: compression, timestamps, timespans and GUIDs
        socket.write(
          `${server.user ?? ""}:${server.password ?? ""}\x03\x00`,
          "utf8",
        );
      };
      // q names the host when it can't be found, and says hop otherwise
      const error = (cause: NodeJS.ErrnoException) => {
        const word = cause.syscall === "getaddrinfo" ? server.host : "hop";
        const reason =
          cause.errno === undefined
            ? cause.message
            : getSystemErrorMessage(cause.errno);
        // Capitalised, as the OS's own messages that q quotes are
        const os = reason.charAt(0).toUpperCase() + reason.slice(1);
        fail(new Error(`${word}. OS reports: ${os}`, { cause }));
      };
      const refused = () => fail(new Error("access"));
      const accepted = (chunk: Buffer) => {
        done();
        resolve(
          new Connection(socket, server.limit ?? 10e6, chunk.subarray(1)),
        );
      };
      // Only the listeners added here: the socket has Node's own too
      const done = () => {
        clearTimeout(timer);
        socket.off("connect", login);
        socket.off("error", error);
        socket.off("close", refused);
        socket.off("data", accepted);
      };
      const fail = (reason: Error) => {
        done();
        socket.destroy();
        reject(reason);
      };
      socket.once("connect", login);
      socket.once("error", error);
      socket.once("close", refused);
      socket.once("data", accepted);
    });
  }

  query(text: string): Promise<Value> {
    if (this.reason) {
      return Promise.reject(
        new Error("the connection is closed", { cause: this.reason }),
      );
    }
    if (this.pending) {
      return Promise.reject(new Error("a query is already running"));
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.socket.write(encode(text));
    });
  }

  // Close the connection, cancelling the query if one is running
  close(): void {
    this.end(new Error("the query was cancelled"));
  }

  private end(reason: Error): void {
    if (this.reason) {
      return;
    }
    this.reason = reason;
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
            throw new Error(
              `unexpected ${what[this.header[1]]} from the server`,
            );
          }
          if (length > this.limit) {
            throw new OverLimit(length, this.limit);
          }
          this.message = Buffer.allocUnsafe(length);
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
            throw new OverLimit(length, this.limit);
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
    let value: Value;
    try {
      value = decode(message);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (value.type === -128) {
      pending.reject(new QError(value.message));
    } else {
      pending.resolve(value);
    }
  }
}
