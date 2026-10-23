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
  // Whether to evaluate queries protected; off unless set, though the
  // servers setting turns it on by default
  protect?: boolean;
};

// How long a query took, in whole milliseconds, as \t gives
export type Timing = {
  // From sending the query to the last of its result arriving
  roundtrip: number;
  // The server's time running it, with protected evaluation: not
  // serialising the result, nor formatting a backtrace
  execution?: number;
};

// What a query returns
export type Result = { value: Value; timing: Timing };

// An error the server signalled, with q's text as the message, how long the
// query took, and where protected evaluation caught it, the stack as q
// shows it
export class QError extends Error {
  readonly backtrace?: string;
  constructor(
    message: string,
    readonly timing: Timing,
    backtrace?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    if (backtrace !== undefined) {
      this.backtrace = backtrace;
    }
  }
}

// Protected evaluation: q's .z.pg applies this to the query, which it runs
// under .Q.trp. It returns ``result`execution!(::;result;ms), or
// ``error`backtrace`execution!(::;error;backtrace;ms): named so that more
// can be added, and the null key's :: keeps the values a general list, as a
// namespace's does.
// - The time is from .z.p, as .z.n goes back at midnight, taken as an error
//   is caught, before its backtrace is formatted
// - The backtrace keeps the frames inside run's, which are the query's,
//   numbered from the query's as 0. Those outside, the wrapper's and a
//   customised .z.pg's, go. The frames' layout isn't documented, so if
//   picking them out fails, the backtrace is shown whole rather than the
//   error lost
// - Each function is given what it uses, as q's lambdas see only their own
//   locals and globals; and the query, evaluated by value, sees only
//   globals, so the wrapper's locals can't clash with its names
// - No local is named for a q keyword, such as trim, which can't be assigned
export const wrapper = [
  "{[query]",
  "  run:{[start;query]",
  "    result:value query;",
  "    (``result`execution)!(::;result;(`long$.z.p-start)div 1000000)};",
  "  frames:{[run;stack]",
  "    stack:(last where run~/:stack[;0;0])#stack;",
  "    {@[x;3;-;y]}[;last stack[;3]] each stack};",
  "  caught:{[run;frames;start;error;stack]",
  "    execution:(`long$.z.p-start)div 1000000;",
  "    backtrace:.Q.sbt @[frames run;stack;stack];",
  "    (``error`backtrace`execution)!(::;error;backtrace;execution)};",
  "  start:.z.p;",
  "  .Q.trp[run start;query;caught[run;frames;start]]}",
].join("\n");

// What a failure with protected evaluation on says, as a server whose .z.pg
// is customised, or takes only strings, can't evaluate it
const unprotected =
  "if the server's .z.pg is customised, turn off protect for it in the servers setting";

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// Protected evaluation's dictionary by name, or undefined if it isn't one
function fields(value: Value): Map<string, Value> | undefined {
  if (value.type !== 99) {
    return undefined;
  }
  const { keys, values } = value;
  if (keys.type !== 11 || values.type !== 0 || !("items" in values)) {
    return undefined;
  }
  const { bytes, offsets } = keys.data;
  const names = Array.from(offsets.subarray(1), (end, i) =>
    utf8.decode(bytes.subarray(offsets[i], end)),
  );
  const [head] = values.items;
  if (names[0] !== "" || head?.type !== 101 || head.code !== 0) {
    return undefined;
  }
  return new Map(names.map((name, i) => [name, values.items[i]]));
}

// The result inside protected evaluation's dictionary, or the error it
// caught. Names it doesn't know are left for later.
function unwrap(value: Value, roundtrip: number): Result {
  const named = fields(value);
  const result = named?.get("result");
  const error = named?.get("error");
  const backtrace = named?.get("backtrace");
  const execution = named?.get("execution");
  if (execution?.type === -7) {
    const timing = { roundtrip, execution: Number(execution.value) };
    if (result) {
      return { value: result, timing };
    }
    if (error?.type === 10 && backtrace?.type === 10) {
      throw new QError(
        utf8.decode(error.data),
        timing,
        utf8.decode(backtrace.data),
      );
    }
  }
  throw new Error("the server didn't evaluate the query protected", {
    cause: unprotected,
  });
}

// A result over the limit. The extension host's heap is capped, and going
// over it kills the host, so results are refused well before: a general
// list decodes to up to about 60 times its size. Refusing closes the
// connection, which stops the server sending the rest.
function tooBig(size: number, limit: number): Error {
  return new Error("the result is too big", {
    cause: `${size} bytes, over the limit of ${limit}`,
  });
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
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
    // When the query was sent, from performance.now()
    sent: number;
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
    private protect: boolean,
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
          new Connection(
            socket,
            server.limit ?? 10e6,
            server.protect ?? false,
            chunk.subarray(1),
          ),
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

  query(text: string): Promise<Result> {
    if (this.reason) {
      return Promise.reject(
        new Error("the connection is closed", { cause: this.reason }),
      );
    }
    if (this.pending) {
      return Promise.reject(new Error("a query is already running"));
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, sent: performance.now() };
      this.socket.write(this.protect ? encode(text, wrapper) : encode(text));
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
            throw tooBig(length, this.limit);
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
    const roundtrip = Math.floor(performance.now() - pending.sent);
    let value: Value;
    try {
      value = decode(message);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (value.type === -128) {
      // With protected evaluation on, a signalled error means the query
      // wasn't run under it
      pending.reject(
        new QError(
          value.message,
          { roundtrip },
          undefined,
          this.protect ? { cause: unprotected } : undefined,
        ),
      );
      return;
    }
    try {
      pending.resolve(
        this.protect
          ? unwrap(value, roundtrip)
          : { value, timing: { roundtrip } },
      );
    } catch (error) {
      pending.reject(error as Error);
    }
  }
}
