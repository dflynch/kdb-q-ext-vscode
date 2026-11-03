import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Connection } from "./connection";
import type { Connections } from "./connections";
import {
  blank,
  type Context,
  type Form,
  type FromForm,
  fromSetting,
  type Login,
  port,
  problems,
  type Scope,
  scopeName,
  type ToForm,
  toSetting,
} from "./form/fields";
import { type Panels, page } from "./resultView";
import * as servers from "./servers";
import * as tls from "./tls";

// The server form's editor tab
export const formType = "kdb-q-ext-vscode.serverForm";

// Opens a connection to a server, with a password typed in place of the
// one stored, if one's given: the extension's opener, or a stand-in for
// tests. Undefined if asking for a password was cancelled, or the signal's
// aborted.
export type Opener = (
  server: servers.Definition,
  options?: { typed?: string; signal?: AbortSignal },
) => Promise<{ close(): void } | undefined>;

// A form open in a tab: for a server to add to a folder, or for one to
// edit, by its path as it was
type Open = {
  panel: vscode.WebviewPanel;
  folder: string[];
  editing?: string[];
  // Aborted as the tab closes, stopping a test
  closing: AbortController;
  // Whether it's being saved, so that it's neither saved again nor told
  // of the change its own save makes
  saving?: boolean;
  // The last load posted, so that a change to the settings that doesn't
  // change it isn't posted again
  loaded?: string;
};

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");

// The servers setting in each scope, as written there
export function scopes(): servers.Written {
  const inspected = config().inspect("servers");
  return { user: inspected?.globalValue, workspace: inspected?.workspaceValue };
}

// The scopes a server, or a folder, is written in. A server in both is the
// workspace's, the user's kept but not used; a folder in both holds what
// each has. A server with a problem counts, whatever's written.
export function scopesOf(
  path: string[],
  kind: servers.Entry["kind"] = "server",
): Scope[] {
  const written = scopes();
  return (["user", "workspace"] as const).filter(
    (scope) => servers.kindAt(written[scope], path) === kind,
  );
}

// The scopes something new in a folder can be written in: those the folder
// is in, or at the top level, each there is
export function targetsIn(folder: string[]): Scope[] {
  if (vscode.workspace.workspaceFolders === undefined) {
    return ["user"];
  }
  return folder.length === 0
    ? ["user", "workspace"]
    : scopesOf(folder, "folder");
}

// Whether the server a form edits, or the folder it adds to, has gone from
// the settings. The top level is never gone.
function gone({ folder, editing }: Pick<Open, "folder" | "editing">) {
  const merged = servers.merged(scopes());
  return editing
    ? servers.kindAt(merged, editing) !== "server"
    : folder.length > 0 && servers.kindAt(merged, folder) !== "folder";
}

// What a form would save to that's no longer in the settings: the server
// edited, or the folder added to, or that folder in the scope picked
function missingFrom(
  open: Pick<Open, "folder" | "editing">,
  target: Scope,
): string | undefined {
  if (gone(open)) {
    return `${servers.shown(open.editing ?? open.folder)} is no longer in settings`;
  }
  if (open.editing === undefined && !targetsIn(open.folder).includes(target)) {
    return `${servers.shown(open.folder)} is no longer in ${scopeName(target)} settings`;
  }
  return undefined;
}

const targets = {
  user: vscode.ConfigurationTarget.Global,
  workspace: vscode.ConfigurationTarget.Workspace,
};

// Write a server, or delete it for undefined, at its path in one scope's
// setting, renamed from another name in the same folder or not
export async function write(
  scope: Scope,
  path: string[],
  value: unknown,
  from?: string,
) {
  const setting = scopes()[scope] ?? {};
  if (!servers.isObject(setting)) {
    throw new Error("the servers setting must be an object");
  }
  await config().update(
    "servers",
    servers.put(setting, path, value, from),
    targets[scope],
  );
}

// Write as write does, saying in which scope it failed: a save writing
// two may have written the first
async function writeIn(
  scope: Scope,
  path: string[],
  value: unknown,
  from?: string,
) {
  try {
    await write(scope, path, value, from);
  } catch (error) {
    throw new Error(
      `not saved in ${scopeName(scope)} settings: ${(error as Error).message}`,
    );
  }
}

// Move a server or a folder from one path to another in one scope's
// setting, in one write. Renamed in the same folder, it keeps its place.
export async function move(scope: Scope, from: string[], to: string[]) {
  const setting = scopes()[scope] ?? {};
  if (!servers.isObject(setting)) {
    throw new Error("the servers setting must be an object");
  }
  const value = servers.at(setting, from);
  const renamed = servers.id(from.slice(0, -1)) === servers.id(to.slice(0, -1));
  await config().update(
    "servers",
    renamed
      ? servers.put(setting, to, value, from.at(-1))
      : servers.put(servers.put(setting, from, undefined), to, value),
    targets[scope],
  );
}

