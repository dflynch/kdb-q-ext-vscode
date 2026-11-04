import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect, disconnect, dismiss } from "../commands";
import type { State } from "../connections";
import { ServerForms } from "../serverForm";
import { type Definition, type Entry, entries, id, put } from "../servers";
import {
  type Look,
  moveTo,
  newFolder,
  removeFolder,
  renameFolder,
  roots,
  row,
} from "../serversView";
import { connectionsWith, secrets, setUser, user } from "./helpers";

// What a row's given: nothing connected, unless a test says
function look(states: Record<string, State> = {}, more: Partial<Look> = {}) {
  return {
    state: (each: string) => states[each],
    scopes: () => ["user" as const],
    ...more,
  };
}

const tpServer: Definition = {
  path: ["Prod", "TP"],
  host: "kdb1",
  port: 5010,
  user: "admin",
};
const rdbServer: Definition = {
  path: ["Prod", "RDB"],
  host: "kdb1",
  port: 5011,
};
const tp: Entry = { kind: "server", path: tpServer.path, server: tpServer };
const rdb: Entry = { kind: "server", path: rdbServer.path, server: rdbServer };
// Two more, only ever connected to
const ref: Definition = { path: ["Prod", "REF"], host: "kdb1", port: 5012 };
const hdb: Definition = { path: ["Prod", "HDB"], host: "kdb1", port: 5013 };
const prod: Entry = { kind: "folder", path: ["Prod"], entries: [rdb, tp] };

const icon = (item: vscode.TreeItem) => (item.iconPath as vscode.ThemeIcon).id;

