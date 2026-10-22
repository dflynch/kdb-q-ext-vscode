import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { encode } from "../codec/encode";
import { Connection, QError } from "../connection";

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
// answer, which writes back whatever the test needs
type Fake = {
  port: number;
  login: Promise<Buffer>;
  messages: Buffer[];
  closed: Promise<void>;
  stop: () => void;
};

async function serve(
  answer: (socket: net.Socket, message: Buffer) => void,
  accept = true,
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
    let login = true;
    socket.on("close", closed);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (login) {
        const end = buffered.indexOf(0);
        if (end < 0) {
          return;
        }
        loggedIn(buffered.subarray(0, end + 1));
        buffered = buffered.subarray(end + 1);
        login = false;
        if (!accept) {
          socket.destroy();
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
    accept = true,
  ): Promise<Fake> {
    const f = await serve(answer, accept);
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
    const server = await fake(() => {}, false);
    await assert.rejects(open(server), { message: "access" });
  });

  test("a server that isn't there", async () => {
    const server = await fake();
    server.stop();
    await assert.rejects(open(server), /couldn't connect to 127.0.0.1/);
  });

  test("sends the query and resolves with the result", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await open(server);
    const value = await connection.query("42");
    assert.strictEqual(value.type, -7);
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
    assert.strictEqual((await connection.query("x")).type, 11);
    connection.close();
  });

  test("a compressed result", async () => {
    const server = await fake((socket) =>
      socket.write(response("large.longs", true)),
    );
    const connection = await open(server);
    assert.strictEqual((await connection.query("x")).type, 7);
    connection.close();
  });

  test("drops messages that aren't responses", async () => {
    const server = await fake((socket) => {
      const async = response("atom.symbol");
      async[1] = 0;
      socket.write(Buffer.concat([async, response("atom.long")]));
    });
    const connection = await open(server);
    assert.strictEqual((await connection.query("x")).type, -7);
    connection.close();
  });

  test("a q error rejects with q's text", async () => {
    const server = await fake((socket) => socket.write(qError("type")));
    const connection = await open(server);
    await assert.rejects(
      connection.query("1+`a"),
      (error) => error instanceof QError && error.message === "type",
    );
    connection.close();
  });

  test("a result it can't decode rejects, leaving the connection open", async () => {
    let first = true;
    const server = await fake((socket) => {
      // A type that doesn't exist
      socket.write(
        first ? Buffer.of(1, 2, 0, 0, 9, 0, 0, 0, 20) : response("atom.long"),
      );
      first = false;
    });
    const connection = await open(server);
    await assert.rejects(connection.query("x"), { message: "badmsg" });
    assert.strictEqual((await connection.query("x")).type, -7);
    connection.close();
  });

  test("a header that isn't q's closes the connection", async () => {
    const server = await fake((socket) =>
      socket.write(Buffer.of(7, 2, 0, 0, 9, 0, 0, 0, 0)),
    );
    const connection = await open(server);
    await assert.rejects(connection.query("x"), { message: "badmsg" });
    await assert.rejects(connection.query("x"), /the connection is closed/);
  });

  test("one query at a time", async () => {
    const server = await fake();
    const connection = await open(server);
    const first = connection.query("x");
    await assert.rejects(connection.query("y"), /a query is already running/);
    connection.close();
    await assert.rejects(first);
  });

  test("closing cancels the query and closes the socket", async () => {
    const server = await fake();
    const connection = await open(server);
    const query = connection.query("x");
    connection.close();
    await assert.rejects(query, /the query was cancelled/);
    await server.closed;
  });

  test("the server closing mid-query", async () => {
    const server = await fake((socket) => socket.destroy());
    const connection = await open(server);
    await assert.rejects(connection.query("x"), /the connection closed/);
    await assert.rejects(connection.query("x"), /the connection is closed/);
  });
});