// The servers setting in a scope's settings.json, where it can be edited as
// written, as the Settings editor can't edit an object
export async function openServers(scope: Scope) {
  await vscode.commands.executeCommand(
    scope === "workspace"
      ? "workbench.action.openWorkspaceSettingsFile"
      : "workbench.action.openSettingsJson",
    { revealSetting: { key: "kdb-q-ext-vscode.servers" } },
  );
}

// The passwords the server at a path, or those in the folder there, get
// from secure storage, as each scope writes them: one the workspace's hides
// too. A folder's read from what it holds, as one with no name has none
// of its own.
export function storedKeys(path: string[]): string[] {
  const written = scopes();
  return (["user", "workspace"] as const).flatMap((scope) => {
    const value = servers.at(written[scope], path);
    if (value === undefined) {
      return [];
    }
    const found =
      servers.kindAt(written[scope], path) === "folder"
        ? servers.entries(value as Record<string, unknown>, path)
        : servers.entries({ [path.at(-1) ?? ""]: value }, path.slice(0, -1));
    return servers
      .everything(found)
      .flatMap((entry) =>
        entry.kind === "server" && entry.server?.auth === "store"
          ? [servers.secretKey(entry.server)]
          : [],
      );
  });
}

// Delete the passwords no server still gets from secure storage: several
// servers with the same user, host and port share one. One the workspace's
// hides still counts, as it's every other workspace's. Those of other
// workspaces' settings can't be seen.
export async function forget(
  secrets: vscode.SecretStorage,
  keys: Iterable<string>,
) {
  const used = new Set(stored().map(servers.secretKey));
  for (const key of keys) {
    if (!used.has(key)) {
      await secrets.delete(key);
    }
  }
}

// The servers whose password is stored, in every scope
function stored(): servers.Definition[] {
  const written = scopes();
  return (["user", "workspace"] as const).flatMap((scope) =>
    servers
      .definitions(written[scope])
      .servers.filter((server) => server.auth === "store"),
  );
}

// Where a password typed for a login would be kept, if the login's
// complete enough to have one
function keyFor(login: Login): string | undefined {
  const at = port(login.port);
  return at === undefined || login.host.trim() === ""
    ? undefined
    : servers.secretKey({
        host: login.host.trim(),
        port: at,
        ...(login.user.trim() === "" ? {} : { user: login.user.trim() }),
      });
}

