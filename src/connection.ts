import * as net from "node:net";
import { decode } from "./codec/decode";
import { encode } from "./codec/encode";
import { badmsg } from "./codec/errors";
import type { Value } from "./codec/types";

export type Server = {
  host: string;
  port: number;
  user?: string;
  password?: string;
};

// An error the server signalled, with q's text as the message
export class QError extends Error {}

// A connection to a q process, running one query at a time. Cancelling a
// query means closing the connection: the server can't be interrupted, and
// closing stops it sending the rest of a result.
export class Connection {
  private pending?: {
    resolve: (value: Value) => void;
    reject: (error: Error) => void;
  };
  private ended = false;
  // A message's header, then the message, as they arrive
  private header = Buffer.alloc(8);
  private headerLength = 0;
  private message?: Buffer;
  private received = 0;

  private constructor(
    private socket: net.Socket,
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
  static open(server: Server): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(server.port, server.host);
      socket.setNoDelay(true);
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("connect", () => {
        // Version 3: compression, timestamps, timespans and GUIDs
        const login = `${server.user ?? ""}:${server.password ?? ""}\x03\x00`;
        socket.write(login, "utf8");
      });
      socket.once("error", (cause) =>
        fail(
          new Error(`couldn't connect to ${server.host}:${server.port}`, {
            cause,
          }),
        ),
      );
      // q's word for a refused login
      socket.once("close", () => fail(new Error("access")));
      socket.once("data", (chunk) => {
        socket.removeAllListeners();
        resolve(new Connection(socket, chunk.subarray(1)));
      });
    });
  }

  query(text: string): Promise<Value> {
    if (this.ended) {
      return Promise.reject(new Error("the connection is closed"));
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
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.socket.destroy();
    this.pending?.reject(reason);
    this.pending = undefined;
  }

  // Messages can arrive in any number of pieces, and a piece can hold the end
  // of one message and the start of the next
  private receive(chunk: Buffer): void {
    try {
      while (chunk.length > 0 && !this.ended) {
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
          if (this.header[0] > 1 || length < 8) {
            throw badmsg("a message header that isn't q's");
          }
          this.message = Buffer.allocUnsafe(length);
          this.header.copy(this.message);
          this.received = 8;
        }
        const n = Math.min(this.message.length - this.received, chunk.length);
        chunk.copy(this.message, this.received, 0, n);
        this.received += n;
        chunk = chunk.subarray(n);
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

  // Only a response answers the query; anything else the server sends, such
  // as a message from a timer it runs, is dropped
  private respond(message: Buffer): void {
    const pending = this.pending;
    if (message[1] !== 2 || !pending) {
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
