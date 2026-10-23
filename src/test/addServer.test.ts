import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { addServer } from "../commands";
import type { Connection } from "../connection";
import { Connections } from "../connections";

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

type Window = Record<string, unknown>;
type Answer = string | string[] | undefined;

// Answer the command's questions in turn: text for an input box, a label for
// a pick, labels for ticks and a path for a file, with undefined as a cancel.
// Each question is kept, with any value an input box is given.
function answer(answers: Answer[]): { asked: string[]; restore: () => void } {
  const window = vscode.window as unknown as Window;
  const saved = [
    "showInputBox",
    "showQuickPick",
    "showOpenDialog",
    "showInformationMessage",
  ].map((name) => [name, window[name]] as const);
  const asked: string[] = [];
  window.showInputBox = async (options: vscode.InputBoxOptions) => {
    asked.push(
      `${options.prompt}${options.value === undefined ? "" : ` [${options.value}]`}`,
    );
    const text = answers.shift() as string | undefined;
    assert.strictEqual(
      text === undefined ? undefined : options.validateInput?.(text),
      undefined,
      `${options.prompt} took ${text}`,
    );
    return text;
  };
  window.showQuickPick = async (
    items: vscode.QuickPickItem[],
    options: vscode.QuickPickOptions,
  ) => {
    asked.push(options.placeHolder ?? "");
    const labels = answers.shift();
    return options.canPickMany
      ? labels && items.filter((item) => labels.includes(item.label))
      : items.find((item) => item.label === labels);
  };
  window.showOpenDialog = async (options: vscode.OpenDialogOptions) => {
    asked.push(options.openLabel ?? "");
    const file = answers.shift() as string | undefined;
    return file && [vscode.Uri.file(file)];
  };
  window.showInformationMessage = async (message: string) => {
    asked.push(message);
    return undefined;
  };
  return {
    asked,
    restore: () => {
      for (const [name, value] of saved) {
        window[name] = value;
      }
    },
  };
}

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");
const added = () => config().inspect("servers")?.globalValue;

