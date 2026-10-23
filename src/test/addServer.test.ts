import * as assert from "node:assert";
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

// Answer the command's questions in turn: text for an input box, and a label
// for a pick, with undefined as a cancel. The prompts asked are kept.
function answer(answers: (string | undefined)[]): {
  asked: string[];
  restore: () => void;
} {
  const window = vscode.window as unknown as Window;
  const saved = ["showInputBox", "showQuickPick", "showInformationMessage"].map(
    (name) => [name, window[name]] as const,
  );
  const asked: string[] = [];
  window.showInputBox = async (options: vscode.InputBoxOptions) => {
    asked.push(options.prompt ?? "");
    const text = answers.shift();
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
    const label = answers.shift();
    return items.find((item) => item.label === label);
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

suite("addServer", () => {
  const connections = new Connections<Connection>(async () => undefined);

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
    const { asked, restore } = answer([
      " prod ",
      "kdb1.example.com:5010",
      "dan",
      "Store a password",
      "secret",
    ]);
    try {
      await addServer(secrets(kept), connections);
    } finally {
      restore();
    }
    assert.deepStrictEqual(config().get("servers"), {
      old: { host: "kdb0", port: 1 },
      prod: { host: "kdb1.example.com", port: 5010, user: "dan" },
    });
    assert.deepStrictEqual(kept, {
      "password:dan@kdb1.example.com:5010": "secret",
    });
    assert.strictEqual(asked.at(-1), "kdb+/q: Added prod.");
  });

  test("asking each time keeps no password, and no user is none", async () => {
    const kept: Record<string, string> = {};
    const { restore } = answer(["otp", "localhost:5000", "", "Ask each time"]);
    try {
      await addServer(secrets(kept), connections);
    } finally {
      restore();
    }
    assert.deepStrictEqual(config().get("servers"), {
      otp: { host: "localhost", port: 5000, auth: "prompt" },
    });
    assert.deepStrictEqual(kept, {});
  });

  test("an extension's fields are left for settings.json", async () => {
    const { asked, restore } = answer([
      "sso",
      "kdb2:5000",
      "",
      "Use an extension",
      "acme.kdb-auth",
    ]);
    try {
      await addServer(secrets({}), connections);
    } finally {
      restore();
    }
    assert.deepStrictEqual(config().get("servers"), {
      sso: { host: "kdb2", port: 5000, auth: { extension: "acme.kdb-auth" } },
    });
    assert.match(asked.at(-1) ?? "", /fields its extension takes/);
  });

  test("a cancel adds nothing", async () => {
    const { asked, restore } = answer(["prod", "kdb1:5010", undefined]);
    try {
      await addServer(secrets({}), connections);
    } finally {
      restore();
    }
    assert.strictEqual(config().inspect("servers")?.globalValue, undefined);
    assert.strictEqual(asked.length, 3);
  });

  test("a name taken or an address without a port isn't taken", async () => {
    await config().update(
      "servers",
      { prod: { host: "kdb1", port: 1 } },
      vscode.ConfigurationTarget.Global,
    );
    // The name's box is tried and answered, then the address's tried
    const tries = [
      ["prod", " ", "uat"],
      ["kdb1", "kdb1:0", "kdb1:5000"],
    ];
    const problems: (string | undefined)[][] = [];
    const window = vscode.window as unknown as Window;
    const saved = window.showInputBox;
    window.showInputBox = async (options: vscode.InputBoxOptions) => {
      const texts = tries.shift() ?? [];
      problems.push(
        texts.map(
          (text) => options.validateInput?.(text) as string | undefined,
        ),
      );
      return problems.length === 1 ? "uat" : undefined;
    };
    try {
      await addServer(secrets({}), connections);
    } finally {
      window.showInputBox = saved;
    }
    assert.deepStrictEqual(problems, [
      [
        "There's a server named prod already",
        "A server needs a name",
        undefined,
      ],
      [
        "host:port, such as localhost:5000",
        "host:port, such as localhost:5000",
        undefined,
      ],
    ]);
  });
});
