import * as assert from "node:assert";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import { decode } from "../codec/decode";
import { Connection } from "../connection";
import {
  authorities,
  filePath,
  files,
  home,
  passphraseKey,
  read as readTls,
  resolve,
  secure,
} from "../tls";

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
      tls: await secure(settings, options.passphrase),
    });
    try {
      return decode((await connection.query("1+1")).message);
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

  test("an expired certificate is refused", async () => {
    await assert.rejects(
      query(await fake("expired"), { ca }),
      /^Error: hop\. SSL reports: certificate has expired$/,
    );
  });

  test("the chain is checked whatever NODE_TLS_REJECT_UNAUTHORIZED says", async () => {
    const port = await fake("self");
    const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      await assert.rejects(query(port, { ca }), /^Error: hop\. SSL reports: /);
    } finally {
      if (before === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
      }
    }
  });

  test("a server without TLS is q's protocol error", async () => {
    const plain = net.createServer((socket) => socket.end());
    plain.listen(0, "127.0.0.1");
    await once(plain, "listening");
    stops.push(() => plain.close());
    await assert.rejects(
      query((plain.address() as net.AddressInfo).port, { ca }),
      { message: "hop. OS reports: Protocol error" },
    );
  });

  test("a refused connection by name is the OS's error, with TLS or without", async () => {
    // localhost has more than one address, each tried
    const closed = net.createServer();
    closed.listen(0, "127.0.0.1");
    await once(closed, "listening");
    const port = (closed.address() as net.AddressInfo).port;
    closed.close();
    const refused = { message: "hop. OS reports: Connection refused" };
    await assert.rejects(query(port, { ca }), refused);
    await assert.rejects(
      Connection.open({ host: "localhost", port, timeout: 1000 }),
      refused,
    );
  });

  test("a certificate for another host is accepted, as q's client does", async () => {
    assert.strictEqual((await query(await fake("elsewhere"), { ca })).type, -7);
  });

  test("a client certificate, as a certificate and key", async () => {
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
  });

  test("a client certificate that can't be decrypted says so", async () => {
    const port = await fake("server", true);
    const cert = file("client.pem");
    const key = file("client.encrypted.key");
    for (const passphrase of [undefined, "nope"]) {
      await assert.rejects(query(port, { ca, cert, key }, { passphrase }), {
        message: "invalid client certificate",
      });
    }
  });

  test("a file that can't be read, or isn't a small file, says so", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "quirk-tls-"));
    const big = path.join(dir, "big.pem");
    writeFileSync(big, Buffer.alloc(1e6 + 1));
    for (const name of [file("nope.pem"), dir, big]) {
      await assert.rejects(readTls(name), {
        message: "TLS file unreadable",
      });
    }
    await assert.rejects(secure({ ca: file("nope.pem") }), {
      message: "TLS file unreadable",
    });
  });

  test("a ca that isn't a certificate in PEM says so", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "quirk-tls-"));
    const der = path.join(dir, "ca.der");
    writeFileSync(
      der,
      new (await import("node:crypto")).X509Certificate(read("ca.pem")).raw,
    );
    for (const name of [file("server.key"), der]) {
      await assert.rejects(secure({ ca: name }), {
        message: "invalid TLS CA",
      });
    }
  });

  test("a CA given is trusted as well as the others", () => {
    const others = authorities();
    assert.ok(others.length > 0);
    assert.deepStrictEqual(authorities(read("ca.pem")), [
      ...others,
      read("ca.pem").toString().trim(),
    ]);
  });

  test("tls paths are absolute, on Windows or not, or from ~", () => {
    for (const ok of [
      "/a.pem",
      "~/a.pem",
      "~\\a.pem",
      "C:\\a.pem",
      "c:/a.pem",
      "\\\\host\\a.pem",
    ]) {
      assert.ok(filePath.test(ok), ok);
    }
    for (const bad of ["a.pem", "./a.pem", "~a.pem", "\\a.pem", "C:a.pem"]) {
      assert.ok(!filePath.test(bad), bad);
    }
    const settings = JSON.parse(
      readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    ).contributes.configuration.properties;
    for (const setting of ["tlsCaFile", "tlsCertFile", "tlsKeyFile"]) {
      assert.strictEqual(
        settings[`kdb-q-ext-vscode.${setting}`].pattern,
        `^$|${filePath.source}`,
        setting,
      );
    }
  });

  test("the TLS settings: each a path, unset if empty, cert with key", () => {
    assert.deepStrictEqual(files("/ca.pem", "", undefined), {
      files: { ca: "/ca.pem" },
    });
    assert.deepStrictEqual(files(undefined, "/c.pem", "~/k.pem"), {
      files: { cert: "/c.pem", key: "~/k.pem" },
    });
    assert.deepStrictEqual(files("ca.pem", "", ""), {
      files: {},
      problem: "TLS file paths are absolute or start with ~/",
    });
    assert.deepStrictEqual(
      files("", "/c.pem", "").problem,
      "TLS certificate and key files go together",
    );
    assert.deepStrictEqual(
      files("", "", "/k.pem").problem,
      "TLS certificate and key files go together",
    );
  });

  test("~ is the home directory", () => {
    assert.strictEqual(resolve("~/a.pem"), path.join(os.homedir(), "a.pem"));
    assert.strictEqual(resolve("~\\a.pem"), path.join(os.homedir(), "a.pem"));
    assert.strictEqual(resolve("/a/~/b.pem"), "/a/~/b.pem");
  });

  test("a file in the home directory is written from ~", () => {
    const at = (...parts: string[]) => path.join(os.homedir(), ...parts);
    assert.strictEqual(
      home(at("certs", "a.pem")),
      `~${path.sep}certs${path.sep}a.pem`,
    );
    assert.strictEqual(
      home(at("..a", "b.pem")),
      `~${path.sep}..a${path.sep}b.pem`,
    );
    assert.strictEqual(resolve(home(at("a.pem"))), at("a.pem"));
    const outside = path.join(path.parse(os.homedir()).root, "etc", "a.pem");
    assert.strictEqual(home(outside), outside);
    assert.strictEqual(home(os.homedir()), os.homedir());
  });

  test("a passphrase is kept under its key's file", () => {
    assert.strictEqual(
      passphraseKey({ cert: "/c.pem", key: "~/k.pem" }),
      `passphrase:${path.join(os.homedir(), "k.pem")}`,
    );
    assert.strictEqual(passphraseKey({ ca: "/ca.pem" }), undefined);
  });
});
