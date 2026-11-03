import * as vscode from "vscode";
import { scopeName } from "./commands";
import type { Connection } from "./connection";
import type { Connections, State } from "./connections";
import type { Scope } from "./form/fields";
import type { ServerForms } from "./serverForm";
import { forget, move, scopes, scopesOf, write } from "./serverForm";
import * as servers from "./servers";
import { describe, details } from "./status";

export const viewId = "kdb-q-ext-vscode.servers";

// A row in the Servers view: a folder or a server, as the settings have
// them, or a scope's servers setting that isn't an object at all, so that
// nothing in it can be read
export type Node =
  | servers.Entry
  | { kind: "setting"; scope: Scope; problem: string };

// What a row shows of the rest: the connections and the settings
export type Look = {
  state(id: string): State | undefined;
  active?: string;
  scopes(path: string[], kind: servers.Entry["kind"]): Scope[];
  authExtension?: unknown;
};

// Where a row's written, as VS Code names the settings
function written(scopes: Scope[]): string {
  return `In ${scopes.map(scopeName).join(" and ")} settings`;
}

const warning = new vscode.ThemeIcon(
  "warning",
  new vscode.ThemeColor("list.warningForeground"),
);

// A name as a row shows it: one that's blank is quoted, so it's seen
function label(path: string[]): string {
  const name = path.at(-1) ?? "";
  return name.trim() === "" ? JSON.stringify(name) : name;
}

// The servers in a folder, at any depth
export function serversIn(
  entries: servers.Entry[],
): Extract<servers.Entry, { kind: "server" }>[] {
  return servers.everything(entries).filter((entry) => entry.kind === "server");
}

// A row as the view shows it. A server's icon says its connection's state,
// as the status bar's does, and its menus offer what can be done in that
// state, by its contextValue. A folder says what's connected in it, so that
// a connection isn't out of sight when it's collapsed: VS Code keeps a
// folder collapsed or not as the user left it, and doesn't say which.
export function row(node: Node, look: Look): vscode.TreeItem {
  if (node.kind === "setting") {
    const item = new vscode.TreeItem(`${scopeName(node.scope)} settings`);
    item.id = `setting:${node.scope}`;
    item.description = `servers: ${node.problem}`;
    item.iconPath = warning;
    item.tooltip = `The servers setting: ${node.problem}, so nothing in it can be read`;
    item.contextValue = "setting";
    return item;
  }
  const id = servers.id(node.path);
  const where = written(look.scopes(node.path, node.kind));
  if (node.kind === "folder") {
    const item = new vscode.TreeItem(
      label(node.path),
      node.entries.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    item.id = id;
    if (node.problem) {
      item.iconPath = warning;
      item.description = node.problem;
      item.tooltip = `${node.problem}\n${where}`;
      item.contextValue = "brokenFolder";
      return item;
    }
    item.iconPath = new vscode.ThemeIcon("folder");
    item.tooltip = where;
    item.contextValue = "folder";
    const ids = serversIn(node.entries).map(({ path }) => servers.id(path));
    const open = ids.filter((each) => look.state(each)?.kind === "open");
    item.description = ids.some((each) => each === look.active)
      ? "· active"
      : open.length > 0
        ? `· ${open.length} open`
        : undefined;
    return item;
  }
  const item = new vscode.TreeItem(label(node.path));
  item.id = id;
  const server = node.server;
  if (!server) {
    item.iconPath = warning;
    item.description = node.problem;
    item.tooltip = `${node.problem}\n${where}`;
    item.contextValue = "broken";
    return item;
  }
  const state = look.state(id);
  const active = look.active === id;
  item.iconPath = new vscode.ThemeIcon(
    state === undefined
      ? "server"
      : state.kind === "connecting"
        ? "loading~spin"
        : state.kind === "open"
          ? "debug-connected"
          : "debug-disconnect",
    state?.kind === "closed"
      ? new vscode.ThemeColor("list.warningForeground")
      : undefined,
  );
  const login = `${server.user ? `${server.user}@` : ""}${server.host}:${server.port}`;
  item.description = active ? `${login} · active` : login;
  const now = state && `${active ? "Active, " : ""}${describe(state)}`;
  item.tooltip = [
    ...(now ? [now] : []),
    ...details(server, look.authExtension),
    where,
  ].join("\n");
  // The icon says the state, so screen readers are told it in words
  item.accessibilityInformation = {
    label: [label(node.path), item.description, now ?? "not connected"].join(
      ", ",
    ),
  };
  item.contextValue =
    state === undefined
      ? "idle"
      : state.kind === "open"
        ? active
          ? "active"
          : "open"
        : state.kind;
  return item;
}

const dragged = "application/vnd.code.tree.kdb-q-ext-vscode.servers";

// The Servers view: the servers and folders in the settings, both scopes
// together, as connecting reads them, with those that have a problem too,
// to fix; and what's connected. Servers and folders are moved by dragging
// them into a folder.
export class ServersView
  implements
    vscode.TreeDataProvider<Node>,
    vscode.TreeDragAndDropController<Node>,
    vscode.Disposable
{
  readonly dragMimeTypes = [dragged];
  readonly dropMimeTypes = [dragged];
  private changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private disposables: vscode.Disposable[];

  constructor(
    private readonly connections: Connections<Connection>,
    private readonly forms: ServerForms,
  ) {
    const view = vscode.window.createTreeView(viewId, {
      treeDataProvider: this,
      dragAndDropController: this,
      showCollapseAll: true,
    });
    const refresh = () => this.changed.fire(undefined);
    const stop = connections.onChange(refresh);
    this.disposables = [
      view,
      this.changed,
      { dispose: stop },
      vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration("kdb-q-ext-vscode")) {
          refresh();
        }
      }),
    ];
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return row(node, {
      state: (id) => this.connections.state(id),
      active: this.connections.active?.id,
      scopes: scopesOf,
      authExtension: vscode.workspace
        .getConfiguration("kdb-q-ext-vscode")
        .get("authExtension"),
    });
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      return node.kind === "folder" ? node.entries : [];
    }
    return roots(scopes());
  }

  handleDrag(nodes: readonly Node[], transfer: vscode.DataTransfer) {
    const entries = nodes.filter((node) => node.kind !== "setting");
    if (entries.length > 0) {
      transfer.set(dragged, new vscode.DataTransferItem(entries));
    }
  }

  // Dropped on a folder, they go in it; on a server, in its folder; on
  // nothing, at the top
  async handleDrop(target: Node | undefined, transfer: vscode.DataTransfer) {
    const entries = transfer.get(dragged)?.value as servers.Entry[] | undefined;
    if (!entries || target?.kind === "setting" || target?.problem) {
      return;
    }
    const folder =
      target === undefined
        ? []
        : target.kind === "folder"
          ? target.path
          : target.path.slice(0, -1);
    for (const entry of entries) {
      await moveTo(this.connections, this.forms, entry, folder);
    }
  }
}

