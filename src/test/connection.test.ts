import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { encode } from "../codec/encode";
import { Connection } from "../connection";
import { wrapper } from "../protection";

const fixtures: { name: string; bytes: string; compressed?: string }[] =
  JSON.parse(
    readFileSync(
      path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
      "utf8",
    ),
  ).values;

// A corpus value as a server would send it in reply to a query
function response(name: string, compressed = false): Buffer {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture, `no fixture .corpus.${name}`);
  const hex = compressed ? fixture.compressed : fixture.bytes;
  assert.ok(hex, `no compressed fixture .corpus.${name}`);
  const message = Buffer.from(hex, "hex");
  message[1] = 2;
  return message;
}

function qError(text: string): Buffer {
  const message = Buffer.concat([
    Buffer.of(1, 2, 0, 0, 0, 0, 0, 0, 0x80),
    Buffer.from(`${text}\0`),
  ]);
  message.writeUInt32LE(message.length, 4);
  return message;
}

// A stand-in for q: it takes the login, then hands each message it's sent to
// answer, which writes back whatever the test needs. It accepts the login,
// refuses it by closing the connection, or never answers it.
type Login = "accept" | "refuse" | "ignore";
type Fake = {
  port: number;
  login: Promise<Buffer>;
  messages: Buffer[];
  closed: Promise<void>;
  stop: () => void;
};

async function serve(
  answer: (socket: net.Socket, message: Buffer) => void,
  login: Login,
): Promise<Fake> {
  let loggedIn: (login: Buffer) => void = () => {};
  let closed: () => void = () => {};
  const fake: Partial<Fake> = {
    login: new Promise((resolve) => {
      loggedIn = resolve;
    }),
    messages: [],
    closed: new Promise((resolve) => {
      closed = resolve;
    }),
  };
  const server = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let loggingIn = true;
    socket.on("close", closed);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (loggingIn) {
        const end = buffered.indexOf(0);
        if (end < 0) {
          return;
        }
        loggedIn(buffered.subarray(0, end + 1));
        buffered = buffered.subarray(end + 1);
        loggingIn = false;
        if (login === "refuse") {
          socket.destroy();
        }
        if (login !== "accept") {
          return;
        }
        socket.write(Buffer.of(3));
      }
      while (
        buffered.length >= 8 &&
        buffered.length >= buffered.readUInt32LE(4)
      ) {
        const length = buffered.readUInt32LE(4);
        const message = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        fake.messages?.push(message);
        answer(socket, message);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => sockets.add(socket));
  fake.port = (server.address() as net.AddressInfo).port;
  fake.stop = () => {
    server.close();
    for (const socket of sockets) {
      socket.destroy();
    }
  };
  return fake as Fake;
}

function open(fake: Fake): Promise<Connection> {
  return Connection.open({ host: "127.0.0.1", port: fake.port });
}