// Connections with the servers given open
const opened = (...servers: Entry[]) =>
  connectionsWith(
    servers.flatMap((entry) =>
      entry.kind === "server" && entry.server ? [entry.server] : [],
    ),
  );

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
      { kind: "server", path: ["rdb"], problem: "no host" },
      look(),
    );
    assert.strictEqual(icon(item), "warning");
    assert.strictEqual(item.description, "no host");
    assert.strictEqual(item.contextValue, "broken");
    assert.strictEqual(item.tooltip, "no host\nIn User settings");
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
      { kind: "folder", path: [" "], entries: [], problem: "no name" },
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
      { kind: "setting", scope: "user", problem: "not an object" },
      ...entries({ gw: { host: "gw", port: 1 } }),
    ]);
    const item = row(top[0], look());
    assert.strictEqual(item.label, "User settings");
    assert.strictEqual(item.description, "servers: not an object");
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
    const connections = await opened();
    const forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets({}),
      connections,
      async () => undefined,
    );
    const folder = entries(user() as Record<string, unknown>)[0];
    try {
      answer = undefined;
      await removeFolder(connections, forms, folder);
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
      await removeFolder(connections, forms, folder);
    } finally {
      forms.dispose();
    }
    assert.deepStrictEqual(user(), { other: { host: "kdb3", port: 1 } });
  });

  test("a server dragged into a folder moves there, disconnected, unless the name's taken", async () => {
    await setUser({
      Prod: { TP: { host: "kdb1", port: 1 } },
      TP: { host: "kdb2", port: 1 },
      gw: { host: "gw", port: 1 },
    });
    const [folder, gw, taken] = entries(user() as Record<string, unknown>);
    const connections = await opened(gw);
    const forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets({}),
      connections,
      async () => undefined,
    );
    try {
      await moveTo(connections, forms, gw, folder.path);
      assert.deepStrictEqual(user(), {
        Prod: { TP: { host: "kdb1", port: 1 }, gw: { host: "gw", port: 1 } },
        TP: { host: "kdb2", port: 1 },
      });
      // It's known by its path, so its connection's closed
      assert.deepStrictEqual(connections.servers, []);
      await moveTo(connections, forms, taken, folder.path);
      assert.deepStrictEqual(warned.at(-1), [
        "kdb+/q: TP wasn't moved: TP already exists in Prod",
      ]);
      // Into the folder it's in, or into itself, it stays
      const before = user();
      await moveTo(connections, forms, folder, []);
      await moveTo(connections, forms, folder, folder.path);
      assert.deepStrictEqual(user(), before);
    } finally {
      forms.dispose();
    }
  });

  test("a scope's folder that the other writes as a server is refused, not written into", async () => {
    // The workspace's Prod is a folder, which the view shows; the user's
    // is a server
    assert.throws(
      () => put({ Prod: { host: "h", port: 1 } }, ["Prod", "a"], {}),
      { message: "Prod isn't a folder in this scope's settings" },
    );
    assert.throws(() => put({ Prod: "x" }, ["Prod", "a"], {}));
    assert.deepStrictEqual(put({ Prod: {} }, ["Prod", "a"], {}), {
      Prod: { a: {} },
    });
  });

  test("a scope's setting that isn't an object hides nothing of the other's", () => {
    assert.deepStrictEqual(
      roots({ user: { gw: { host: "gw", port: 1 } }, workspace: "x" }),
      [
        { kind: "setting", scope: "workspace", problem: "not an object" },
        ...entries({ gw: { host: "gw", port: 1 } }),
      ],
    );
  });

  test("Remove Folder of a folder with no name counts what's in it", async () => {
    await setUser({ " ": { TP: { host: "kdb1", port: 1, auth: "store" } } });
    const connections = await opened();
    const forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets({}),
      connections,
      async () => undefined,
    );
    const [folder] = entries(user() as Record<string, unknown>);
    try {
      answer = "Remove";
      await removeFolder(connections, forms, folder);
    } finally {
      forms.dispose();
    }
    assert.strictEqual(
      (warned[0][1] as { detail: string }).detail,
      "It and the server in it are removed from your User settings.",
    );
    assert.deepStrictEqual(user(), {});
  });

  test("Connect, Make Active, Disconnect and Dismiss take the server whose row they're run on", async () => {
    const connections = await opened();
    await connect(connections, tp);
    await connect(connections, rdb);
    assert.strictEqual(connections.active?.id, id(rdb.path));
    // Make Active is Connect on one that's open
    await connect(connections, tp);
    assert.strictEqual(connections.active?.id, id(tp.path));
    await disconnect(connections, tp);
    assert.deepStrictEqual(
      connections.servers.map(({ path }) => path),
      [rdb.path],
    );
    // A failed connect stays active until it's dismissed, leaving none
    const failed = await connectionsWith([rdbServer], [tpServer]);
    assert.strictEqual(failed.active?.id, id(tp.path));
    await dismiss(failed, tp);
    assert.deepStrictEqual(
      failed.servers.map(({ path }) => path),
      [rdb.path],
    );
    assert.strictEqual(failed.active, undefined);
  });

  test("from the palette, Dismiss takes the only closed one, says when there's none, and forgets the one picked", async () => {
    const quick = window.showQuickPick;
    const inform = window.showInformationMessage;
    const told: string[] = [];
    let asked = 0;
    window.showQuickPick = async (items: { label: string }[]) => {
      asked++;
      return items[1];
    };
    window.showInformationMessage = async (message: string) => {
      told.push(message);
      return undefined;
    };
    try {
      const none = await connectionsWith([rdbServer]);
      await dismiss(none);
      assert.deepStrictEqual(told, ["kdb+/q: No connection is closed."]);
      assert.strictEqual(none.servers.length, 1);

      const one = await connectionsWith([rdbServer], [tpServer]);
      await dismiss(one);
      assert.strictEqual(asked, 0);
      assert.deepStrictEqual(
        one.servers.map(({ path }) => path),
        [rdb.path],
      );

      const two = await connectionsWith([rdbServer], [tpServer, ref]);
      await dismiss(two);
      assert.strictEqual(asked, 1);
      assert.deepStrictEqual(
        two.servers.map(({ path }) => path),
        [rdb.path, tp.path],
      );
    } finally {
      window.showQuickPick = quick;
      window.showInformationMessage = inform;
    }
  });

  test("from the palette, Disconnect takes the only open one, and says when there's none", async () => {
    const quick = window.showQuickPick;
    const inform = window.showInformationMessage;
    const told: string[] = [];
    let asked = 0;
    window.showQuickPick = async () => {
      asked++;
      return undefined;
    };
    window.showInformationMessage = async (message: string) => {
      told.push(message);
      return undefined;
    };
    try {
      const none = await connectionsWith([], [tpServer]);
      await disconnect(none);
      assert.deepStrictEqual(told, ["kdb+/q: No server is connected."]);
      assert.strictEqual(none.servers.length, 1);

      const one = await connectionsWith([rdbServer], [tpServer]);
      await disconnect(one);
      assert.strictEqual(asked, 0);
      assert.deepStrictEqual(
        one.servers.map(({ path }) => path),
        [tp.path],
      );
    } finally {
      window.showQuickPick = quick;
      window.showInformationMessage = inform;
    }
  });

  test("from the palette, Disconnect offers those open or connecting, and Dismiss those closed", async () => {
    const quick = window.showQuickPick;
    const offered: string[][] = [];
    window.showQuickPick = async (items: { label: string }[]) => {
      offered.push(items.map(({ label }) => label));
      return undefined;
    };
    try {
      const connections = await connectionsWith(
        [rdbServer],
        [tpServer, ref],
        [hdb],
      );
      await disconnect(connections);
      await dismiss(connections);
    } finally {
      window.showQuickPick = quick;
    }
    assert.deepStrictEqual(offered, [
      ["Prod › RDB", "Prod › HDB"],
      ["Prod › TP", "Prod › REF"],
    ]);
  });

  test("a closed row offers Dismiss on its menu, not Disconnect, and no row more than two icons", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    );
    // Whether a menu entry's when clause holds for a row in the view
    const holds = (when: string, item: string) =>
      when.startsWith("view == kdb-q-ext-vscode.servers && ") &&
      (when.endsWith(`viewItem == ${item}`) ||
        new RegExp(when.match(/viewItem =~ \/(.*)\/$/)?.[1] ?? "$^").test(
          item,
        ));
    // A row's commands, inline or on its menu
    const offered = (item: string, inline: boolean) =>
      manifest.contributes.menus["view/item/context"]
        .filter(
          (entry: { when: string; group: string }) =>
            holds(entry.when, item) &&
            entry.group.startsWith("inline") === inline,
        )
        .map((entry: { command: string }) => entry.command);
    const dismiss = "kdb-q-ext-vscode.dismiss";
    const disconnect = "kdb-q-ext-vscode.disconnect";
    assert.ok(offered("closed", false).includes(dismiss));
    assert.ok(!offered("closed", false).includes(disconnect));
    assert.ok(!offered("closed", true).includes(disconnect));
    const items = ["idle", "connecting", "open", "active", "closed", "broken"];
    for (const item of [...items, "folder", "brokenFolder", "setting"]) {
      assert.ok(offered(item, true).length <= 2, item);
      if (item !== "closed") {
        assert.ok(
          !offered(item, true).includes(dismiss) &&
            !offered(item, false).includes(dismiss),
          item,
        );
      }
    }
  });
});