// The view's top rows: a scope's setting that can't be read, then what the
// scopes hold together
export function roots(written: servers.Written): Node[] {
  const unread = (["user", "workspace"] as const).flatMap((scope): Node[] => {
    const setting = written[scope];
    return setting === undefined ||
      setting === null ||
      servers.isObject(setting)
      ? []
      : [{ kind: "setting", scope, problem: "not an object" }];
  });
  const merged = servers.merged(written);
  return [
    ...unread,
    ...(servers.isObject(merged) ? servers.entries(merged) : []),
  ];
}

// Where a folder is, as a message says it
function place(folder: string[]): string {
  return folder.length === 0
    ? "at the top level"
    : `in ${servers.shown(folder)}`;
}

// Move a server or a folder into a folder, in each scope it's written in,
// unless it's there already, it's the folder itself or holds it, or the
// name's taken there. The connections of the servers moved are closed, as
// they're known by their paths.
export async function moveTo(
  connections: Connections<Connection>,
  forms: ServerForms,
  entry: servers.Entry,
  folder: string[],
) {
  const to = [...folder, entry.path.at(-1) ?? ""];
  const from = entry.path;
  if (
    servers.id(from.slice(0, -1)) === servers.id(folder) ||
    servers.within(folder, from)
  ) {
    return;
  }
  if (servers.kindAt(servers.merged(scopes()), to) !== undefined) {
    vscode.window.showWarningMessage(
      `kdb+/q: ${servers.shown(from)} wasn't moved: ${to.at(-1)} already exists ${place(folder)}`,
    );
    return;
  }
  try {
    for (const scope of scopesOf(from, entry.kind)) {
      await move(scope, from, to);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `kdb+/q: ${servers.shown(from)} wasn't moved: ${(error as Error).message}`,
    );
    return;
  }
  forms.close(from);
  disconnectWithin(connections, from);
}

// Close the connection to a server, or to every server in a folder
function disconnectWithin(
  connections: Connections<Connection>,
  path: string[],
) {
  for (const server of connections.servers) {
    if (servers.within(server.path, path)) {
      connections.disconnect(servers.id(server.path));
    }
  }
}