suite("connection", () => {
  const fakes: Fake[] = [];
  async function fake(
    answer: (socket: net.Socket, message: Buffer) => void = () => {},
    login: Login = "accept",
  ): Promise<Fake> {
    const f = await serve(answer, login);
    fakes.push(f);
    return f;
  }
  teardown(() => {
    for (const f of fakes.splice(0)) {
      f.stop();
    }
  });

  test("logs in with the user, password and protocol version", async () => {
    const server = await fake();
    const connection = await Connection.open({
      host: "127.0.0.1",
      port: server.port,
      user: "alice",
      password: "pw",
    });
    assert.strictEqual((await server.login).toString(), "alice:pw\x03\0");
    connection.close();
  });

  test("a refused login is q's access error", async () => {
    const server = await fake(() => {}, "refuse");
    await assert.rejects(open(server), { message: "access" });
  });

  test("a server that isn't there is q's hop error", async () => {
    const server = await fake();
    server.stop();
    await assert.rejects(open(server), {
      message: "hop. OS reports: Connection refused",
    });
  });

  test("a host that can't be found is named, as q does", async () => {
    await assert.rejects(
      Connection.open({ host: "nosuchhost.invalid", port: 5000 }),
      /^Error: nosuchhost\.invalid\. OS reports: /,
    );
  });

  test("a login that isn't answered times out", async () => {
    const server = await fake(() => {}, "ignore");
    await assert.rejects(
      Connection.open({ host: "127.0.0.1", port: server.port, timeout: 50 }),
      { message: "timeout" },
    );
  });

  test("a timeout of 0 waits as long as the login takes", async function () {
    // Past the default's 2 seconds
    this.timeout(5000);
    const server = net.createServer((socket) => {
      socket.once("data", () =>
        setTimeout(() => socket.write(Buffer.of(3)), 2100),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const connection = await Connection.open({
        host: "127.0.0.1",
        port: (server.address() as net.AddressInfo).port,
        timeout: 0,
      });
      connection.close();
    } finally {
      server.close();
    }
  });

  test("a connection outlasts the login's timeout", async () => {
    const server = await fake((socket) => {
      setTimeout(() => socket.write(response("atom.long")), 100);
    });
    const connection = await Connection.open({
      host: "127.0.0.1",
      port: server.port,
      timeout: 50,
    });
    assert.strictEqual(decode((await connection.query("x")).message).type, -7);
    connection.close();
  });

  test("sends the query and resolves with the result", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await open(server);
    const { message, wrapped, roundtrip } = await connection.query("42");
    assert.strictEqual(decode(message).type, -7);
    assert.strictEqual(wrapped, false);
    assert.ok(roundtrip >= 0);
    assert.deepStrictEqual(server.messages, [Buffer.from(encode("42"))]);
    connection.close();
  });

  test("a result that arrives a byte at a time", async () => {
    const server = await fake((socket) => {
      for (const byte of response("vector.symbol")) {
        socket.write(Buffer.of(byte));
      }
    });
    const connection = await open(server);
    assert.strictEqual(decode((await connection.query("x")).message).type, 11);
    connection.close();
  });

  test("a compressed result", async () => {
    const server = await fake((socket) =>
      socket.write(response("large.longs", true)),
    );
    const connection = await open(server);
    assert.strictEqual(decode((await connection.query("x")).message).type, 7);
    connection.close();
  });

  test("an async message closes the connection", async () => {
    const server = await fake((socket) => {
      const async = response("atom.symbol");
      async[1] = 0;
      socket.write(Buffer.concat([async, response("atom.long")]));
    });
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /^Error: unexpected async message$/,
    );
    await server.closed;
  });

  test("a sync message closes the connection", async () => {
    const server = await fake((socket) => {
      const sync = response("atom.symbol");
      sync[1] = 1;
      socket.write(sync);
    });
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /^Error: unexpected sync message$/,
    );
    await server.closed;
  });

  test("a message between queries closes the connection, with the reason kept for the next query", async () => {
    // The response, then a tickerplant's update
    const server = await fake((socket) => {
      const update = response("atom.symbol");
      update[1] = 0;
      socket.write(response("atom.long"));
      setTimeout(() => socket.write(update), 10);
    });
    const connection = await open(server);
    assert.strictEqual(decode((await connection.query("x")).message).type, -7);
    await server.closed;
    await assert.rejects(
      connection.query("x"),
      /^Error: unexpected async message$/,
    );
  });

  test("a q error is passed on as it arrived, for the Result view to read", async () => {
    const message = qError("type");
    const server = await fake((socket) => socket.write(message));
    const connection = await open(server);
    assert.deepStrictEqual(
      (await connection.query("1+`a")).message,
      new Uint8Array(message),
    );
    connection.close();
  });

  test("a result is passed on undecoded, even one that can't be decoded", async () => {
    // A type that doesn't exist
    const message = Buffer.of(1, 2, 0, 0, 9, 0, 0, 0, 20);
    const server = await fake((socket) => socket.write(message));
    const connection = await open(server);
    assert.deepStrictEqual(
      (await connection.query("x")).message,
      new Uint8Array(message),
    );
    connection.close();
  });

  test("a message is a Uint8Array with a buffer of its own, as VS Code passes to a webview", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await open(server);
    const { message } = await connection.query("x");
    assert.strictEqual(message.constructor, Uint8Array);
    assert.strictEqual(message.byteOffset, 0);
    assert.strictEqual(message.buffer.byteLength, message.length);
    connection.close();
  });

  test("a header that isn't q's closes the connection", async () => {
    const server = await fake((socket) =>
      socket.write(Buffer.of(7, 2, 0, 0, 9, 0, 0, 0, 0)),
    );
    const connection = await open(server);
    await assert.rejects(connection.query("x"), { message: "badmsg" });
    await assert.rejects(connection.query("x"), { message: "badmsg" });
  });

  test("protected, sends the wrapper and the query, and passes on the reply as it arrived", async () => {
    const message = response("atom.long");
    const server = await fake((socket) => socket.write(message));
    const connection = await Connection.open({
      host: "127.0.0.1",
      port: server.port,
      protect: true,
    });
    const result = await connection.query("42");
    assert.deepStrictEqual(result.message, new Uint8Array(message));
    assert.strictEqual(result.wrapped, true);
    assert.deepStrictEqual(server.messages, [
      Buffer.from(encode("42", wrapper)),
    ]);
    connection.close();
  });

  function limited(server: Fake, limit: number): Promise<Connection> {
    return Connection.open({ host: "127.0.0.1", port: server.port, limit });
  }

  test("a result over the limit closes the connection", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await limited(server, 16);
    await assert.rejects(
      connection.query("x"),
      (error) =>
        error instanceof Error &&
        error.message === "result too big" &&
        error.cause === "17 bytes, over the limit of 16",
    );
    await server.closed;
  });

  test("a result exactly at the limit is accepted", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await limited(server, 17);
    assert.strictEqual(decode((await connection.query("x")).message).type, -7);
    connection.close();
  });

  test("a compressed result is refused by its size uncompressed, before the rest arrives", async () => {
    const message = response("large.longs", true);
    const uncompressed = message.readUInt32LE(8);
    // Only the header and the length uncompressed are ever sent
    const server = await fake((socket) =>
      socket.write(message.subarray(0, 12)),
    );
    const connection = await limited(server, uncompressed - 1);
    await assert.rejects(
      connection.query("x"),
      (error) =>
        error instanceof Error &&
        error.message === "result too big" &&
        error.cause ===
          `${uncompressed} bytes, over the limit of ${uncompressed - 1}`,
    );
    await server.closed;
  });

  test("a compressed result exactly at the limit uncompressed is accepted", async () => {
    const message = response("large.longs", true);
    const server = await fake((socket) => socket.write(message));
    const connection = await limited(server, message.readUInt32LE(8));
    assert.strictEqual(decode((await connection.query("x")).message).type, 7);
    connection.close();
  });

  test("one query at a time", async () => {
    const server = await fake();
    const connection = await open(server);
    const first = connection.query("x");
    await assert.rejects(connection.query("y"), /query already running/);
    connection.close();
    await assert.rejects(first);
  });

  test("closed resolves with why, however it closed", async () => {
    const server = await fake();
    const connection = await open(server);
    connection.close();
    assert.strictEqual((await connection.closed).message, "query cancelled");
    const other = await open(server);
    server.stop();
    assert.strictEqual(
      (await other.closed).message,
      "connection closed unexpectedly",
    );
  });

  test("closing cancels the query and closes the socket", async () => {
    const server = await fake();
    const connection = await open(server);
    const query = connection.query("x");
    connection.close();
    await assert.rejects(query, /query cancelled/);
    await server.closed;
  });

  test("the server closing mid-query", async () => {
    const server = await fake((socket) => socket.destroy());
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /connection closed unexpectedly/,
    );
    await assert.rejects(
      connection.query("x"),
      /connection closed unexpectedly/,
    );
  });

  test("the server resetting mid-query, with the OS's reason", async () => {
    const server = await fake((socket) => socket.resetAndDestroy());
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /^Error: connection closed unexpectedly\. OS reports: Connection reset by peer$/,
    );
  });
});
