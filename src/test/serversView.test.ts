import * as assert from "node:assert";
import * as vscode from "vscode";
import type { Connection } from "../connection";
import { Connections, type State } from "../connections";
import { ServerForms } from "../serverForm";
import { type Entry, entries, id } from "../servers";
import {
  type Look,
  moveTo,
  newFolder,
  removeFolder,
  renameFolder,
  roots,
  row,
} from "../serversView";

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");
const user = () => config().inspect("servers")?.globalValue;
const setUser = (value: unknown) =>
  config().update("servers", value, vscode.ConfigurationTarget.Global);

// What a row's given: nothing connected, unless a test says
function look(states: Record<string, State> = {}, more: Partial<Look> = {}) {
  return {
    state: (each: string) => states[each],
    scopes: () => ["user" as const],
    ...more,
  };
}

const tp: Entry = {
  kind: "server",
  path: ["Prod", "TP"],
  server: { path: ["Prod", "TP"], host: "kdb1", port: 5010, user: "admin" },
};
const rdb: Entry = {
  kind: "server",
  path: ["Prod", "RDB"],
  server: { path: ["Prod", "RDB"], host: "kdb1", port: 5011 },
};
const prod: Entry = { kind: "folder", path: ["Prod"], entries: [rdb, tp] };

const icon = (item: vscode.TreeItem) => (item.iconPath as vscode.ThemeIcon).id;

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
  } as unknown as vscode.SecretStorage;
}

// Connections with the servers given open
async function opened(...servers: Entry[]) {
  const link = { closed: new Promise<Error>(() => {}), close: () => {} };
  const connections = new Connections<Connection>(
    async () => link as unknown as Connection,
  );
  for (const entry of servers) {
    if (entry.kind === "server" && entry.server) {
      await connections.connect(entry.server);
    }
  }
  return connections;
}

