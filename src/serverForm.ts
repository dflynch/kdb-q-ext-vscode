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
  type ToForm,
  toSetting,
} from "./form/fields";
import { type Panels, page } from "./resultView";
import * as servers from "./servers";
import * as tls from "./tls";

// The server form's editor tab
export const formType = "kdb-q-ext-vscode.serverForm";

// The settings a server's in, as VS Code names them
type Scope = "user" | "workspace";

// Opens a connection to a server, with a password typed in place of the
// one stored, if one's given: the extension's opener, or a stand-in for
// tests. Undefined if asking for a password was cancelled.
export type Opener = (
  server: servers.Definition,
  password?: string,
) => Promise<{ close(): void } | undefined>;

// A form open in a tab: for a server to add to a folder, or for one to
// edit, by its name as it was
type Open = {
  panel: vscode.WebviewPanel;
  folder: string[];
  editing?: string;
};

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");

// The servers setting in each scope, as written there
function scopes(): Record<Scope, unknown> {
  const inspected = config().inspect("servers");
  return { user: inspected?.globalValue, workspace: inspected?.workspaceValue };
}

// The scopes a server's written in: a server in both has their fields
// merged, the workspace's over the user's
export function scopesOf(name: string): Scope[] {
  const path = name.split("/");
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

// Delete the passwords no server other than the one named still gets from
// secure storage: several servers with the same user, host and port share
// one
export async function forget(
  secrets: vscode.SecretStorage,
  keys: Iterable<string>,
  except?: string,
) {
  const { servers: defined } = servers.definitions(config().get("servers"));
  for (const key of keys) {
    const used = defined.some(
      (server) =>
        server.name !== except &&
        server.auth === undefined &&
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
        name: "",
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

  // The form to edit a server, by its name
  edit(name: string) {
    const path = name.split("/");
    this.show(
      name,
      { folder: path.slice(0, -1), editing: name },
      `Edit ${path.at(-1)}`,
    );
  }

  // Close a server's form, as when it's removed
  close(name: string) {
    this.forms.get(name)?.panel.dispose();
  }

  dispose() {
    this.listening.dispose();
    for (const { panel } of [...this.forms.values()]) {
      panel.dispose();
    }
  }

  private show(id: string, of: Omit<Open, "panel">, title: string) {
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
    const open: Open = { panel, ...of };
    this.forms.set(id, open);
    panel.onDidDispose(() => {
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
    const post = (message: ToForm) => open.panel.webview.postMessage(message);
    switch (message.type) {
      case "ready":
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

  private async stored(key: string | undefined): Promise<boolean> {
    return key !== undefined && (await this.secrets.get(key)) !== undefined;
  }

  // What the form needs to know, as the settings are now
  private context(open: Open): Context {
    const setting = config().get("servers");
    const folder = servers.at(setting, open.folder);
    const own = open.editing?.split("/").at(-1);
    const authExtension = config().get("authExtension");
    const { files } = tls.files(
      config().get("tlsCaFile"),
      config().get("tlsCertFile"),
      config().get("tlsKeyFile"),
    );
    return {
      folder: open.folder,
      ...(open.editing === undefined ? {} : { editing: open.editing }),
      taken: servers.isObject(folder)
        ? Object.keys(folder).filter((name) => name !== own)
        : [],
      timeout: servers.settings(config().get("connectTimeout"), undefined)
        .defaults.timeout,
      workspaceOpen: vscode.workspace.workspaceFolders !== undefined,
      ...(typeof authExtension === "string" && authExtension !== ""
        ? { authExtension }
        : {}),
      tlsFiles: Object.values(files).map((file) => path.basename(file)),
      connected:
        open.editing !== undefined &&
        this.connections.state(open.editing) !== undefined,
    };
  }

  // The server edited, as the settings define it now
  private editing(open: Open): servers.Definition | undefined {
    return servers
      .definitions(config().get("servers"))
      .servers.find((server) => server.name === open.editing);
  }

  // Post the form as the settings have it: blank for a server to add, or
  // the server edited, unless it's gone
  private async load(open: Open) {
    const post = (message: ToForm) => open.panel.webview.postMessage(message);
    const context = this.context(open);
    if (open.editing === undefined) {
      return post({ type: "load", form: blank(), context, stored: false });
    }
    const server = this.editing(open);
    if (server === undefined) {
      return post({ type: "gone" });
    }
    const stored = await this.stored(servers.secretKey(server));
    const form = fromSetting(
      server.name.split("/").at(-1) ?? "",
      server,
      stored,
    );
    return post({ type: "load", form, context, stored });
  }

  // The server the form makes, by its path, and its setting, read back as
  // connecting reads it; refused with the problems the form has
  private async checked(open: Open, form: Form, refused: string) {
    const context = this.context(open);
    const login = { user: form.user, host: form.host, port: form.port };
    const found = problems(form, context, await this.stored(keyFor(login)));
    const wrong = Object.entries(found).map(
      ([field, problem]) => `${field}: ${problem}`,
    );
    if (wrong.length > 0) {
      throw new Error(`${refused}, as ${wrong.join("; ")}`);
    }
    const name = form.name.trim();
    const path = [...open.folder, name];
    const value = toSetting(form);
    const read = servers.definitions({ [name]: value });
    const [checked] = read.servers;
    if (checked === undefined) {
      throw new Error(read.problems.join("; "));
    }
    const definition = { ...checked, name: path.join("/") };
    return { context, path, value, definition };
  }

  // Open a connection as the form has the server, and close it again,
  // saying how it went: with the password typed, if one is
  private async test(
    open: Open,
    form: Form,
  ): Promise<{ ok: boolean; text: string }> {
    try {
      const { definition } = await this.checked(open, form, "not tested");
      const typed =
        form.auth === "store" && form.password !== ""
          ? form.password
          : undefined;
      const link = await this.opener(definition, typed);
      if (link === undefined) {
        return { ok: false, text: "Cancelled" };
      }
      link.close();
      return {
        ok: true,
        text: `Connected to ${definition.host}:${definition.port}`,
      };
    } catch (error) {
      return { ok: false, text: (error as Error).message };
    }
  }

  // Write the server where it's written, or for one added, where it's to
  // go; keep its password, and forget the one it had if no other server
  // gets it; then close the form
  private async save(open: Open, form: Form) {
    const { context, path, value, definition } = await this.checked(
      open,
      form,
      "not saved",
    );
    const before = this.editing(open);
    const scope: Scope =
      open.editing === undefined
        ? context.workspaceOpen && form.target === "workspace"
          ? "workspace"
          : "user"
        : (scopesOf(open.editing).at(-1) ?? "user");
    await write(scope, path, value, open.editing?.split("/").at(-1));
    const key = servers.secretKey(definition);
    if (form.auth === "store" && form.password !== "") {
      await this.secrets.store(key, form.password);
    }
    const unused = new Set<string>();
    if (before !== undefined && before.auth === undefined) {
      unused.add(servers.secretKey(before));
    }
    if (form.auth === "none") {
      unused.add(key);
    }
    if (form.auth === "store") {
      unused.delete(key);
    }
    await forget(this.secrets, unused, definition.name);
    open.panel.dispose();
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
