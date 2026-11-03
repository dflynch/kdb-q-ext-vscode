import * as assert from "node:assert";
import * as vscode from "vscode";
import { clearPassword, editServer, removeServer } from "../commands";
import type { Connection } from "../connection";
import { Connections } from "../connections";
import { blank, type Form, type ToForm } from "../form/fields";
import { formType, type Opener, ServerForms } from "../serverForm";
import type * as servers from "../servers";
import { config, refusing, secrets, setUser, tabs, user } from "./helpers";

const extension = vscode.Uri.file("/extension");

// An opener that's never used
const nowhere: Opener = async () => {
  throw new Error("not opened");
};

const prod: Form = {
  ...blank(),
  name: "prod",
  host: "kdb1.example.com",
  port: "5010",
  user: "admin",
  auth: "store",
  password: "secret",
  timeout: "",
};

suite("the server form", () => {
  const connections = new Connections<Connection>(async () => undefined);
  let forms: ServerForms | undefined;

  teardown(async () => {
    forms?.dispose();
    await setUser(undefined);
  });

  function open(
    kept: Record<string, string> = {},
    opener = nowhere,
    connected = connections,
  ) {
    const { made, panels } = tabs();
    forms = new ServerForms(
      extension,
      secrets(kept),
      connected,
      opener,
      panels,
    );
    return { made, forms };
  }

  test("Add opens a blank form in a tab, once", async () => {
    const { made, forms } = open();
    forms.add();
    forms.add();
    assert.strictEqual(made.length, 1);
    assert.strictEqual(made[0].type, formType);
    assert.strictEqual(made[0].title, "Add Server");
    assert.strictEqual(made[0].revealed, 1);
    const loaded = await made[0].loaded();
    assert.deepStrictEqual(loaded.form, blank());
    assert.strictEqual(loaded.stored, false);
    assert.strictEqual(loaded.context.editing, undefined);
  });

  test("the form's told the TLS files set, by their names", async () => {
    const global = vscode.ConfigurationTarget.Global;
    await config().update("tlsCaFile", "~/tls/ca.pem", global);
    await config().update("tlsKeyFile", "", global);
    try {
      const { made, forms } = open();
      forms.add();
      assert.deepStrictEqual((await made[0].loaded()).context.tlsFiles, [
        "ca.pem",
      ]);
    } finally {
      await config().update("tlsCaFile", undefined, global);
      await config().update("tlsKeyFile", undefined, global);
    }
  });

  test("a server added is written in its folder, and its password stored", async () => {
    await setUser({ old: { host: "kdb0", port: 1 }, Prod: {} });
    const kept: Record<string, string> = {};
    const { made, forms } = open(kept);
    forms.add(["Prod"]);
    const { context } = await made[0].loaded();
    assert.deepStrictEqual(context.folder, ["Prod"]);
    assert.deepStrictEqual(context.taken, []);
    made[0].say({
      type: "save",
      form: { ...prod, name: " TP " },
    });
    await made[0].closing;
    assert.deepStrictEqual(user(), {
      old: { host: "kdb0", port: 1 },
      Prod: {
        TP: {
          host: "kdb1.example.com",
          port: 5010,
          user: "admin",
          auth: "store",
        },
      },
    });
    assert.deepStrictEqual(kept, {
      "password:admin@kdb1.example.com:5010": "secret",
    });
  });

  test("a server edited is shown as written, with its password stored", async () => {
    await setUser({
      Prod: {
        TP: {
          host: "kdb1.example.com",
          port: 5010,
          user: "admin",
          auth: "store",
        },
      },
    });
    const { made, forms } = open({
      "password:admin@kdb1.example.com:5010": "secret",
    });
    forms.edit(["Prod", "TP"]);
    assert.strictEqual(made[0].title, "Edit Prod › TP");
    const loaded = await made[0].loaded();
    assert.deepStrictEqual(loaded.form, {
      ...prod,
      name: "TP",
      password: "",
    });
    assert.strictEqual(loaded.stored, true);
    assert.strictEqual(loaded.context.editing, "TP");
    assert.deepStrictEqual(loaded.context.scopes, ["user"]);
  });

  test("a rename keeps the server's place, and its password", async () => {
    await setUser({
      a: { host: "a", port: 1 },
      prod: { host: "kdb1.example.com", port: 5010, user: "admin" },
      c: { host: "c", port: 1 },
    });
    const kept = { "password:admin@kdb1.example.com:5010": "secret" };
    const { made, forms } = open(kept);
    forms.edit(["prod"]);
    const { form, context } = await made[0].loaded();
    // Its own name isn't taken
    assert.deepStrictEqual(context.taken, ["a", "c"]);
    made[0].say({
      type: "save",
      form: { ...form, name: "live" },
    });
    await made[0].closing;
    assert.deepStrictEqual(Object.keys(user() as object), ["a", "live", "c"]);
    assert.deepStrictEqual(kept, {
      "password:admin@kdb1.example.com:5010": "secret",
    });
  });

  test("a server renamed while it's connected is disconnected", async () => {
    await setUser({ prod: { host: "kdb1", port: 1 } });
    const link = { closed: new Promise<Error>(() => {}), close: () => {} };
    const connected = new Connections<Connection>(
      async () => link as unknown as Connection,
    );
    await connected.connect({ path: ["prod"], host: "kdb1", port: 1 });
    const { made, forms } = open({}, nowhere, connected);
    forms.edit(["prod"]);
    const { form } = await made[0].loaded();
    made[0].say({ type: "save", form: { ...form, name: "live" } });
    await made[0].closing;
    assert.deepStrictEqual(connected.servers, []);
  });

  test("a form's saved once, however often Save is pressed", async () => {
    const { made, forms } = open();
    forms.add();
    await made[0].loaded();
    made[0].say({ type: "save", form: prod });
    made[0].say({ type: "save", form: prod });
    await made[0].closing;
    // The second would have found the first's server already there
    assert.ok(made[0].posted.every((message) => message.type !== "unsaved"));
    assert.deepStrictEqual(Object.keys(user() as object), ["prod"]);
  });

  test("closing the tab stops a test", async () => {
    let signal: AbortSignal | undefined;
    const { made, forms } = open({}, (_, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });
    forms.add();
    await made[0].loaded();
    made[0].say({ type: "test", form: prod });
    while (signal === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.strictEqual(signal.aborted, false);
    made[0].panel.dispose();
    assert.strictEqual(signal.aborted, true);
  });

  test("a form isn't loaded again for a change to something else", async () => {
    await setUser({ prod: { host: "kdb1", port: 1 } });
    const global = vscode.ConfigurationTarget.Global;
    const { made, forms } = open();
    forms.edit(["prod"]);
    await made[0].loaded();
    const next = made[0].next();
    try {
      await config().update("precision", 3, global);
      await setUser({ prod: { host: "kdb2", port: 1 } });
      // The first thing posted is the server's change
      assert.strictEqual(
        ((await next) as Extract<ToForm, { type: "load" }>).form.host,
        "kdb2",
      );
    } finally {
      await config().update("precision", undefined, global);
    }
  });

  test("a password's kept when its server's edited away from it, as another workspace's may get it", async () => {
    await setUser({ prod: { host: "kdb1", port: 1, auth: "store" } });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit(["prod"]);
    const { form } = await made[0].loaded();
    made[0].say({
      type: "save",
      form: { ...form, host: "kdb2", password: "other" },
    });
    await made[0].closing;
    forms.edit(["prod"]);
    const second = await made[1].loaded();
    made[1].say({ type: "save", form: { ...second.form, auth: "none" } });
    await made[1].closing;
    assert.deepStrictEqual(kept, {
      "password:@kdb1:1": "secret",
      "password:@kdb2:1": "other",
    });
  });

  test("None holds for a server sharing its login with one that stores it", async () => {
    const login = { host: "kdb1", port: 1, auth: "store" };
    await setUser({ a: login, b: login });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit(["a"]);
    const { form } = await made[0].loaded();
    made[0].say({ type: "save", form: { ...form, auth: "none" } });
    await made[0].closing;
    // b still gets it, and a has none
    assert.deepStrictEqual(kept, { "password:@kdb1:1": "secret" });
    assert.deepStrictEqual((user() as Record<string, unknown>).a, {
      host: "kdb1",
      port: 1,
    });
    forms.edit(["a"]);
    assert.strictEqual((await made[1].loaded()).form.auth, "none");
  });

  test("whether a password's stored is answered for the login typed", async () => {
    const { made, forms } = open({ "password:admin@kdb1:5010": "secret" });
    forms.add();
    await made[0].loaded();
    const ask = async (login: { user: string; host: string; port: string }) => {
      const next = made[0].next();
      made[0].say({ type: "lookup", login });
      return next;
    };
    assert.deepStrictEqual(
      await ask({ user: " admin ", host: "KDB1", port: "5010" }),
      {
        type: "stored",
        login: { user: " admin ", host: "KDB1", port: "5010" },
        stored: true,
      },
    );
    assert.strictEqual(
      (
        (await ask({ user: "", host: "kdb1", port: "5010" })) as {
          stored: boolean;
        }
      ).stored,
      false,
    );
    assert.strictEqual(
      (
        (await ask({ user: "admin", host: "kdb1", port: "x" })) as {
          stored: boolean;
        }
      ).stored,
      false,
    );
  });

  test("a form is loaded again as the settings change, or told its server's gone", async () => {
    await setUser({ prod: { host: "kdb1", port: 1 } });
    const { made, forms } = open();
    forms.edit(["prod"]);
    await made[0].loaded();
    let next = made[0].next();
    await setUser({ prod: { host: "kdb2", port: 1 } });
    assert.strictEqual(
      ((await next) as Extract<ToForm, { type: "load" }>).form.host,
      "kdb2",
    );
    next = made[0].next();
    await setUser({});
    assert.deepStrictEqual(await next, { type: "gone", path: ["prod"] });
    made[0].say({ type: "save", form: { ...prod, name: "prod" } });
    assert.deepStrictEqual(await made[0].next(), {
      type: "unsaved",
      text: "not saved, as prod is no longer in settings",
    });
    assert.deepStrictEqual(user(), {});
  });

  test("a form adding to a folder is told the folder's gone, and doesn't bring it back", async () => {
    await setUser({ Prod: { TP: { host: "kdb1", port: 1 } } });
    const { made, forms } = open();
    forms.add(["Prod"]);
    await made[0].loaded();
    const next = made[0].next();
    await setUser({ Dev: { TP: { host: "kdb1", port: 1 } } });
    assert.deepStrictEqual(await next, { type: "gone", path: ["Prod"] });
    made[0].say({ type: "save", form: { ...prod, name: "RDB" } });
    assert.deepStrictEqual(await made[0].next(), {
      type: "unsaved",
      text: "not saved, as Prod is no longer in settings",
    });
    assert.deepStrictEqual(user(), { Dev: { TP: { host: "kdb1", port: 1 } } });
  });

  test("a form adding to a folder is gone with its parent, or as a server takes its place", async () => {
    await setUser({ Prod: { EU: {} } });
    const { made, forms } = open();
    forms.add(["Prod", "EU"]);
    await made[0].loaded();
    let next = made[0].next();
    await setUser({ Live: { EU: {} } });
    assert.deepStrictEqual(await next, { type: "gone", path: ["Prod", "EU"] });
    forms.dispose();
    await setUser({ Prod: {} });
    const again = open();
    again.forms.add(["Prod"]);
    await again.made[0].loaded();
    next = again.made[0].next();
    await setUser({ Prod: { host: "kdb1", port: 1 } });
    assert.deepStrictEqual(await next, { type: "gone", path: ["Prod"] });
  });

  test("Add replaces a form whose folder's gone, and only that", async () => {
    await setUser({ Prod: {}, Dev: {} });
    const { made, forms } = open();
    forms.add(["Prod"]);
    await made[0].loaded();
    forms.add(["Dev"]);
    assert.strictEqual(made.length, 1);
    const next = made[0].next();
    await setUser({ Dev: {} });
    await next;
    forms.add(["Dev"]);
    assert.strictEqual(made[0].closed, true);
    assert.strictEqual(made.length, 2);
    assert.deepStrictEqual((await made[1].loaded()).context.folder, ["Dev"]);
  });

  test("a form adding to the top level is never gone", async () => {
    await setUser({ prod: { host: "kdb1", port: 1 } });
    const { made, forms } = open();
    forms.add();
    await made[0].loaded();
    const next = made[0].next();
    await setUser({});
    assert.strictEqual((await next).type, "load");
  });

  test("closing a folder closes the forms adding to it, or in it, and no others", async () => {
    await setUser({
      Prod: { EU: { TP: { host: "kdb1", port: 1 } } },
      Dev: {},
    });
    const { made, forms } = open();
    forms.add(["Prod", "EU"]);
    forms.edit(["Prod", "EU", "TP"]);
    forms.close(["Prod"]);
    assert.deepStrictEqual(
      made.map(({ closed }) => closed),
      [true, true],
    );
    forms.add(["Dev"]);
    forms.close(["Prod"]);
    forms.close(["Dev", "TP"]);
    assert.strictEqual(made[2].closed, false);
  });

  test("a server with a problem opens as written, with it, and saving fixes it", async () => {
    await setUser({
      Dev: { TP: { hots: "dev", port: 5010, user: "admin", auth: "store" } },
    });
    const { made, forms } = open({ "password:admin@:5010": "secret" });
    forms.edit(["Dev", "TP"]);
    const { form, context, stored } = await made[0].loaded();
    assert.deepStrictEqual(form, {
      ...blank(),
      name: "TP",
      host: "",
      port: "5010",
      user: "admin",
      auth: "store",
      timeout: "",
    });
    assert.strictEqual(context.problem, "unknown field: hots");
    assert.deepStrictEqual(context.scopes, ["user"]);
    // Not stored for a login with no host
    assert.strictEqual(stored, false);
    made[0].say({
      type: "save",
      form: { ...form, host: "dev", password: "secret" },
    });
    await made[0].closing;
    assert.deepStrictEqual(user(), {
      Dev: { TP: { host: "dev", port: 5010, user: "admin", auth: "store" } },
    });
  });

  test("anything in a folder that's not a server or a folder opens with its name", async () => {
    await setUser({ rdb: "dev:5011" });
    const { made, forms } = open();
    forms.edit(["rdb"]);
    const { form, context } = await made[0].loaded();
    assert.deepStrictEqual(form, { ...blank(), name: "rdb", timeout: "" });
    assert.strictEqual(context.problem, "not a server or a folder");
  });

  test("a form with a problem isn't saved, and says why", async () => {
    await setUser({ old: { host: "kdb0", port: 1 } });
    const { made, forms } = open();
    forms.add();
    await made[0].loaded();
    const next = made[0].next();
    made[0].say({
      type: "save",
      form: { ...prod, name: "old" },
    });
    assert.deepStrictEqual(await next, {
      type: "unsaved",
      text: "not saved, as name: old already exists",
    });
    assert.strictEqual(made[0].closed, false);
    assert.deepStrictEqual(user(), { old: { host: "kdb0", port: 1 } });
  });

  test("Test connects as the form has the server, and closes again", async () => {
    const opened: unknown[][] = [];
    let closed = 0;
    let answer: "open" | "cancel" | Error = "open";
    const { made, forms } = open({}, async (server, options) => {
      opened.push([server, options?.typed]);
      if (answer instanceof Error) {
        throw answer;
      }
      return answer === "cancel" ? undefined : { close: () => closed++ };
    });
    forms.add(["Prod"]);
    await made[0].loaded();
    const tried = async (form: Form) => {
      const next = made[0].next();
      made[0].say({ type: "test", form });
      return next;
    };
    assert.deepStrictEqual(await tried({ ...prod, name: "TP" }), {
      type: "tested",
      ok: true,
      text: "Connected to kdb1.example.com:5010",
    });
    assert.deepStrictEqual(opened, [
      [
        {
          path: ["Prod", "TP"],
          host: "kdb1.example.com",
          port: 5010,
          user: "admin",
          auth: "store",
        },
        "secret",
      ],
    ]);
    assert.strictEqual(closed, 1);
    // A password's only given to store one
    await tried({ ...prod, auth: "prompt" });
    assert.strictEqual(opened[1][1], undefined);
    answer = new Error("hop. OS reports: Connection refused");
    assert.deepStrictEqual(await tried(prod), {
      type: "tested",
      ok: false,
      text: "kdb1.example.com:5010: hop. OS reports: Connection refused",
    });
    answer = "cancel";
    assert.deepStrictEqual(await tried(prod), {
      type: "tested",
      ok: false,
      text: "Cancelled",
    });
    assert.deepStrictEqual(await tried({ ...prod, port: "" }), {
      type: "tested",
      ok: false,
      text: "not tested, as port: Required",
    });
    // A test needs no name: one missing or taken connects as test
    answer = "open";
    await tried({ ...prod, name: "" });
    assert.deepStrictEqual(
      (opened[opened.length - 1][0] as servers.Definition).path,
      ["Prod", "test"],
    );
    // Nothing's written
    assert.strictEqual(user(), undefined);
    assert.strictEqual(made[0].closed, false);
  });

  test("Cancel closes the form", async () => {
    const { made, forms } = open();
    forms.add();
    made[0].say({ type: "cancel" });
    await made[0].closing;
  });
});

suite("editServer and removeServer", () => {
  const connections = new Connections<Connection>(async () => undefined);
  const window = vscode.window as unknown as Record<string, unknown>;
  const pick = window.showQuickPick;
  const warn = window.showWarningMessage;
  let warned: unknown[][] = [];
  let answer: string | undefined;
  let offered: vscode.QuickPickItem[] = [];

  setup(() => {
    warned = [];
    // The first server offered is picked, past its folders
    window.showQuickPick = async (items: vscode.QuickPickItem[]) => {
      offered = items;
      return items.find(
        (item) => item.kind !== vscode.QuickPickItemKind.Separator,
      );
    };
    window.showWarningMessage = async (...args: unknown[]) => {
      warned.push(args);
      return answer;
    };
  });

  teardown(async () => {
    window.showQuickPick = pick;
    window.showWarningMessage = warn;
    await setUser(undefined);
  });

  test("Edit opens the form of the server picked", async () => {
    await setUser({ Prod: { TP: { host: "kdb1", port: 1 } } });
    const { made, panels } = tabs();
    const forms = new ServerForms(
      extension,
      secrets({}),
      connections,
      nowhere,
      panels,
    );
    try {
      await editServer(forms);
      assert.deepStrictEqual(
        made.map((tab) => tab.title),
        ["Edit Prod › TP"],
      );
    } finally {
      forms.dispose();
    }
  });

  test("servers are offered by their own names, under their folders", async () => {
    await setUser({
      Prod: { trades: { TP: { host: "kdb1", port: 1, user: "admin" } } },
      local: { host: "localhost", port: 5000 },
    });
    const forms = new ServerForms(
      extension,
      secrets({}),
      connections,
      nowhere,
      tabs().panels,
    );
    try {
      await editServer(forms);
      assert.deepStrictEqual(
        offered.map(({ label, kind, description }) => [
          label,
          kind === vscode.QuickPickItemKind.Separator,
          description,
        ]),
        [
          ["Prod › trades", true, undefined],
          ["TP", false, "Prod › trades · admin@kdb1:1"],
          ["", true, undefined],
          ["local", false, "localhost:5000"],
        ],
      );
    } finally {
      forms.dispose();
    }
  });

  test("Remove, once confirmed, removes the server and keeps its password", async () => {
    await setUser({
      Prod: { TP: { host: "kdb1", port: 1, auth: "store" } },
      other: { host: "kdb2", port: 1, auth: "store" },
    });
    const kept: Record<string, string> = {
      "password:@kdb1:1": "secret",
      "password:@kdb2:1": "kept",
    };
    const { made, panels } = tabs();
    const forms = new ServerForms(
      extension,
      secrets(kept),
      connections,
      nowhere,
      panels,
    );
    try {
      forms.edit(["Prod", "TP"]);
      answer = undefined;
      await removeServer(connections, forms);
      assert.strictEqual(warned[0][0], "Remove Prod › TP?");
      assert.deepStrictEqual(warned[0][1], {
        modal: true,
        detail: "It's removed from your User settings.",
      });
      assert.ok(
        user() !== undefined && "TP" in (user() as { Prod: object }).Prod,
      );
      answer = "Remove";
      await removeServer(connections, forms);
      // The folder stays, empty
      assert.deepStrictEqual(user(), {
        Prod: {},
        other: { host: "kdb2", port: 1, auth: "store" },
      });
      // Kept, as a server in another workspace's settings may get it
      assert.ok("password:@kdb1:1" in kept);
      assert.strictEqual(made[0].closed, true);
    } finally {
      forms.dispose();
    }
  });

  test("Clear Server Password lists the passwords stored, with the servers here that get each, and removes the one picked", async () => {
    const login = { host: "kdb1", port: 1, user: "admin", auth: "store" };
    await setUser({
      Prod: { TP: login },
      copy: login,
      gw: { host: "gw", port: 1 },
    });
    const kept: Record<string, string> = {
      "password:admin@kdb1:1": "secret",
      "password:@old:2": "left",
      "passphrase:/key.pem": "other",
    };
    const pick = window.showQuickPick;
    let listed: vscode.QuickPickItem[] = [];
    window.showQuickPick = (async (items: vscode.QuickPickItem[]) => {
      listed = items;
      return items[0];
    }) as typeof pick;
    try {
      await clearPassword(secrets(kept));
    } finally {
      window.showQuickPick = pick;
    }
    assert.deepStrictEqual(
      listed.map(({ label, description }) => [label, description]),
      [
        ["old:2", "no server here"],
        ["admin@kdb1:1", "Prod › TP, copy"],
      ],
    );
    assert.deepStrictEqual(Object.keys(kept), [
      "password:admin@kdb1:1",
      "passphrase:/key.pem",
    ]);
  });

  test("Remove takes the server whose row it's run on, one with a problem too", async () => {
    await setUser({ rdb: "dev:5011", gw: { host: "gw", port: 1 } });
    const forms = new ServerForms(
      extension,
      secrets({}),
      connections,
      nowhere,
      tabs().panels,
    );
    answer = "Remove";
    try {
      await removeServer(connections, forms, { path: ["rdb"] });
    } finally {
      forms.dispose();
    }
    assert.deepStrictEqual(warned[0][0], "Remove rdb?");
    assert.deepStrictEqual(user(), { gw: { host: "gw", port: 1 } });
  });

  test("Remove that can't write the setting leaves the server, and says why", async () => {
    await setUser({ prod: { host: "kdb1", port: 1, auth: "store" } });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const error = window.showErrorMessage;
    const errors: string[] = [];
    window.showErrorMessage = (async (text: string) => {
      errors.push(text);
    }) as typeof error;
    const forms = new ServerForms(
      extension,
      secrets(kept),
      connections,
      nowhere,
      tabs().panels,
    );
    try {
      answer = "Remove";
      await refusing(undefined, () => removeServer(connections, forms));
    } finally {
      window.showErrorMessage = error;
      forms.dispose();
    }
    assert.deepStrictEqual(errors, [
      "kdb+/q: prod wasn't removed from User settings: the file has unsaved changes",
    ]);
    assert.deepStrictEqual(user(), {
      prod: { host: "kdb1", port: 1, auth: "store" },
    });
    assert.deepStrictEqual(kept, { "password:@kdb1:1": "secret" });
  });
});