// The problem with a name for a folder, as it's typed: blank, or taken by
// another in the folder it's to be in
function nameProblem(
  typed: string,
  folder: string[],
  own?: string,
): string | undefined {
  const name = typed.trim();
  if (name === "") {
    return "Required";
  }
  const there = servers.at(servers.merged(scopes()), [...folder, name]);
  return name !== own && there !== undefined
    ? `${name} already exists`
    : undefined;
}

// Make a folder: at the top, or in the folder whose row it's run on. It's
// written where its folder is; at the top, or where its folder's in both,
// the user picks, if there's a workspace.
export async function newFolder(row?: servers.Entry) {
  const title = "kdb+/q: New Folder";
  const parent = row?.kind === "folder" ? row.path : [];
  const typed = await vscode.window.showInputBox({
    title,
    prompt: parent.length > 0 ? `Name, in ${servers.shown(parent)}` : "Name",
    validateInput: (typed) => nameProblem(typed, parent),
  });
  if (typed === undefined) {
    return;
  }
  const workspaceOpen = vscode.workspace.workspaceFolders !== undefined;
  const candidates: Scope[] = !workspaceOpen
    ? ["user"]
    : parent.length === 0
      ? ["user", "workspace"]
      : scopesOf(parent, "folder");
  let scope = candidates[0] ?? "user";
  if (candidates.length > 1) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "User", detail: "For every workspace", scope: "user" },
        {
          label: "Workspace",
          detail: "For this workspace only",
          scope: "workspace",
        },
      ] as const,
      { title, placeHolder: "Save to" },
    );
    if (!picked) {
      return;
    }
    scope = picked.scope;
  }
  const path = [...parent, typed.trim()];
  try {
    await write(scope, path, {});
  } catch (error) {
    vscode.window.showErrorMessage(
      `kdb+/q: ${servers.shown(path)} wasn't made: ${(error as Error).message}`,
    );
  }
}

// Rename the folder whose row it's run on, in each scope it's written in.
// The connections to its servers are closed, and their forms, as they're
// known by their paths.
export async function renameFolder(
  connections: Connections<Connection>,
  forms: ServerForms,
  row: servers.Entry,
) {
  const parent = row.path.slice(0, -1);
  const own = row.path.at(-1) ?? "";
  const typed = await vscode.window.showInputBox({
    title: "kdb+/q: Rename Folder",
    prompt: "Name",
    value: own,
    validateInput: (typed) => nameProblem(typed, parent, own),
  });
  if (typed === undefined || typed.trim() === own) {
    return;
  }
  const to = [...parent, typed.trim()];
  try {
    for (const scope of scopesOf(row.path, "folder")) {
      await move(scope, row.path, to);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `kdb+/q: ${servers.shown(row.path)} wasn't renamed: ${(error as Error).message}`,
    );
    return;
  }
  forms.close(row.path);
  disconnectWithin(connections, row.path);
}

// Remove the folder whose row it's run on, once confirmed, with everything
// in it, from every scope it's written in, as Remove Server does a server
export async function removeFolder(
  secrets: vscode.SecretStorage,
  connections: Connections<Connection>,
  forms: ServerForms,
  row: servers.Entry,
) {
  if (row.kind !== "folder") {
    return;
  }
  // Read from the setting, as a folder with no name has none of its own
  const value = servers.at(servers.merged(scopes()), row.path);
  const held = servers.isObject(value)
    ? serversIn(servers.entries(value, row.path))
    : [];
  const where = scopesOf(row.path, "folder").map(scopeName);
  const what =
    held.length === 0
      ? "It's"
      : held.length === 1
        ? "It and the server in it are"
        : `It and the ${held.length} servers in it are`;
  const remove = "Remove";
  const choice = await vscode.window.showWarningMessage(
    `Remove ${servers.shown(row.path)}?`,
    {
      modal: true,
      detail: `${what} removed from your ${where.join(" and ")} settings.`,
    },
    remove,
  );
  if (choice !== remove) {
    return;
  }
  for (const scope of scopesOf(row.path, "folder")) {
    try {
      await write(scope, row.path, undefined);
    } catch (error) {
      vscode.window.showErrorMessage(
        `kdb+/q: ${servers.shown(row.path)} wasn't removed from ${scopeName(scope)} settings: ${(error as Error).message}`,
      );
      return;
    }
  }
  forms.close(row.path);
  disconnectWithin(connections, row.path);
  await forget(
    secrets,
    held.flatMap(({ server }) =>
      server?.auth === "store" ? [servers.secretKey(server)] : [],
    ),
  );
}