suite("addServer", () => {
  const connections = new Connections<Connection>(async () => undefined);

  // Add a server with the answers given, keeping its secrets; the questions
  // asked
  async function add(
    answers: Answer[],
    kept: Record<string, string> = {},
  ): Promise<string[]> {
    const { asked, restore } = answer(answers);
    try {
      await addServer(secrets(kept), connections);
    } finally {
      restore();
    }
    return asked;
  }

  teardown(async () => {
    await config().update(
      "servers",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("adds a server with a stored password to the user's settings", async () => {
    await config().update(
      "servers",
      { old: { host: "kdb0", port: 1 } },
      vscode.ConfigurationTarget.Global,
    );
    const kept: Record<string, string> = {};
    const asked = await add(
      [
        " prod ",
        "kdb1.example.com",
        "5010",
        "dan",
        "Store a password",
        "secret",
        [],
      ],
      kept,
    );
    assert.deepStrictEqual(added(), {
      old: { host: "kdb0", port: 1 },
      prod: { host: "kdb1.example.com", port: 5010, user: "dan" },
    });
    assert.deepStrictEqual(kept, {
      "password:dan@kdb1.example.com:5010": "secret",
    });
    assert.strictEqual(asked.at(-1), "kdb+/q: Added prod.");
  });

  test("a host typed with its port gives the port", async () => {
    const asked = await add([
      "prod",
      "kdb1:5010",
      "5010",
      "",
      "Store a password",
      "",
      [],
    ]);
    assert.strictEqual(asked[2], "The port on kdb1 [5010]");
    assert.deepStrictEqual(added(), { prod: { host: "kdb1", port: 5010 } });
  });

  test("asking each time keeps no password, and no user is none", async () => {
    const kept: Record<string, string> = {};
    await add(["otp", "localhost", "5000", "", "Ask each time", []], kept);
    assert.deepStrictEqual(added(), {
      otp: { host: "localhost", port: 5000, auth: "prompt" },
    });
    assert.deepStrictEqual(kept, {});
  });

  test("an extension's fields are left for settings.json", async () => {
    const asked = await add([
      "sso",
      "kdb2",
      "5000",
      "",
      "Use an extension",
      "acme.kdb-auth",
      [],
    ]);
    assert.deepStrictEqual(added(), {
      sso: { host: "kdb2", port: 5000, auth: { extension: "acme.kdb-auth" } },
    });
    assert.match(asked.at(-1) ?? "", /fields its extension takes/);
  });

  test("the options: TLS with its files, protect and a timeout", async () => {
    const at = (name: string) => path.join(os.homedir(), "certs", name);
    const tilde = (name: string) => `~${path.sep}certs${path.sep}${name}`;
    const kept: Record<string, string> = {};
    await add(
      [
        "prod",
        "kdb1",
        "5010",
        "",
        "Ask each time",
        [
          "Connect with TLS",
          "Turn off protected evaluation",
          "Set a connect timeout",
        ],
        ["A CA", "A client certificate"],
        at("ca.pem"),
        "A certificate and its key",
        at("client.pem"),
        at("client.key"),
        "secret",
        "500",
      ],
      kept,
    );
    assert.deepStrictEqual(added(), {
      prod: {
        host: "kdb1",
        port: 5010,
        auth: "prompt",
        tls: {
          ca: tilde("ca.pem"),
          cert: tilde("client.pem"),
          key: tilde("client.key"),
        },
        protect: false,
        timeout: 500,
      },
    });
    assert.deepStrictEqual(kept, {
      [`passphrase:${at("client.key")}`]: "secret",
    });
  });

  test("TLS needing no files is true, and a PKCS#12 file is a pfx", async () => {
    const pfx = path.join(path.parse(os.homedir()).root, "etc", "client.p12");
    await add([
      "a",
      "kdb1",
      "1",
      "",
      "Ask each time",
      ["Connect with TLS"],
      [],
    ]);
    await add([
      "b",
      "kdb1",
      "2",
      "",
      "Ask each time",
      ["Connect with TLS"],
      ["A client certificate"],
      "One PKCS#12 file",
      pfx,
      "",
    ]);
    assert.deepStrictEqual(added(), {
      a: { host: "kdb1", port: 1, auth: "prompt", tls: true },
      b: { host: "kdb1", port: 2, auth: "prompt", tls: { pfx } },
    });
  });

  test("a cancel adds nothing", async () => {
    const asked = await add(["prod", "kdb1", "5010", undefined]);
    assert.strictEqual(added(), undefined);
    assert.strictEqual(asked.length, 4);
    await add([
      "prod",
      "kdb1",
      "5010",
      "",
      "Ask each time",
      ["Connect with TLS"],
      ["A CA"],
      undefined,
    ]);
    assert.strictEqual(added(), undefined);
  });

  test("a name taken, an empty host or a port out of range isn't taken", async () => {
    await config().update(
      "servers",
      { prod: { host: "kdb1", port: 1 } },
      vscode.ConfigurationTarget.Global,
    );
    // Each box is tried, then answered with the last
    const tries = [
      ["prod", " ", "uat"],
      [" ", "kdb1"],
      ["0", "65536", "5.5", "5000"],
    ];
    const problems: (string | undefined)[][] = [];
    const window = vscode.window as unknown as Window;
    const saved = window.showInputBox;
    window.showInputBox = async (options: vscode.InputBoxOptions) => {
      const texts = tries.shift();
      problems.push(
        (texts ?? []).map(
          (text) => options.validateInput?.(text) as string | undefined,
        ),
      );
      return texts?.at(-1);
    };
    try {
      await addServer(secrets({}), connections);
    } finally {
      window.showInputBox = saved;
    }
    assert.deepStrictEqual(problems.slice(0, 3), [
      [
        "There's a server named prod already",
        "A server needs a name",
        undefined,
      ],
      ["A host", undefined],
      [
        "A port, from 1 to 65535",
        "A port, from 1 to 65535",
        "A port, from 1 to 65535",
        undefined,
      ],
    ]);
  });
});
