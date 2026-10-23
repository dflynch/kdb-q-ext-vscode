import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";
import type * as vscode from "vscode";
import { opener } from "../commands";
import type { Definition } from "../servers";
import { passphraseKey } from "../tls";

const fixture = (name: string) =>
  path.join(__dirname, "../../test/fixtures/tls", name);

// Secure storage holding what the test gives it
function secrets(kept: Record<string, string>): vscode.SecretStorage {
  return {
    get: async (key: string) => kept[key],
    store: async () => {},
    delete: async () => {},
    keys: async () => Object.keys(kept),
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as vscode.SecretStorage;
}

// A stand-in for q that takes any login, giving what it was sent
async function serve(
  secure?: tls.TlsOptions,
): Promise<{ port: number; login: Promise<string>; stop: () => void }> {
  let logged: (login: string) => void = () => {};
  const login = new Promise<string>((resolve) => {
    logged = resolve;
  });
  const accept = (socket: net.Socket) => {
    socket.once("data", (chunk) => {
      logged(chunk.subarray(0, chunk.indexOf(0) - 1).toString());
      socket.write(Buffer.of(3));
    });
    socket.on("error", () => {});
  };
  const server = secure
    ? tls.createServer(secure, accept)
    : net.createServer(accept);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: (server.address() as net.AddressInfo).port,
    login,
    stop: () => server.close(),
  };
}

suite("opener", () => {
  test("logs in with the password kept for the server", async () => {
    const fake = await serve();
    const server: Definition = {
      name: "local",
      host: "127.0.0.1",
      port: fake.port,
      user: "dan",
    };
    const open = opener(
      secrets({ [`password:dan@127.0.0.1:${fake.port}`]: "pw" }),
    );
    const connection = await open(server);
    assert.strictEqual(await fake.login, "dan:pw");
    connection?.close();
    fake.stop();
  });

  test("connects with TLS, with the client certificate's kept passphrase", async () => {
    const fake = await serve({
      cert: readFileSync(fixture("server.pem")),
      key: readFileSync(fixture("server.key")),
      ca: readFileSync(fixture("ca.pem")),
      requestCert: true,
      rejectUnauthorized: true,
    });
    const settings = {
      ca: fixture("ca.pem"),
      pfx: fixture("client.p12"),
    };
    const server: Definition = {
      name: "secure",
      host: "localhost",
      port: fake.port,
      tls: settings,
    };
    const key = passphraseKey(settings) as string;
    const connection = await opener(secrets({ [key]: "secret" }))(server);
    assert.strictEqual(await fake.login, ":");
    connection?.close();
    fake.stop();
  });
});
