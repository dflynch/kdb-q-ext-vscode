import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import { Connection } from "../connection";
import { passphraseKey, resolve, secure } from "../tls";

const dir = path.join(__dirname, "../../test/fixtures/tls");
const file = (name: string) => path.join(dir, name);
const read = (name: string) => readFileSync(file(name));

// 2 as a server sends it in reply to a query
const two = Buffer.from("0102000011000000f90200000000000000", "hex");

// A stand-in for q over TLS, with the certificate it's named for: it takes
// the login and answers every query with 2. With clients, it requires a
// certificate from the test CA.
async function serve(
  name: string,
  clients = false,
): Promise<{ port: number; stop: () => void }> {
  const server = tls.createServer(
    {
      cert: read(`${name}.pem`),
      key: read(`${name}.key`),
      ...(clients ? { ca: read("ca.pem"), requestCert: true } : {}),
    },
    (socket) => {
      let loggedIn = false;
      socket.on("data", (chunk) => {
        if (!loggedIn) {
          loggedIn = chunk.includes(0);
          if (loggedIn) {
            socket.write(Buffer.of(3));
          }
          return;
        }
        socket.write(two);
      });
      socket.on("error", () => {});
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const sockets = new Set<tls.TLSSocket>();
  server.on("secureConnection", (socket) => sockets.add(socket));
  return {
    port: (server.address() as { port: number }).port,
    stop: () => {
      server.close();
      for (const socket of sockets) {
        socket.destroy();
      }
    },
  };
}

suite("tls", () => {
  const stops: (() => void)[] = [];
  teardown(() => {
    for (const stop of stops.splice(0)) {
      stop();
    }
  });
  async function fake(name: string, clients = false) {
    const f = await serve(name, clients);
    stops.push(f.stop);
    return f.port;
  }
  async function query(
    port: number,
    settings: Parameters<typeof secure>[0],
    options: { host?: string; passphrase?: string } = {},
  ) {
    const connection = await Connection.open({
      host: options.host ?? "localhost",
      port,
      timeout: 1000,
      tls: secure(settings, readFileSync, options.passphrase),
    });
    try {
      return (await connection.query("1+1")).value;
    } finally {
      connection.close();
    }
  }
  const ca = file("ca.pem");

  test("connects with a CA given, by name or address", async () => {
    const port = await fake("server");
    assert.deepStrictEqual(await query(port, { ca }), { type: -7, value: 2n });
    assert.deepStrictEqual(await query(port, { ca }, { host: "127.0.0.1" }), {
      type: -7,
      value: 2n,
    });
  });

  test("a server whose CA isn't trusted is q's hop, with the reason", async () => {
    await assert.rejects(query(await fake("server"), {}), {
      message: "hop. SSL reports: unable to verify the first certificate",
    });
    // Self-signed, or self signed in VS Code's TLS library
    await assert.rejects(
      query(await fake("self"), { ca }),
      /^Error: hop\. SSL reports: self.signed certificate$/,
    );
  });

  test("a certificate for another host is refused", async () => {
    await assert.rejects(
      query(await fake("elsewhere"), { ca }),
      /^Error: hop\. SSL reports: .*elsewhere\.invalid/,
    );
  });

  test("a client certificate, as a certificate and key or PKCS#12", async () => {
    const port = await fake("server", true);
    const cert = file("client.pem");
    await assert.rejects(query(port, { ca }), /^Error: hop\. SSL reports: /);
    assert.strictEqual(
      (await query(port, { ca, cert, key: file("client.key") })).type,
      -7,
    );
    const key = file("client.encrypted.key");
    assert.strictEqual(
      (await query(port, { ca, cert, key }, { passphrase: "secret" })).type,
      -7,
    );
    const pfx = file("client.p12");
    assert.strictEqual(
      (await query(port, { ca, pfx }, { passphrase: "secret" })).type,
      -7,
    );
  });

  test("a client certificate that can't be decrypted says so", async () => {
    const port = await fake("server", true);
    const cert = file("client.pem");
    const key = file("client.encrypted.key");
    for (const passphrase of [undefined, "nope"]) {
      await assert.rejects(query(port, { ca, cert, key }, { passphrase }), {
        message: "the client certificate can't be used",
      });
    }
    await assert.rejects(
      query(port, { ca, pfx: file("client.p12") }, { passphrase: "nope" }),
      { message: "the client certificate can't be used" },
    );
  });

  test("a file that can't be read says so", () => {
    assert.throws(() => secure({ ca: file("nope.pem") }, readFileSync), {
      message: "a tls file can't be read",
    });
  });

  test("a CA given is trusted as well as the others", () => {
    const { ca: trusted } = secure({ ca }, readFileSync);
    const others = secure({}, readFileSync).ca as string[];
    assert.ok(others.length > 0);
    assert.deepStrictEqual(trusted, [...others, read("ca.pem").toString()]);
  });

  test("~ is the home directory", () => {
    assert.strictEqual(resolve("~/a.pem"), path.join(os.homedir(), "a.pem"));
    assert.strictEqual(resolve("/a/~/b.pem"), "/a/~/b.pem");
  });

  test("a passphrase is kept under its certificate's file", () => {
    assert.strictEqual(
      passphraseKey({ cert: "/c.pem", key: "~/k.pem" }),
      `passphrase:${path.join(os.homedir(), "k.pem")}`,
    );
    assert.strictEqual(passphraseKey({ pfx: "/c.p12" }), "passphrase:/c.p12");
    assert.strictEqual(passphraseKey({ ca: "/ca.pem" }), undefined);
  });
});
