// What crosses User and Workspace settings, run with a folder open, so
// that there are Workspace settings to write
import * as assert from "node:assert";
import * as vscode from "vscode";
import { removeServer } from "../../commands";
import type { Connection } from "../../connection";
import { Connections } from "../../connections";
import { blank, type Form, type ToForm } from "../../form/fields";
import { ServerForms, scopes } from "../../serverForm";
import * as servers from "../../servers";
import { moveTo, removeFolder, renameFolder } from "../../serversView";
import {
  refusing,
  secrets,
  setUser,
  setWorkspace,
  tabs,
  user,
  workspace,
} from "../helpers";

const prod: Form = {
  ...blank(),
  name: "TP",
  host: "kdb2",
  port: "1",
  auth: "store",
  password: "secret",
  timeout: "",
};

// The view's row at a path, as the scopes write it together
function rowAt(path: string[]): servers.Entry {
  const found = servers
    .everything(
      servers.entries(servers.merged(scopes()) as Record<string, unknown>),
    )
    .find((entry) => servers.id(entry.path) === servers.id(path));
  assert.ok(found, `no row at ${servers.shown(path)}`);
  return found;
}

suite("User and Workspace settings", () => {
  const window = vscode.window as unknown as Record<string, unknown>;
  const ask = window.showInputBox;
  const warn = window.showWarningMessage;
  const error = window.showErrorMessage;
  let typed: string | undefined;
  let warned: unknown[][] = [];
  let errors: string[] = [];
  let forms: ServerForms | undefined;
  const connections = new Connections<Connection>(async () => undefined);

  setup(() => {
    assert.ok(vscode.workspace.workspaceFolders, "no folder open");
    typed = undefined;
    warned = [];
    errors = [];
    window.showInputBox = async () => typed;
    window.showWarningMessage = async (...args: unknown[]) => {
      warned.push(args);
      return "Remove";
    };
    window.showErrorMessage = async (text: string) => {
      errors.push(text);
      return undefined;
    };
  });

  teardown(async () => {
    window.showInputBox = ask;
    window.showWarningMessage = warn;
    window.showErrorMessage = error;
    forms?.dispose();
    forms = undefined;
    await setUser(undefined);
    await setWorkspace(undefined);
  });

  function open(kept: Record<string, string> = {}) {
    const { made, panels } = tabs();
    forms = new ServerForms(
      vscode.Uri.file("/extension"),
      secrets(kept),
      connections,
      async () => undefined,
      panels,
    );
    return { made, forms };
  }

  test("a server in Workspace settings alone is edited, moved and removed there", async () => {
    await setWorkspace({
      TP: { host: "kdb1", port: 1, auth: "store" },
      Ops: {},
    });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit(["TP"]);
    await made[0].loaded();
    made[0].say({
      type: "save",
      form: { ...prod, host: "kdb1", password: "" },
    });
    await made[0].closing;
    assert.strictEqual(user(), undefined);
    await moveTo(connections, forms, rowAt(["TP"]), ["Ops"]);
    assert.deepStrictEqual(workspace(), {
      Ops: { TP: { host: "kdb1", port: 1, auth: "store" } },
    });
    await removeServer(connections, forms, rowAt(["Ops", "TP"]));
    assert.deepStrictEqual(workspace(), { Ops: {} });
    assert.strictEqual(user(), undefined);
  });

  test("a folder in Workspace settings alone is renamed and removed there", async () => {
    await setWorkspace({ Prod: { TP: { host: "kdb1", port: 1 } } });
    typed = "Live";
    await renameFolder(connections, open().forms, rowAt(["Prod"]));
    assert.deepStrictEqual(workspace(), {
      Live: { TP: { host: "kdb1", port: 1 } },
    });
    await removeFolder(connections, open().forms, rowAt(["Live"]));
    assert.strictEqual(
      (warned[0][1] as { detail: string }).detail,
      "It and the server in it are removed from your Workspace settings.",
    );
    assert.deepStrictEqual(workspace(), {});
    assert.strictEqual(user(), undefined);
  });

  test("a server in both is edited in Workspace settings, and the User's password is kept", async () => {
    await setUser({ TP: { host: "kdb1", port: 1, auth: "store" } });
    await setWorkspace({ TP: { host: "kdb1", port: 1, auth: "store" } });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit(["TP"]);
    await made[0].loaded();
    made[0].say({ type: "save", form: { ...prod, password: "other" } });
    await made[0].closing;
    assert.deepStrictEqual(user(), {
      TP: { host: "kdb1", port: 1, auth: "store" },
    });
    assert.deepStrictEqual(workspace(), {
      TP: { host: "kdb2", port: 1, auth: "store" },
    });
    // The User's still gets its password, in every other workspace
    assert.deepStrictEqual(kept, {
      "password:@kdb1:1": "secret",
      "password:@kdb2:1": "other",
    });
  });

  test("a server in both renamed is renamed in each, its fields written in Workspace settings", async () => {
    await setUser({ TP: { host: "kdb1", port: 1 } });
    await setWorkspace({ TP: { host: "kdb2", port: 1 } });
    const { made, forms } = open();
    forms.edit(["TP"]);
    await made[0].loaded();
    made[0].say({
      type: "save",
      form: { ...prod, name: "RDB", host: "kdb3", auth: "none" },
    });
    await made[0].closing;
    assert.deepStrictEqual(user(), { RDB: { host: "kdb1", port: 1 } });
    assert.deepStrictEqual(workspace(), { RDB: { host: "kdb3", port: 1 } });
  });

  test("a name in the other scope alone is taken", async () => {
    await setUser({ RDB: { host: "kdb1", port: 1 } });
    await setWorkspace({ TP: { host: "kdb2", port: 1 } });
    const { made, forms } = open();
    forms.edit(["TP"]);
    assert.deepStrictEqual((await made[0].loaded()).context.taken, ["RDB"]);
    made[0].say({ type: "save", form: { ...prod, name: "RDB", auth: "none" } });
    assert.deepStrictEqual(await made[0].next(), {
      type: "unsaved",
      text: "not saved, as name: RDB already exists",
    });
  });

  test("a write Workspace settings refuse is undone in User settings, so it can be run again", async () => {
    await setUser({ TP: { host: "kdb1", port: 1 }, Ops: {} });
    await setWorkspace({ TP: { host: "kdb2", port: 1 }, Ops: {} });
    const both = {
      user: { TP: { host: "kdb1", port: 1 }, Ops: {} },
      workspace: { TP: { host: "kdb2", port: 1 }, Ops: {} },
    };
    const { made, forms } = open();
    const workspaceOnly = (target: vscode.ConfigurationTarget) =>
      target === vscode.ConfigurationTarget.Workspace;
    await refusing(workspaceOnly, () =>
      moveTo(connections, forms, rowAt(["TP"]), ["Ops"]),
    );
    typed = "Live";
    await refusing(workspaceOnly, () =>
      renameFolder(connections, forms, rowAt(["Ops"])),
    );
    await refusing(workspaceOnly, () =>
      removeServer(connections, forms, rowAt(["TP"])),
    );
    await refusing(workspaceOnly, () =>
      removeFolder(connections, forms, rowAt(["Ops"])),
    );
    assert.deepStrictEqual(errors, [
      "kdb+/q: TP wasn't moved, as Workspace settings refused: the file has unsaved changes",
      "kdb+/q: Ops wasn't renamed, as Workspace settings refused: the file has unsaved changes",
      "kdb+/q: TP wasn't removed, as Workspace settings refused: the file has unsaved changes",
      "kdb+/q: Ops wasn't removed, as Workspace settings refused: the file has unsaved changes",
    ]);
    assert.deepStrictEqual({ user: user(), workspace: workspace() }, both);
    forms.edit(["TP"]);
    await made[0].loaded();
    const unsaved = refusing(workspaceOnly, async () => {
      made[0].say({ type: "save", form: { ...prod, name: "RDB" } });
      return made[0].next();
    });
    assert.deepStrictEqual(await unsaved, {
      type: "unsaved",
      text: "not saved, as Workspace settings refused: the file has unsaved changes",
    });
    assert.deepStrictEqual({ user: user(), workspace: workspace() }, both);
    // Nothing's half done, so it can be run again
    await moveTo(connections, forms, rowAt(["TP"]), ["Ops"]);
    assert.deepStrictEqual(user(), { Ops: { TP: { host: "kdb1", port: 1 } } });
    assert.deepStrictEqual(workspace(), {
      Ops: { TP: { host: "kdb2", port: 1 } },
    });
  });

  test("a write that can't be undone says what was done", async () => {
    await setUser({ TP: { host: "kdb1", port: 1 }, Ops: {} });
    await setWorkspace({ TP: { host: "kdb2", port: 1 }, Ops: {} });
    // User settings take the move, then refuse putting it back
    let users = 0;
    await refusing(
      (target) =>
        target === vscode.ConfigurationTarget.Workspace ||
        (target === vscode.ConfigurationTarget.Global && users++ > 0),
      () => moveTo(connections, open().forms, rowAt(["TP"]), ["Ops"]),
    );
    assert.deepStrictEqual(errors, [
      "kdb+/q: TP was moved in User settings but not in Workspace settings: the file has unsaved changes",
    ]);
    assert.deepStrictEqual(user(), { Ops: { TP: { host: "kdb1", port: 1 } } });
  });

  test("a password's stored once the server's saved, and not for a save refused", async () => {
    await setUser({ TP: { host: "kdb1", port: 1 } });
    await setWorkspace({ TP: { host: "kdb2", port: 1 } });
    const kept: Record<string, string> = {};
    const { made, forms } = open(kept);
    forms.edit(["TP"]);
    await made[0].loaded();
    const unsaved = refusing(
      (target) => target === vscode.ConfigurationTarget.Workspace,
      async () => {
        made[0].say({ type: "save", form: { ...prod, name: "RDB" } });
        return made[0].next();
      },
    );
    assert.strictEqual((await unsaved).type, "unsaved");
    assert.deepStrictEqual(kept, {});
    made[0].say({ type: "save", form: { ...prod, name: "RDB" } });
    await made[0].closing;
    assert.deepStrictEqual(kept, { "password:@kdb2:1": "secret" });
  });

  test("Remove takes a server from both", async () => {
    await setUser({ TP: { host: "kdb1", port: 1 } });
    await setWorkspace({ TP: { host: "kdb2", port: 1 } });
    await removeServer(connections, open().forms, rowAt(["TP"]));
    assert.strictEqual(
      (warned[0][1] as { detail: string }).detail,
      "It's removed from your User and Workspace settings.",
    );
    assert.deepStrictEqual(user(), {});
    assert.deepStrictEqual(workspace(), {});
  });

  test("Remove Folder takes a folder in both from each", async () => {
    await setUser({ Prod: { TP: { host: "kdb1", port: 1 } } });
    await setWorkspace({
      Prod: { TP: { host: "kdb2", port: 1 }, RDB: { host: "kdb3", port: 1 } },
    });
    await removeFolder(connections, open().forms, rowAt(["Prod"]));
    assert.strictEqual(
      (warned[0][1] as { detail: string }).detail,
      "It and the 2 servers in it are removed from your User and Workspace settings.",
    );
    assert.deepStrictEqual(user(), {});
    assert.deepStrictEqual(workspace(), {});
  });

  test("Move refuses a folder not in each scope the server's in, as Add does", async () => {
    await setUser({ Mine: {} });
    await setWorkspace({ TP: { host: "kdb1", port: 1 } });
    await moveTo(connections, open().forms, rowAt(["TP"]), ["Mine"]);
    assert.deepStrictEqual(warned, [
      ["kdb+/q: TP wasn't moved: Mine isn't in Workspace settings"],
    ]);
    assert.deepStrictEqual(user(), { Mine: {} });
    assert.deepStrictEqual(workspace(), { TP: { host: "kdb1", port: 1 } });
  });

  test("Add saves where its folder is, and offers both only where there are both", async () => {
    await setUser({ Both: {}, Mine: {} });
    await setWorkspace({ Both: {}, Team: {} });
    const { made, forms } = open();
    const offered: [string[], string[], Form["target"]][] = [];
    for (const folder of [[], ["Both"], ["Mine"], ["Team"]]) {
      forms.add(folder);
      const tab = made.at(-1) as (typeof made)[number];
      const { context, form } = await tab.loaded();
      offered.push([folder, context.targets, form.target]);
      tab.panel.dispose();
    }
    assert.deepStrictEqual(offered, [
      [[], ["user", "workspace"], "user"],
      [["Both"], ["user", "workspace"], "user"],
      [["Mine"], ["user"], "user"],
      [["Team"], ["workspace"], "workspace"],
    ]);
    forms.add(["Team"]);
    const tab = made.at(-1) as (typeof made)[number];
    const { form } = await tab.loaded();
    tab.say({ type: "save", form: { ...prod, target: form.target } });
    await tab.closing;
    assert.deepStrictEqual(user(), { Both: {}, Mine: {} });
    assert.deepStrictEqual(workspace(), {
      Both: {},
      Team: { TP: { host: "kdb2", port: 1, auth: "store" } },
    });
  });

  test("Add refuses to save where its folder no longer is", async () => {
    await setUser({ Prod: {} });
    await setWorkspace({ Prod: {} });
    const { made, forms } = open();
    forms.add(["Prod"]);
    await made[0].loaded();
    const next = made[0].next();
    await setWorkspace(undefined);
    assert.deepStrictEqual(
      ((await next) as Extract<ToForm, { type: "load" }>).context.targets,
      ["user"],
    );
    made[0].say({ type: "save", form: { ...prod, target: "workspace" } });
    assert.deepStrictEqual(await made[0].next(), {
      type: "unsaved",
      text: "not saved, as Prod is no longer in Workspace settings",
    });
    assert.strictEqual(workspace(), undefined);
  });

  test("a save is refused if its folder leaves a scope while it's checked, and keeps no password", async () => {
    await setUser({ Prod: {} });
    await setWorkspace({ Prod: {}, Team: {} });
    const kept: Record<string, string> = {};
    // The settings change while the form checks for a stored password
    let change: (() => Thenable<void>) | undefined;
    const { made, panels } = tabs();
    forms = new ServerForms(
      vscode.Uri.file("/extension"),
      {
        ...secrets(kept),
        get: async (key: string) => {
          await change?.();
          change = undefined;
          return kept[key];
        },
      } as vscode.SecretStorage,
      connections,
      async () => undefined,
      panels,
    );
    // What a save's refused with, past anything else posted
    const refused = async (tab: (typeof made)[number]) => {
      for (;;) {
        const message = await tab.next();
        if (message.type === "unsaved") {
          return message.text;
        }
      }
    };
    forms.add(["Prod"]);
    await made[0].loaded();
    change = () => setWorkspace({ Team: {} });
    let text = refused(made[0]);
    made[0].say({ type: "save", form: { ...prod, target: "workspace" } });
    assert.strictEqual(
      await text,
      "not saved, as Prod is no longer in Workspace settings",
    );
    made[0].panel.dispose();
    forms.add(["Team"]);
    await made[1].loaded();
    change = () => setWorkspace(undefined);
    text = refused(made[1]);
    made[1].say({ type: "save", form: { ...prod, target: "workspace" } });
    assert.strictEqual(
      await text,
      "not saved, as Team is no longer in settings",
    );
    assert.deepStrictEqual(kept, {});
    assert.deepStrictEqual(user(), { Prod: {} });
  });
});
