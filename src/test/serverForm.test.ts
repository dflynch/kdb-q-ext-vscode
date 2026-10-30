import * as assert from "node:assert";
import * as vscode from "vscode";
import { editServer, removeServer } from "../commands";
import type { Connection } from "../connection";
import { Connections } from "../connections";
import { blank, type Form, type FromForm, type ToForm } from "../form/fields";
import type { Panels } from "../resultView";
import { formType, type Opener, ServerForms } from "../serverForm";

const extension = vscode.Uri.file("/extension");

// Stand-in editor tabs, keeping each one's title and what it's posted, and
// saying what it's told to. Each can wait for the next thing posted, or for
// it to be closed.
function tabs() {
  const made: ReturnType<typeof tab>[] = [];
  const tab = (type: string, title: string) => {
    const posted: ToForm[] = [];
    const waiting: ((message: ToForm) => void)[] = [];
    let say: (message: FromForm) => void = () => {};
    let disposed = () => {};
    let closed = false;
    let revealed = 0;
    const closing = new Promise<void>((resolve) => {
      disposed = () => {
        closed = true;
        resolve();
      };
    });
    const panel = {
      webview: {
        cspSource: "https://source.example",
        options: {},
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: FromForm) => void) => {
          say = listener;
        },
        postMessage: async (message: ToForm) => {
          posted.push(message);
          waiting.shift()?.(message);
          return true;
        },
      },
      reveal: () => {
        revealed += 1;
      },
      onDidDispose: (listener: () => void) => {
        const then = disposed;
        disposed = () => {
          then();
          listener();
        };
      },
      dispose: () => disposed(),
    } as unknown as vscode.WebviewPanel;
    return {
      type,
      title,
      panel,
      posted,
      get closed() {
        return closed;
      },
      get revealed() {
        return revealed;
      },
      closing,
      next: () => new Promise<ToForm>((resolve) => waiting.push(resolve)),
      say: (message: FromForm) => say(message),
      // The form as first loaded
      loaded: async () => {
        const next = new Promise<ToForm>((resolve) => waiting.push(resolve));
        say({ type: "ready" });
        return (await next) as Extract<ToForm, { type: "load" }>;
      },
    };
  };
  const panels = ((type: string, title: string) => {
    const made1 = tab(type, title);
    made.push(made1);
    return made1.panel;
  }) as unknown as Panels;
  return { made, panels };
}

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

// An opener that's never used
const nowhere: Opener = async () => {
  throw new Error("not opened");
};

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");
const user = () => config().inspect("servers")?.globalValue;
const setUser = (value: unknown) =>
  config().update("servers", value, vscode.ConfigurationTarget.Global);

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
    forms.edit("Prod/TP");
    assert.strictEqual(made[0].title, "Edit TP");
    const loaded = await made[0].loaded();
    assert.deepStrictEqual(loaded.form, {
      ...prod,
      name: "TP",
      password: "",
    });
    assert.strictEqual(loaded.stored, true);
    assert.strictEqual(loaded.context.editing, "Prod/TP");
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
    forms.edit("prod");
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
    await connected.connect({ name: "prod", host: "kdb1", port: 1 });
    const { made, forms } = open({}, nowhere, connected);
    forms.edit("prod");
    const { form } = await made[0].loaded();
    made[0].say({ type: "save", form: { ...form, name: "live" } });
    await made[0].closing;
    assert.deepStrictEqual(connected.names, []);
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
    forms.edit("prod");
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

  test("a password no server gets any more is forgotten, unless another does", async () => {
    const login = {
      host: "kdb1.example.com",
      port: 5010,
      user: "admin",
      auth: "store",
    };
    await setUser({ prod: login, copy: login });
    const kept: Record<string, string> = {
      "password:admin@kdb1.example.com:5010": "secret",
    };
    const { made, forms } = open(kept);
    forms.edit("prod");
    const { form } = await made[0].loaded();
    made[0].say({
      type: "save",
      form: { ...form, host: "kdb2.example.com", password: "other" },
    });
    await made[0].closing;
    // copy still gets the first
    assert.deepStrictEqual(kept, {
      "password:admin@kdb1.example.com:5010": "secret",
      "password:admin@kdb2.example.com:5010": "other",
    });
    forms.edit("copy");
    const second = await made[1].loaded();
    made[1].say({
      type: "save",
      form: { ...second.form, auth: "prompt" },
    });
    await made[1].closing;
    assert.deepStrictEqual(kept, {
      "password:admin@kdb2.example.com:5010": "other",
    });
  });

  test("None forgets the password stored for the login", async () => {
    await setUser({ prod: { host: "kdb1", port: 1, auth: "store" } });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit("prod");
    const { form } = await made[0].loaded();
    made[0].say({
      type: "save",
      form: { ...form, auth: "none" },
    });
    await made[0].closing;
    assert.deepStrictEqual(kept, {});
  });

  test("None holds for a server sharing its login with one that stores it", async () => {
    const login = { host: "kdb1", port: 1, auth: "store" };
    await setUser({ a: login, b: login });
    const kept: Record<string, string> = { "password:@kdb1:1": "secret" };
    const { made, forms } = open(kept);
    forms.edit("a");
    const { form } = await made[0].loaded();
    made[0].say({ type: "save", form: { ...form, auth: "none" } });
    await made[0].closing;
    // b still gets it, and a has none
    assert.deepStrictEqual(kept, { "password:@kdb1:1": "secret" });
    assert.deepStrictEqual((user() as Record<string, unknown>).a, {
      host: "kdb1",
      port: 1,
    });
    forms.edit("a");
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
    forms.edit("prod");
    await made[0].loaded();
    let next = made[0].next();
    await setUser({ prod: { host: "kdb2", port: 1 } });
    assert.strictEqual(
      ((await next) as Extract<ToForm, { type: "load" }>).form.host,
      "kdb2",
    );
    next = made[0].next();
    await setUser({});
    assert.deepStrictEqual(await next, { type: "gone" });
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
          name: "Prod/TP",
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
    assert.strictEqual(
      (opened[opened.length - 1][0] as { name: string }).name,
      "Prod/test",
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

  setup(() => {
    warned = [];
    // The first server offered is picked
    window.showQuickPick = async (items: { label: string }[]) => items[0];
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
        ["Edit TP"],
      );
    } finally {
      forms.dispose();
    }
  });

  test("Remove, once confirmed, removes the server and forgets its password", async () => {
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
      forms.edit("Prod/TP");
      answer = undefined;
      await removeServer(secrets(kept), connections, forms);
      assert.strictEqual(warned[0][0], "Remove Prod/TP?");
      assert.deepStrictEqual(warned[0][1], {
        modal: true,
        detail: "It's removed from your user settings.",
      });
      assert.ok(
        user() !== undefined && "TP" in (user() as { Prod: object }).Prod,
      );
      answer = "Remove";
      await removeServer(secrets(kept), connections, forms);
      // The folder stays, empty
      assert.deepStrictEqual(user(), {
        Prod: {},
        other: { host: "kdb2", port: 1, auth: "store" },
      });
      assert.deepStrictEqual(kept, { "password:@kdb2:1": "kept" });
      assert.strictEqual(made[0].closed, true);
    } finally {
      forms.dispose();
    }
  });
});
