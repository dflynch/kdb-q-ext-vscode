import * as assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";
import * as vscode from "vscode";
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
      user: "admin",
    };
    const open = opener(
      secrets({ [`password:admin@127.0.0.1:${fake.port}`]: "pw" }),
    );
    const connection = await open(server);
    assert.strictEqual(await fake.login, "admin:pw");
    connection?.close();
    fake.stop();
  });

  test("a password typed in the server form, in place of the one kept", async () => {
    const fake = await serve();
    const server: Definition = {
      name: "local",
      host: "127.0.0.1",
      port: fake.port,
      user: "admin",
    };
    const open = opener(
      secrets({ [`password:admin@127.0.0.1:${fake.port}`]: "pw" }),
    );
    const connection = await open(server, "typed");
    assert.strictEqual(await fake.login, "admin:typed");
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
    const config = vscode.workspace.getConfiguration("kdb-q-ext-vscode");
    const files = {
      tlsCaFile: fixture("ca.pem"),
      tlsCertFile: fixture("client.pem"),
      tlsKeyFile: fixture("client.encrypted.key"),
    };
    for (const [setting, file] of Object.entries(files)) {
      await config.update(setting, file, vscode.ConfigurationTarget.Global);
    }
    try {
      const server: Definition = {
        name: "secure",
        host: "localhost",
        port: fake.port,
        tls: true,
      };
      const key = passphraseKey({ key: files.tlsKeyFile }) as string;
      const connection = await opener(secrets({ [key]: "secret" }))(server);
      assert.strictEqual(await fake.login, ":");
      connection?.close();
    } finally {
      for (const setting of Object.keys(files)) {
        await config.update(
          setting,
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
      fake.stop();
    }
  });

  test("TLS settings that are wrong fail the connect, before credentials are asked for", async () => {
    const config = vscode.workspace.getConfiguration("kdb-q-ext-vscode");
    await config.update(
      "tlsCertFile",
      fixture("client.pem"),
      vscode.ConfigurationTarget.Global,
    );
    const window = vscode.window as unknown as Record<string, unknown>;
    const ask = window.showInputBox;
    let asked = false;
    window.showInputBox = async () => {
      asked = true;
      return "pw";
    };
    try {
      const server: Definition = {
        name: "secure",
        host: "localhost",
        port: 1,
        tls: true,
        auth: "prompt",
      };
      await assert.rejects(opener(secrets({}))(server), {
        message: "invalid TLS settings: tlsCertFile and tlsKeyFile go together",
      });
      assert.strictEqual(asked, false);
    } finally {
      window.showInputBox = ask;
      await config.update(
        "tlsCertFile",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
  });
});
