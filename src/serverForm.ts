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
function scopes(): Record<Scope, unknown> {
  const inspected = config().inspect("servers");
  return { user: inspected?.globalValue, workspace: inspected?.workspaceValue };
}

// The scopes a server's written in: a server in both has their fields
// merged, the workspace's over the user's
export function scopesOf(path: string[]): Scope[] {
  const written = scopes();
  return (["user", "workspace"] as const).filter(
    (scope) => servers.at(written[scope], path) !== undefined,
  );
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
    throw new Error("the servers setting isn't an object");
  }
  await config().update(
    "servers",
    servers.put(setting, path, value, from),
    targets[scope],
  );
}

// Delete the passwords no server other than the one at the path given still
// gets from secure storage: several servers with the same user, host and
// port share one
export async function forget(
  secrets: vscode.SecretStorage,
  keys: Iterable<string>,
  except?: string[],
) {
  const { servers: defined } = servers.definitions(config().get("servers"));
  const skipped = except && servers.id(except);
  for (const key of keys) {
    const used = defined.some(
      (server) =>
        servers.id(server.path) !== skipped &&
        server.auth === "store" &&
        servers.secretKey(server) === key,
    );
    if (!used) {
      await secrets.delete(key);
    }
  }
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

  // The form to add a server to a folder
  add(folder: string[] = []) {
    this.show("", { folder }, "Add Server");
  }

  // The form to edit a server, by its path
  edit(path: string[]) {
    this.show(
      servers.id(path),
      { folder: path.slice(0, -1), editing: path },
      `Edit ${path.at(-1)}`,
    );
  }

  // Close a server's form, as when it's removed
  close(path: string[]) {
    this.forms.get(servers.id(path))?.panel.dispose();
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
    const setting = config().get("servers");
    const folder = servers.at(setting, open.folder);
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
      workspaceOpen: vscode.workspace.workspaceFolders !== undefined,
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
      .definitions(config().get("servers"))
      .servers.find((server) => servers.id(server.path) === id);
  }

  // Post the form as the settings have it: blank for a server to add, or
  // the server edited, unless it's gone. Not while it's saved, nor again
  // when the change is to something else.
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

  private async loading(open: Open): Promise<ToForm> {
    const context = this.context(open);
    if (open.editing === undefined) {
      return { type: "load", form: blank(), context, stored: false };
    }
    const server = this.editing(open);
    if (server === undefined) {
      return { type: "gone" };
    }
    const stored = await this.stored(servers.secretKey(server));
    const form = fromSetting(server.path.at(-1) ?? "", server);
    return { type: "load", form, context, stored };
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
      throw new Error(read.problems.map(({ problem }) => problem).join("; "));
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
    const { context, path, value, definition } = await this.checked(open, form);
    const before = this.editing(open);
    const key = servers.secretKey(definition);
    if (form.auth === "store" && form.password !== "") {
      await this.secrets.store(key, form.password);
    }
    if (open.editing === undefined) {
      const scope: Scope =
        context.workspaceOpen && form.target === "workspace"
          ? "workspace"
          : "user";
      await write(scope, path, value);
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
          await write(other, path, servers.at(scopes()[other], old), from);
        }
      }
      await write(scope, path, value, from);
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
    await forget(this.secrets, unused, path);
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
    const scope =
      open.editing === undefined ? "user" : scopesOf(open.editing).at(-1);
    // The Settings editor can't edit an object; a query naming a setting
    // reveals it in the file
    await vscode.commands.executeCommand(
      scope === "workspace"
        ? "workbench.action.openWorkspaceSettingsFile"
        : "workbench.action.openSettingsJson",
      { revealSetting: { key: "kdb-q-ext-vscode.servers" } },
    );
  }
}