// Add and Edit Server's forms, each in an editor tab: one for each server
// edited, brought forward if it's open already, and one to add a server.
// A hidden tab keeps what's typed in it.
export class ServerForms implements vscode.Disposable {
  private forms = new Map<string, Open>();
  private listening: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly connections: Connections<Connection>,
    private readonly opener: Opener,
    private readonly panels: Panels = vscode.window.createWebviewPanel,
  ) {
    // Each form shows the settings as they are, or keeps what's typed and
    // offers to reload
    this.listening = vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration("kdb-q-ext-vscode")) {
        for (const open of this.forms.values()) {
          this.load(open);
        }
      }
    });
  }

  // The form to add a server to a folder, replacing one whose folder's gone
  add(folder: string[] = []) {
    const shown = this.forms.get("");
    if (shown && gone(shown)) {
      this.forms.delete("");
      shown.panel.dispose();
    }
    this.show("", { folder }, "Add Server");
  }

  // The form to edit a server, by its path, which its tab's title gives,
  // as servers in different folders can have the same name
  edit(path: string[]) {
    this.show(
      servers.id(path),
      { folder: path.slice(0, -1), editing: path },
      `Edit ${servers.shown(path)}`,
    );
  }

  // Close a server's form, or those of every server in a folder and those
  // adding to it, as when it's removed
  close(path: string[]) {
    for (const { panel, folder, editing } of [...this.forms.values()]) {
      if (servers.within(editing ?? folder, path)) {
        panel.dispose();
      }
    }
  }

  dispose() {
    this.listening.dispose();
    for (const { panel } of [...this.forms.values()]) {
      panel.dispose();
    }
  }

  private show(
    id: string,
    of: Pick<Open, "folder" | "editing">,
    title: string,
  ) {
    const shown = this.forms.get(id);
    if (shown) {
      shown.panel.reveal();
      return;
    }
    const panel = this.panels(formType, title, vscode.ViewColumn.Active, {
      retainContextWhenHidden: true,
    });
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "icons", "q-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "icons", "q-dark.svg"),
    };
    const open: Open = { panel, ...of, closing: new AbortController() };
    this.forms.set(id, open);
    panel.onDidDispose(() => {
      open.closing.abort();
      if (this.forms.get(id) === open) {
        this.forms.delete(id);
      }
    });
    panel.webview.onDidReceiveMessage((message: FromForm) =>
      this.heard(open, message).catch((error: Error) =>
        vscode.window.showErrorMessage(`kdb+/q: ${error.message}`),
      ),
    );
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist");
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = page(
      panel.webview.cspSource,
      randomBytes(16).toString("base64"),
      panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "form.js")),
      panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, "form.css")),
    );
  }

  private async heard(open: Open, message: FromForm) {
    const post = (message: ToForm) => this.post(open, message);
    switch (message.type) {
      case "ready":
        open.loaded = undefined;
        return this.load(open);
      case "lookup":
        return post({
          type: "stored",
          login: message.login,
          stored: await this.stored(keyFor(message.login)),
        });
      case "save":
        return this.save(open, message.form);
      case "test":
        return post({
          type: "tested",
          ...(await this.test(open, message.form)),
        });
      case "cancel":
        return open.panel.dispose();
      case "open":
        return this.openSetting(open, message.setting);
    }
  }

  // A tab that's closed is told nothing
  private async post(open: Open, message: ToForm) {
    if (!open.closing.signal.aborted) {
      await open.panel.webview.postMessage(message);
    }
  }

  private async stored(key: string | undefined): Promise<boolean> {
    return key !== undefined && (await this.secrets.get(key)) !== undefined;
  }

  // What the form needs to know, as the settings are now
  private context(open: Open): Context {
    const folder = servers.at(servers.merged(scopes()), open.folder);
    const own = open.editing?.at(-1);
    const authExtension = config().get("authExtension");
    const { files } = tls.files(
      config().get("tlsCaFile"),
      config().get("tlsCertFile"),
      config().get("tlsKeyFile"),
    );
    return {
      folder: open.folder,
      ...(own === undefined ? {} : { editing: own }),
      scopes: open.editing === undefined ? [] : scopesOf(open.editing),
      taken: servers.isObject(folder)
        ? Object.keys(folder).filter((name) => name !== own)
        : [],
      targets: open.editing === undefined ? targetsIn(open.folder) : [],
      ...(typeof authExtension === "string" && authExtension !== ""
        ? { authExtension }
        : {}),
      tlsFiles: Object.values(files).map((file) => path.basename(file)),
      connected:
        open.editing !== undefined &&
        this.connections.state(servers.id(open.editing)) !== undefined,
    };
  }

  // The server edited, as the settings define it now
  private editing(open: Open): servers.Definition | undefined {
    const id = open.editing && servers.id(open.editing);
    return servers
      .read(scopes())
      .find((server) => servers.id(server.path) === id);
  }

  // Post the form as the settings have it: blank for a server to add, or
  // the server edited, unless it, or the folder added to, is gone. Not
  // while it's saved, nor again when the change is to something else.
  private async load(open: Open) {
    if (open.saving) {
      return;
    }
    const message = await this.loading(open);
    const json = JSON.stringify(message);
    if (json !== open.loaded) {
      open.loaded = json;
      await this.post(open, message);
    }
  }

  // A server with a problem is loaded as it's written, with the problem
  private async loading(open: Open): Promise<ToForm> {
    if (gone(open)) {
      return { type: "gone", path: open.editing ?? open.folder };
    }
    const context = this.context(open);
    if (open.editing === undefined) {
      // Saved where its folder is, unless the user picks
      const target = context.targets[0] ?? "user";
      const form = { ...blank(), target };
      return { type: "load", form, context, stored: false };
    }
    const name = open.editing.at(-1) ?? "";
    const server = this.editing(open);
    if (server) {
      const stored = await this.stored(servers.secretKey(server));
      const form = fromSetting(name, server);
      return { type: "load", form, context, stored };
    }
    const merged = servers.merged(scopes());
    const value = servers.at(merged, open.editing);
    const problem = servers.entryProblem(name, value);
    const form = fromSetting(name, value);
    return {
      type: "load",
      form,
      context: { ...context, ...(problem === undefined ? {} : { problem }) },
      stored: await this.stored(keyFor(form)),
    };
  }

  // The server the form makes, by its path, and its setting, read back as
  // connecting reads it; refused with the problems the form has. A test
  // needs no name: one that's missing or wrong is called test.
  private async checked(open: Open, form: Form, testing = false) {
    const context = this.context(open);
    const login = { user: form.user, host: form.host, port: form.port };
    const found = problems(form, context, await this.stored(keyFor(login)));
    const named = found.name === undefined;
    if (testing) {
      delete found.name;
      delete found.target;
    }
    const wrong = Object.entries(found).map(
      ([field, problem]) => `${field}: ${problem}`,
    );
    if (wrong.length > 0) {
      throw new Error(
        `${testing ? "not tested" : "not saved"}, as ${wrong.join("; ")}`,
      );
    }
    const name = named ? form.name.trim() : "test";
    const path = [...open.folder, name];
    const value = toSetting(form);
    const read = servers.definitions({ [name]: value });
    const [checked] = read.servers;
    if (checked === undefined) {
      throw new Error(
        `${testing ? "not tested" : "not saved"}, as ${read.problems.map(({ problem }) => problem).join("; ")}`,
      );
    }
    const definition = { ...checked, path };
    return { context, path, value, definition };
  }

  // Open a connection as the form has the server, and close it again,
  // saying how it went: with the password typed, if one is. Closing the
  // tab stops it.
  private async test(
    open: Open,
    form: Form,
  ): Promise<{ ok: boolean; text: string }> {
    let checked: Awaited<ReturnType<typeof this.checked>>;
    try {
      checked = await this.checked(open, form, true);
    } catch (error) {
      return { ok: false, text: (error as Error).message };
    }
    const { definition } = checked;
    const at = `${definition.host}:${definition.port}`;
    const typed =
      form.auth === "store" && form.password !== "" ? form.password : undefined;
    try {
      const link = await this.opener(definition, {
        typed,
        signal: open.closing.signal,
      });
      if (link === undefined) {
        return { ok: false, text: "Cancelled" };
      }
      link.close();
      return { ok: true, text: `Connected to ${at}` };
    } catch (error) {
      return { ok: false, text: `${at}: ${(error as Error).message}` };
    }
  }

  // Save the form, once at a time, saying why if it can't be
  private async save(open: Open, form: Form) {
    if (open.saving) {
      return;
    }
    open.saving = true;
    try {
      await this.saved(open, form);
      open.panel.dispose();
    } catch (error) {
      open.saving = false;
      await this.post(open, {
        type: "unsaved",
        text: (error as Error).message,
      });
      // Anything that changed meanwhile
      await this.load(open);
    }
  }

  // Keep the server's password, then write the server where it's written,
  // or for one added, where it's to go; and forget the password it had if
  // no other server gets it. A server renamed is renamed in every scope
  // it's in, and its connection closed.
  private async saved(open: Open, form: Form) {
    const { path, value, definition } = await this.checked(open, form);
    // Checked again after checking's wait, as the settings may have changed,
    // and before the password's kept, so that a save refused keeps nothing
    const missing = missingFrom(open, form.target);
    if (missing) {
      throw new Error(`not saved, as ${missing}`);
    }
    const before = this.editing(open);
    const key = servers.secretKey(definition);
    if (form.auth === "store" && form.password !== "") {
      await this.secrets.store(key, form.password);
    }
    if (open.editing === undefined) {
      await writeIn(form.target, path, value);
    } else {
      const old = open.editing;
      const from = old.at(-1);
      const renamed = servers.id(old) !== servers.id(path);
      const written = scopesOf(old);
      // Its fields are written where they win; anywhere else it's only
      // renamed, keeping what's written there
      const scope = written.at(-1) ?? "user";
      for (const other of written.filter((each) => each !== scope)) {
        if (renamed) {
          await writeIn(other, path, servers.at(scopes()[other], old), from);
        }
      }
      await writeIn(scope, path, value, from);
      if (renamed) {
        this.connections.disconnect(servers.id(old));
      }
    }
    const unused = new Set<string>();
    if (before?.auth === "store") {
      unused.add(servers.secretKey(before));
    }
    if (form.auth === "store") {
      unused.delete(key);
    }
    await forget(this.secrets, unused);
  }

  // A setting the form refers to: the servers, or the TLS files, in
  // settings.json, where they can be edited as written, or the auth
  // extension's in the Settings editor
  private async openSetting(
    open: Open,
    setting: "servers" | "authExtension" | "tls",
  ) {
    if (setting === "authExtension") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "kdb-q-ext-vscode.authExtension",
      );
      return;
    }
    // The TLS files are the same for every server, so they're the user's
    if (setting === "tls") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettingsJson",
        {
          revealSetting: { key: "kdb-q-ext-vscode.tlsCaFile", edit: true },
        },
      );
      return;
    }
    await openServers(
      (open.editing && scopesOf(open.editing).at(-1)) ?? "user",
    );
  }
}