suite("the Servers view", () => {
  const window = vscode.window as unknown as Record<string, unknown>;
  const ask = window.showInputBox;
  const warn = window.showWarningMessage;
  let typed: string | undefined;
  let answer: string | undefined;
  let warned: unknown[][] = [];

  setup(() => {
    warned = [];
    window.showInputBox = async () => typed;
    window.showWarningMessage = async (...args: unknown[]) => {
      warned.push(args);
      return answer;
    };
  });

  teardown(async () => {
    window.showInputBox = ask;
    window.showWarningMessage = warn;
    await setUser(undefined);
  });

  test("a server not connected: its name, its login, and what's offered", () => {
    const item = row(tp, look());
    assert.strictEqual(item.label, "TP");
    assert.strictEqual(item.description, "admin@kdb1:5010");
    assert.strictEqual(icon(item), "server");
    assert.strictEqual(item.contextValue, "idle");
    assert.strictEqual(item.id, id(["Prod", "TP"]));
    assert.match(String(item.tooltip), /^Host: kdb1:5010\n/);
    assert.match(String(item.tooltip), /\nIn User settings$/);
  });

  test("a server's icon and menus follow its connection, the active one marked", () => {
    const at = id(tp.path);
    const states: [State, boolean, string, string][] = [
      [{ kind: "connecting" }, true, "loading~spin", "connecting"],
      [{ kind: "open" }, false, "debug-connected", "open"],
      [{ kind: "open" }, true, "debug-connected", "active"],
      [
        { kind: "closed", reason: new Error("x") },
        true,
        "debug-disconnect",
        "closed",
      ],
    ];
    for (const [state, active, shown, context] of states) {
      const item = row(tp, look({ [at]: state }, active ? { active: at } : {}));
      assert.strictEqual(icon(item), shown);
      assert.strictEqual(item.contextValue, context);
      assert.strictEqual(
        item.description,
        active ? "admin@kdb1:5010 · active" : "admin@kdb1:5010",
      );
    }
  });

  test("a server with a problem shows it, with a warning", () => {
    const item = row(
      { kind: "server", path: ["rdb"], problem: "has no host" },
      look(),
    );
    assert.strictEqual(icon(item), "warning");
    assert.strictEqual(item.description, "has no host");
    assert.strictEqual(item.contextValue, "broken");
    assert.strictEqual(item.tooltip, "has no host\nIn User settings");
  });

  test("a folder says what's connected in it", () => {
    assert.strictEqual(row(prod, look()).description, undefined);
    const open = {
      [id(tp.path)]: { kind: "open" },
      [id(rdb.path)]: { kind: "open" },
    } as const;
    assert.strictEqual(row(prod, look(open)).description, "· 2 open");
    assert.strictEqual(
      row(prod, look(open, { active: id(tp.path) })).description,
      "· active",
    );
    const item = row(prod, look());
    assert.strictEqual(icon(item), "folder");
    assert.strictEqual(item.contextValue, "folder");
    assert.strictEqual(
      item.collapsibleState,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    assert.strictEqual(
      row({ kind: "folder", path: ["UAT"], entries: [] }, look())
        .collapsibleState,
      vscode.TreeItemCollapsibleState.None,
    );
  });

  test("a folder with no name shows it, quoted", () => {
    const item = row(
      { kind: "folder", path: [" "], entries: [], problem: "has no name" },
      look(),
    );
    assert.strictEqual(item.label, '" "');
    assert.strictEqual(item.contextValue, "brokenFolder");
    assert.strictEqual(icon(item), "warning");
  });

  test("a scope's setting that isn't an object is a row of its own, then the rest", () => {
    const top = roots({
      user: [1],
      workspace: { gw: { host: "gw", port: 1 } },
    });
    assert.deepStrictEqual(top, [
      { kind: "setting", scope: "user", problem: "isn't an object" },
      ...entries({ gw: { host: "gw", port: 1 } }),
    ]);
    const item = row(top[0], look());
    assert.strictEqual(item.label, "User settings");
    assert.strictEqual(item.description, "servers isn't an object");
    assert.strictEqual(item.contextValue, "setting");
    assert.deepStrictEqual(
      roots({ user: undefined, workspace: undefined }),
      [],
    );
  });

  test("New Folder makes an empty folder, at the top or in a folder", async () => {
    await setUser({ Prod: { TP: { host: "kdb1", port: 1 } } });
    typed = " Ops ";
    await newFolder();
    await newFolder(prod);
    assert.deepStrictEqual(user(), {
      Prod: { TP: { host: "kdb1", port: 1 }, Ops: {} },
      Ops: {},
    });
    typed = undefined;
    await newFolder();
    assert.deepStrictEqual(Object.keys(user() as object), ["Prod", "Ops"]);
  });

  test("Rename Folder keeps its place, and disconnects its servers", async () => {
    await setUser({
      a: {},
      Prod: { TP: { host: "kdb1", port: 5010, user: "admin" } },
      c: {},
    });
    const connections = await opened(tp);
    const forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets({}),
      connections,
      async () => undefined,
    );
    try {
      typed = "Live";
      await renameFolder(connections, forms, prod);
    } finally {
      forms.dispose();
    }
    assert.deepStrictEqual(Object.keys(user() as object), ["a", "Live", "c"]);
    assert.deepStrictEqual(connections.servers, []);
  });

  test("Remove Folder, once confirmed, removes it and what's in it", async () => {
    await setUser({
      Prod: {
        TP: { host: "kdb1", port: 1, auth: "store" },
        trades: { RDB: { host: "kdb2", port: 1 } },
      },
      other: { host: "kdb3", port: 1 },
    });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const connections = await opened();
    const forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets(kept),
      connections,
      async () => undefined,
    );
    const folder = entries(user() as Record<string, unknown>)[0];
    try {
      answer = undefined;
      await removeFolder(secrets(kept), connections, forms, folder);
      assert.deepStrictEqual(warned[0], [
        "Remove Prod?",
        {
          modal: true,
          detail:
            "It and the 2 servers in it are removed from your User settings.",
        },
        "Remove",
      ]);
      assert.ok("Prod" in (user() as object));
      answer = "Remove";
      await removeFolder(secrets(kept), connections, forms, folder);
    } finally {
      forms.dispose();
    }
    assert.deepStrictEqual(user(), { other: { host: "kdb3", port: 1 } });
    assert.deepStrictEqual(kept, {});
  });

  test("a server dragged into a folder moves there, unless the name's taken", async () => {
    await setUser({
      Prod: { TP: { host: "kdb1", port: 1 } },
      TP: { host: "kdb2", port: 1 },
      gw: { host: "gw", port: 1 },
    });
    const connections = await opened();
    const [folder, gw, taken] = entries(user() as Record<string, unknown>);
    await moveTo(connections, gw, folder.path);
    assert.deepStrictEqual(user(), {
      Prod: { TP: { host: "kdb1", port: 1 }, gw: { host: "gw", port: 1 } },
      TP: { host: "kdb2", port: 1 },
    });
    await moveTo(connections, taken, folder.path);
    assert.deepStrictEqual(warned.at(-1), [
      "kdb+/q: TP wasn't moved: Prod already has one named TP",
    ]);
    // Into the folder it's in, or into itself, it stays
    const before = user();
    await moveTo(connections, folder, []);
    await moveTo(connections, folder, folder.path);
    assert.deepStrictEqual(user(), before);
  });
});
