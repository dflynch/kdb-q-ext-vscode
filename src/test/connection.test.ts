import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { encode } from "../codec/encode";
import { Connection, QError, wrapper } from "../connection";

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

  test("a connection outlasts the login's timeout", async () => {
    const server = await fake((socket) => {
      setTimeout(() => socket.write(response("atom.long")), 100);
    });
    const connection = await Connection.open({
      host: "127.0.0.1",
      port: server.port,
      timeout: 50,
    });
    assert.strictEqual((await connection.query("x")).type, -7);
    connection.close();
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

  test("an async message closes the connection", async () => {
    const server = await fake((socket) => {
      const async = response("atom.symbol");
      async[1] = 0;
      socket.write(Buffer.concat([async, response("atom.long")]));
    });
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /^Error: unexpected async message from the server$/,
    );
    await server.closed;
  });

  test("a sync call closes the connection", async () => {
    const server = await fake((socket) => {
      const sync = response("atom.symbol");
      sync[1] = 1;
      socket.write(sync);
    });
    const connection = await open(server);
    await assert.rejects(
      connection.query("x"),
      /^Error: unexpected sync call from the server$/,
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
    assert.strictEqual((await connection.query("x")).type, -7);
    await server.closed;
    await assert.rejects(
      connection.query("x"),
      (error) =>
        error instanceof Error &&
        error.message === "the connection is closed" &&
        /unexpected async message from the server/.test(String(error.cause)),
    );
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

  // Each reply is q's -8! of what protected evaluation returns, as a
  // response
  function reply(hex: string): Buffer {
    const message = Buffer.from(hex, "hex");
    message[1] = 2;
    return message;
  }
  function protect(server: Fake): Promise<Connection> {
    return Connection.open({
      host: "127.0.0.1",
      port: server.port,
      protect: true,
    });
  }

  test("protected, sends the wrapper and the query, and resolves with the result", async () => {
    // (::;42)
    const server = await fake((socket) =>
      socket.write(reply("01000000190000000000020000006500f92a00000000000000")),
    );
    const connection = await protect(server);
    assert.deepStrictEqual(await connection.query("42"), {
      type: -7,
      value: 42n,
    });
    assert.deepStrictEqual(server.messages, [
      Buffer.from(encode("42", wrapper)),
    ]);
    connection.close();
  });

  test("protected, an error caught rejects with q's text and the backtrace", async () => {
    // (::;"type";"  [0]  1+`a\n        ^\n")
    const server = await fake((socket) =>
      socket.write(
        reply(
          "010000003600000000000300000065000a0004000000747970650a001600000020205b305d2020312b60610a20202020202020205e0a",
        ),
      ),
    );
    const connection = await protect(server);
    await assert.rejects(
      connection.query("1+`a"),
      (error) =>
        error instanceof QError &&
        error.message === "type" &&
        error.backtrace === "  [0]  1+`a\n        ^\n",
    );
    connection.close();
  });

  test("protected, an error signalled says how to turn it off", async () => {
    const server = await fake((socket) => socket.write(qError("type")));
    const connection = await protect(server);
    await assert.rejects(
      connection.query("1+`a"),
      (error) =>
        error instanceof QError &&
        error.message === "type" &&
        error.backtrace === undefined &&
        /turn off protect/.test(String(error.cause)),
    );
    connection.close();
  });

  test("protected, a result not wrapped says how to turn it off, leaving the connection open", async () => {
    const answers = [
      response("atom.long"),
      // (::;`type;"bt"), where the error should be a string
      reply("010000001e0000000000030000006500f574797065000a00020000006274"),
      // (::;42)
      reply("01000000190000000000020000006500f92a00000000000000"),
    ];
    const server = await fake((socket) => socket.write(answers.shift() ?? ""));
    const connection = await protect(server);
    for (const _ of [1, 2]) {
      await assert.rejects(
        connection.query("x"),
        (error) =>
          error instanceof Error &&
          error.message === "the server didn't evaluate the query protected" &&
          /turn off protect/.test(String(error.cause)),
      );
    }
    assert.strictEqual((await connection.query("x")).type, -7);
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
        error.message === "the result is too big" &&
        error.cause === "17 bytes, over the limit of 16",
    );
    await server.closed;
  });

  test("a result exactly at the limit is accepted", async () => {
    const server = await fake((socket) => socket.write(response("atom.long")));
    const connection = await limited(server, 17);
    assert.strictEqual((await connection.query("x")).type, -7);
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
        error.message === "the result is too big" &&
        error.cause ===
          `${uncompressed} bytes, over the limit of ${uncompressed - 1}`,
    );
    await server.closed;
  });

  test("a compressed result exactly at the limit uncompressed is accepted", async () => {
    const message = response("large.longs", true);
    const server = await fake((socket) => socket.write(message));
    const connection = await limited(server, message.readUInt32LE(8));
    assert.strictEqual((await connection.query("x")).type, 7);
    connection.close();
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
