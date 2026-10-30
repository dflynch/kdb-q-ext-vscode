import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { clearPassphrase, setPassphrase } from "../commands";

// Secure storage keeping what's stored
function secrets(kept: Record<string, string>): vscode.SecretStorage {
  return {
    get: async (key: string) => kept[key],
    store: async (key: string, value: string) => {
      kept[key] = value;
    },
    delete: async (key: string) => {
      delete kept[key];
    },
    keys: async () => Object.keys(kept),
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as vscode.SecretStorage;
}

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");
const set = (settings: Record<string, string | undefined>) =>
  Promise.all(
    Object.entries(settings).map(([setting, value]) =>
      config().update(setting, value, vscode.ConfigurationTarget.Global),
    ),
  );

suite("certificate passphrase", () => {
  const window = vscode.window as unknown as Record<string, unknown>;
  const inform = window.showInformationMessage;
  const ask = window.showInputBox;
  let told: string[] = [];
  const key = path.join(path.sep, "certs", "client.key");

  setup(() => {
    told = [];
    window.showInformationMessage = async (message: string) => {
      told.push(message);
      return undefined;
    };
    window.showInputBox = async () => "secret";
  });

  teardown(async () => {
    window.showInformationMessage = inform;
    window.showInputBox = ask;
    await set({
      tlsCaFile: undefined,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
    });
  });

  test("is kept and cleared under the key's file, with no server picked", async () => {
    await set({ tlsCertFile: "/certs/client.pem", tlsKeyFile: key });
    const kept: Record<string, string> = {};
    await setPassphrase(secrets(kept));
    assert.deepStrictEqual(kept, { [`passphrase:${key}`]: "secret" });
    await clearPassphrase(secrets(kept));
    assert.deepStrictEqual(kept, {});
    assert.deepStrictEqual(told, []);
  });

  test("a wrong CA doesn't stop it being kept", async () => {
    await set({
      tlsCaFile: "ca.pem",
      tlsCertFile: "/certs/client.pem",
      tlsKeyFile: key,
    });
    const kept: Record<string, string> = {};
    await setPassphrase(secrets(kept));
    assert.deepStrictEqual(kept, { [`passphrase:${key}`]: "secret" });
  });

  test("without a key file, says why", async () => {
    const kept: Record<string, string> = {};
    await setPassphrase(secrets(kept));
    await set({ tlsKeyFile: "client.key" });
    await clearPassphrase(secrets(kept));
    assert.deepStrictEqual(kept, {});
    assert.deepStrictEqual(told, [
      "kdb+/q: No TLS key file is set.",
      "kdb+/q: invalid TLS settings: tlsKeyFile: not an absolute path or one from ~/",
    ]);
  });
});
