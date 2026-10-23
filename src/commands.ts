import * as vscode from "vscode";
import * as comments from "./comments";
import { Connection } from "./connection";
import type { Connections, State } from "./connections";
import { credentials, type Sources } from "./credentials";
import * as servers from "./servers";
import * as statements from "./statements";
import { home, passphraseKey, secure } from "./tls";

// Send the selected text, or the current line, to the active terminal one
// statement at a time. With several selections, each is sent in turn from the
// top of the document.
export function runSelectedText(editor: vscode.TextEditor) {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showWarningMessage(
      "kdb+/q: No active terminal to run the selected text in.",
    );
    return;
  }

  const document = editor.document;
  const selections = [...editor.selections].sort((a, b) =>
    a.start.compareTo(b.start),
  );
  // Several cursors on one line run it once
  const lines = new Set<number>();
  for (const selection of selections) {
    if (selection.isEmpty && lines.has(selection.start.line)) {
      continue;
    }
    lines.add(selection.start.line);
    const text = selection.isEmpty
      ? document.lineAt(selection.start.line).text
      : document.getText(selection);
    for (const statement of statements.flatten(text)) {
      terminal.sendText(statement);
    }
  }
}

// Comment out the selected lines with "/" and "\" marker lines, or remove the
// markers of the block comments they are in
export async function toggleBlockComment(editor: vscode.TextEditor) {
  const document = editor.document;
  // As with line comments, a selection ending at column 0 excludes that line
  const ranges = editor.selections.map((s) => ({
    start: s.start.line,
    end:
      s.end.character === 0 && s.end.line > s.start.line
        ? s.end.line - 1
        : s.end.line,
  }));
  const lines = Array.from(
    { length: document.lineCount },
    (_, i) => document.lineAt(i).text,
  );
  const { add, remove } = comments.toggleBlockComment(lines, ranges);

  if (add.length === 0 && remove.length === 0) {
    vscode.window.showInformationMessage(
      "kdb+/q: A \\ on its own line ends the script, so everything from it on is already commented out.",
    );
    return;
  }

  // Remove markers first, letting VS Code move the selections, then add them,
  // in one undo step
  if (remove.length > 0) {
    // Merge adjacent marker lines into one range, as edits may not overlap
    const ranges: vscode.Range[] = [];
    for (const line of remove) {
      const range = document.lineAt(line).rangeIncludingLineBreak;
      const prev = ranges[ranges.length - 1];
      if (prev?.end.isEqual(range.start)) {
        ranges[ranges.length - 1] = prev.union(range);
      } else {
        ranges.push(range);
      }
    }
    // The last line has no line break of its own, so take the one before
    const last = ranges[ranges.length - 1];
    const documentEnd = document.lineAt(document.lineCount - 1).range.end;
    if (last.end.isEqual(documentEnd) && last.start.line > 0) {
      ranges[ranges.length - 1] = last.with(
        document.lineAt(last.start.line - 1).range.end,
      );
    }
    const applied = await editor.edit(
      (edit) => {
        for (const range of ranges) {
          edit.delete(range);
        }
      },
      { undoStopBefore: true, undoStopAfter: add.length === 0 },
    );
    if (!applied) {
      return;
    }
  }

  if (add.length > 0) {
    // Removed marker lines move the lines after them up
    const blocks = add.map(({ start, end }) => {
      const removed = remove.filter((line) => line < start).length;
      return { start: start - removed, end: end - removed };
    });
    const selections = editor.selections;
    // VS Code converts "\n" to the document's line endings
    const applied = await editor.edit(
      (edit) => {
        for (const { start, end } of blocks) {
          edit.insert(new vscode.Position(start, 0), "/\n");
          edit.insert(document.lineAt(end).range.end, "\n\\");
        }
      },
      { undoStopBefore: remove.length === 0, undoStopAfter: true },
    );
    if (!applied) {
      return;
    }
    // Keep the same text selected: lines in a block move down past its "/",
    // and lines after it past the "\" too. A selection ending at column 0 just
    // after a block selects whole lines, so it ends before the "\".
    const moved = (p: vscode.Position, endsWholeLines: boolean) => {
      let lines = 0;
      for (const { start, end } of blocks) {
        if (
          p.line > end + 1 ||
          (p.line === end + 1 && !(endsWholeLines && p.character === 0))
        ) {
          lines += 2;
        } else if (p.line >= start) {
          lines += 1;
        }
      }
      return p.translate(lines);
    };
    editor.selections = selections.map(
      (s) =>
        new vscode.Selection(
          moved(s.anchor, !s.isEmpty && s.anchor.isEqual(s.end)),
          moved(s.active, !s.isEmpty && s.active.isEqual(s.end)),
        ),
    );
  }
}

// The servers in the settings, with any problems in them shown
export function definitions(): servers.Definition[] {
  const setting = vscode.workspace
    .getConfiguration("kdb-q-ext-vscode")
    .get("servers");
  const { servers: defined, problems } = servers.definitions(setting);
  if (problems.length > 0) {
    vscode.window.showWarningMessage(
      `kdb+/q: Left out of the servers setting: ${problems.join("; ")}.`,
    );
  }
  return defined;
}

// A server picked from those defined, or from the ones that meet a test,
// saying why if none does
async function pickServer(
  placeHolder: string,
  test: (server: servers.Definition) => boolean = () => true,
  none = "",
  detail: (server: servers.Definition) => string | undefined = () => undefined,
): Promise<servers.Definition | undefined> {
  const all = definitions();
  const defined = all.filter(test);
  if (all.length > 0 && defined.length === 0) {
    vscode.window.showInformationMessage(`kdb+/q: ${none}`);
    return undefined;
  }
  if (defined.length === 0) {
    const add = "Add Server";
    const choice = await vscode.window.showInformationMessage(
      "kdb+/q: No servers are defined in the settings.",
      add,
    );
    if (choice === add) {
      await vscode.commands.executeCommand("kdb-q-ext-vscode.addServer");
    }
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    defined.map((server) => ({
      label: server.name,
      description: `${server.user ? `${server.user}@` : ""}${server.host}:${server.port}`,
      detail: detail(server),
      server,
    })),
    { placeHolder },
  );
  return picked?.server;
}

// The title of each of Add Server's questions
const adding = "kdb+/q: Add Server";

// Ask for text, trimmed; undefined if cancelled
async function ask(
  options: vscode.InputBoxOptions,
): Promise<string | undefined> {
  return (
    await vscode.window.showInputBox({
      title: adding,
      ignoreFocusOut: true,
      ...options,
    })
  )?.trim();
}

// Ask to pick one of a few; undefined if cancelled
function choose<T extends vscode.QuickPickItem>(
  placeHolder: string,
  items: T[],
): Thenable<T | undefined> {
  return vscode.window.showQuickPick(items, {
    title: adding,
    placeHolder,
    ignoreFocusOut: true,
  });
}

// Ask to tick any of a few; undefined if cancelled
function tick<T extends vscode.QuickPickItem>(
  placeHolder: string,
  items: T[],
): Thenable<T[] | undefined> {
  return vscode.window.showQuickPick(items, {
    title: adding,
    placeHolder,
    ignoreFocusOut: true,
    canPickMany: true,
  });
}

// Ask for a file, written as the settings take it; undefined if cancelled
async function file(
  openLabel: string,
  filters: Record<string, string[]>,
): Promise<string | undefined> {
  const [picked] =
    (await vscode.window.showOpenDialog({
      title: `${adding}: ${openLabel}`,
      openLabel,
      filters,
    })) ?? [];
  return picked && home(picked.fsPath);
}

// A server's name, host and port
async function askAddress(
  taken: string[],
): Promise<{ name: string; host: string; port: number } | undefined> {
  const name = await ask({
    prompt: "The server's name",
    validateInput: (text) =>
      text.trim() === ""
        ? "A server needs a name"
        : taken.includes(text.trim())
          ? `There's a server named ${text.trim()} already`
          : undefined,
  });
  if (name === undefined) {
    return undefined;
  }
  const typed = await ask({
    prompt: "The server's host, or host:port",
    placeHolder: "localhost",
    validateInput: (text) => (text.trim() === "" ? "A host" : undefined),
  });
  if (typed === undefined) {
    return undefined;
  }
  const given = servers.address(typed);
  const host = given?.host ?? typed;
  const port = await ask({
    prompt: `The port on ${host}`,
    placeHolder: "5000",
    value: given ? `${given.port}` : undefined,
    validateInput: (text) =>
      servers.port(text) ? undefined : "A port, from 1 to 65535",
  });
  return port === undefined
    ? undefined
    : { name, host, port: servers.port(port) as number };
}

// The user to log in as and where the password comes from, with a password
// to store, which can be empty
async function askLogin(name: string): Promise<
  | {
      user?: string;
      auth?: "prompt" | { extension: string };
      password: string;
    }
  | undefined
> {
  const user = await ask({
    prompt: "The user to log in as, or none",
    validateInput: (text) =>
      servers.userProblem(text.trim())
        ? "The user can't contain : or a 0 byte"
        : undefined,
  });
  if (user === undefined) {
    return undefined;
  }
  const login = user === "" ? {} : { user };
  const how = await choose("Where the password comes from", [
    { label: "Store a password", description: "in VS Code's secure storage" },
    { label: "Ask each time", description: "and never keep it" },
    {
      label: "Use an extension",
      description: "that gives the login, for a firm's own sign-on",
    },
  ]);
  if (how?.label === "Ask each time") {
    return { ...login, auth: "prompt", password: "" };
  }
  if (how?.label === "Use an extension") {
    const extension = await ask({
      prompt: "The ID of the extension that gives the login",
      placeHolder: "publisher.name",
      validateInput: (text) =>
        servers.extensionId.test(text.trim())
          ? undefined
          : "An extension ID, publisher.name",
    });
    return extension === undefined
      ? undefined
      : { ...login, auth: { extension }, password: "" };
  }
  const password =
    how &&
    (await vscode.window.showInputBox({
      title: adding,
      prompt: `The password for ${name}, or none`,
      password: true,
      ignoreFocusOut: true,
      validateInput: servers.passwordProblem,
    }));
  return password === undefined ? undefined : { ...login, password };
}

// The files TLS needs besides the system's, as the setting takes them, with
// a client certificate's passphrase to store, which can be empty
async function askTls(): Promise<
  { tls: true | servers.Tls; passphrase: string } | undefined
> {
  const needs = await tick("The files TLS needs, if any (Enter for none)", [
    {
      label: "A CA",
      description: "to trust besides the system's, such as a firm's own",
    },
    {
      label: "A client certificate",
      description: "for a server that requires one",
    },
  ]);
  if (needs === undefined) {
    return undefined;
  }
  const labels = needs.map((item) => item.label);
  const files: servers.Tls = {};
  if (labels.includes("A CA")) {
    const ca = await file("Trust this CA", {
      "PEM certificates": ["pem", "crt", "cer"],
    });
    if (ca === undefined) {
      return undefined;
    }
    files.ca = ca;
  }
  if (!labels.includes("A client certificate")) {
    return { tls: labels.length === 0 ? true : files, passphrase: "" };
  }
  const form = await choose("The client certificate's form", [
    { label: "A certificate and its key", description: "in PEM" },
    { label: "One PKCS#12 file", description: ".p12 or .pfx" },
  ]);
  if (form === undefined) {
    return undefined;
  }
  if (form.label === "One PKCS#12 file") {
    files.pfx = await file("Use this certificate", {
      "PKCS#12": ["p12", "pfx"],
    });
    if (files.pfx === undefined) {
      return undefined;
    }
  } else {
    files.cert = await file("Use this certificate", {
      PEM: ["pem", "crt", "cer"],
    });
    files.key =
      files.cert && (await file("Use this key", { PEM: ["pem", "key"] }));
    if (files.key === undefined) {
      return undefined;
    }
  }
  const passphrase = await vscode.window.showInputBox({
    title: adding,
    prompt: "The client certificate's passphrase, or none",
    password: true,
    ignoreFocusOut: true,
  });
  return passphrase === undefined ? undefined : { tls: files, passphrase };
}

// The settings a server can do without, with a passphrase to store, which
// can be empty
async function askOptions(): Promise<
  | {
      tls?: true | servers.Tls;
      protect?: false;
      timeout?: number;
      passphrase: string;
    }
  | undefined
> {
  const timeout = connectionDefaults().timeout;
  const options = await tick("Options, if any (Enter for none)", [
    { label: "Connect with TLS" },
    {
      label: "Turn off protected evaluation",
      description: "for a gateway whose .z.pg is its own",
    },
    { label: "Set a connect timeout", description: `${timeout} ms otherwise` },
  ]);
  if (options === undefined) {
    return undefined;
  }
  const labels = options.map((item) => item.label);
  const encrypted = labels.includes("Connect with TLS")
    ? await askTls()
    : { passphrase: "" };
  if (encrypted === undefined) {
    return undefined;
  }
  const given = labels.includes("Set a connect timeout")
    ? await ask({
        prompt: "How long to wait to connect and log in, in milliseconds",
        value: `${timeout}`,
        validateInput: (text) =>
          /^\d+$/.test(text.trim()) && Number(text) > 0
            ? undefined
            : "A whole number of milliseconds",
      })
    : "";
  if (given === undefined) {
    return undefined;
  }
  return {
    ...encrypted,
    ...(labels.includes("Turn off protected evaluation")
      ? { protect: false as const }
      : {}),
    ...(given === "" ? {} : { timeout: Number(given) }),
  };
}

// Where to keep a server: the user's settings, or the workspace's if one is
// open and picked
async function askScope(): Promise<vscode.ConfigurationTarget | undefined> {
  if (!vscode.workspace.workspaceFolders) {
    return vscode.ConfigurationTarget.Global;
  }
  const scope = await choose("Where to keep the server", [
    {
      label: "User settings",
      description: "for every workspace",
      target: vscode.ConfigurationTarget.Global,
    },
    {
      label: "Workspace settings",
      description: "for this workspace, and anyone who opens it",
      target: vscode.ConfigurationTarget.Workspace,
    },
  ]);
  return scope?.target;
}

// Add a server to the user's or the workspace's settings, asking for each of
// its settings but an extension's own, which go in settings.json. That can
// be opened at the setting once it's added.
export async function addServer(
  secrets: vscode.SecretStorage,
  connections: Connections<Connection>,
) {
  const config = vscode.workspace.getConfiguration("kdb-q-ext-vscode");
  const setting = config.get("servers");
  const taken =
    typeof setting === "object" && setting !== null ? Object.keys(setting) : [];
  const address = await askAddress(taken);
  const login = address && (await askLogin(address.name));
  const options = login && (await askOptions());
  const target = options && (await askScope());
  if (!address || !login || !options || target === undefined) {
    return;
  }
  const inspected = config.inspect("servers");
  const current =
    target === vscode.ConfigurationTarget.Global
      ? inspected?.globalValue
      : inspected?.workspaceValue;
  if (
    current !== undefined &&
    (typeof current !== "object" || current === null || Array.isArray(current))
  ) {
    vscode.window.showErrorMessage(
      "kdb+/q: The servers setting there isn't an object, so a server can't be added to it.",
    );
    return;
  }
  const { name, ...at } = address;
  const { password, ...signIn } = login;
  const { passphrase, ...rest } = options;
  // As written in the setting, and read back as connecting reads it
  const value = { ...at, ...signIn, ...rest };
  const read = servers.definitions({ [name]: value });
  const [definition] = read.servers;
  if (definition === undefined) {
    throw new Error(`kdb+/q: ${read.problems.join("; ")}`);
  }
  await config.update("servers", { ...current, [name]: value }, target);
  if (password !== "") {
    await secrets.store(servers.secretKey(definition), password);
  }
  const key = definition.tls && passphraseKey(definition.tls);
  if (key && passphrase !== "") {
    await secrets.store(key, passphrase);
  }
  const connect = "Connect";
  const edit = "Open settings.json";
  const choice = await vscode.window.showInformationMessage(
    `kdb+/q: Added ${name}.${typeof signIn.auth === "object" ? " Any fields its extension takes go in settings.json." : ""}`,
    connect,
    edit,
  );
  if (choice === connect) {
    await connectTo(connections, definition);
  } else if (choice === edit) {
    // The Settings editor can't edit an object; a query naming a setting
    // reveals it in the file
    await vscode.commands.executeCommand(
      target === vscode.ConfigurationTarget.Global
        ? "workbench.action.openSettingsJson"
        : "workbench.action.openWorkspaceSettingsFile",
      { query: "kdb-q-ext-vscode.servers" },
    );
  }
}

// Keep a server's password in VS Code's secure storage, for the servers
// whose password comes from there
export async function setPassword(secrets: vscode.SecretStorage) {
  const server = await pickServer(
    "The server to set the password for",
    (server) => server.auth === undefined,
    "Every server gets its password from its auth setting.",
  );
  if (!server) {
    return;
  }
  const password = await vscode.window.showInputBox({
    prompt: `The password for ${server.name}`,
    password: true,
    validateInput: servers.passwordProblem,
  });
  if (password === undefined) {
    return;
  }
  await secrets.store(servers.secretKey(server), password);
}

// Any server, so that a password kept before its auth was set can go too
export async function clearPassword(secrets: vscode.SecretStorage) {
  const server = await pickServer("The server to clear the password for");
  if (server) {
    await secrets.delete(servers.secretKey(server));
  }
}

// Whether a server has a client certificate, which can need a passphrase
function certified(server: servers.Definition): boolean {
  return server.tls !== undefined && passphraseKey(server.tls) !== undefined;
}

// Keep the passphrase of a server's client certificate in VS Code's secure
// storage, under the certificate's file
export async function setPassphrase(secrets: vscode.SecretStorage) {
  const server = await pickServer(
    "The server whose client certificate to set the passphrase for",
    certified,
    "No server has a client certificate in its tls setting.",
  );
  const key = server?.tls && passphraseKey(server.tls);
  if (!key) {
    return;
  }
  const passphrase = await vscode.window.showInputBox({
    prompt: `The passphrase for ${server.name}'s client certificate`,
    password: true,
  });
  if (passphrase !== undefined) {
    await secrets.store(key, passphrase);
  }
}

export async function clearPassphrase(secrets: vscode.SecretStorage) {
  const server = await pickServer(
    "The server whose client certificate to clear the passphrase for",
    certified,
    "No server has a client certificate in its tls setting.",
  );
  const key = server?.tls && passphraseKey(server.tls);
  if (key) {
    await secrets.delete(key);
  }
}

// The connect timeout and the size limit, with any problems in them shown
export function connectionDefaults(): servers.Defaults {
  const config = vscode.workspace.getConfiguration("kdb-q-ext-vscode");
  const { defaults, problems } = servers.settings(
    config.get("connectTimeout"),
    config.get("sizeLimit"),
  );
  if (problems.length > 0) {
    vscode.window.showWarningMessage(
      `kdb+/q: Using the default, as ${problems.join(" and ")}.`,
    );
  }
  return defaults;
}

// Where credentials come from in VS Code
export function sources(secrets: vscode.SecretStorage): Sources {
  return {
    stored: (key) => secrets.get(key),
    ask: (server) =>
      vscode.window.showInputBox({
        prompt: `The password for ${server.name}, not kept`,
        password: true,
        ignoreFocusOut: true,
        validateInput: servers.passwordProblem,
      }),
    extension: async (id) => {
      const extension = vscode.extensions.getExtension(id);
      return extension === undefined ? undefined : await extension.activate();
    },
  };
}

// A connection to a server as its settings define it, with its password or
// credentials and its TLS files got at each connect, so that a token is
// fresh. Undefined if the user cancels being asked for a password.
export function opener(secrets: vscode.SecretStorage) {
  return async (definition: servers.Definition) => {
    const given = await credentials(definition, sources(secrets));
    if (given === undefined) {
      return undefined;
    }
    const key = definition.tls && passphraseKey(definition.tls);
    const tls =
      definition.tls &&
      (await secure(definition.tls, key && (await secrets.get(key))));
    return Connection.open(
      servers.server(definition, given, connectionDefaults(), tls),
    );
  };
}

// A state as a few words
function describe(state: State): string {
  switch (state.kind) {
    case "connecting":
      return "connecting";
    case "open":
      return "connected";
    case "closed":
      return `closed: ${state.reason.message}`;
  }
}

// Connect to a server picked, or make its connection active if it's open
export async function connect(connections: Connections<Connection>) {
  const server = await pickServer(
    "The server to connect to",
    undefined,
    undefined,
    (server) => {
      const state = connections.state(server.name);
      const active = connections.active?.name === server.name;
      return state && `${active ? "Active, " : ""}${describe(state)}`;
    },
  );
  if (server) {
    await connectTo(connections, server);
  }
}

async function connectTo(
  connections: Connections<Connection>,
  server: servers.Definition,
) {
  try {
    await connections.connect(server);
  } catch (error) {
    vscode.window.showErrorMessage(
      `kdb+/q: ${server.name}: ${(error as Error).message}`,
    );
  }
}

// Close a connection: the only one, or one picked
export async function disconnect(connections: Connections<Connection>) {
  const names = connections.names;
  if (names.length === 0) {
    vscode.window.showInformationMessage("kdb+/q: No server is connected.");
    return;
  }
  const name =
    names.length === 1
      ? names[0]
      : await vscode.window.showQuickPick(names, {
          placeHolder: "The server to disconnect from",
        });
  if (name) {
    connections.disconnect(name);
  }
}

// The active connection in the status bar, which picks one when clicked,
// and a warning when a connection closes without being disconnected
export function showStatus(
  connections: Connections<Connection>,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "kdb-q-ext-vscode.connection",
    vscode.StatusBarAlignment.Left,
  );
  item.name = "kdb+/q Connection";
  item.command = "kdb-q-ext-vscode.connect";
  const update = () => {
    const active = connections.active;
    const icon = !active
      ? "plug"
      : active.state.kind === "connecting"
        ? "loading~spin"
        : active.state.kind === "open"
          ? "database"
          : "debug-disconnect";
    item.text = `$(${icon}) ${active?.name ?? "kdb+/q"}`;
    item.tooltip = active
      ? `kdb+/q: ${active.name}, ${describe(active.state)}`
      : "kdb+/q: Connect to a server";
    item.backgroundColor =
      active?.state.kind === "closed"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  };
  update();
  item.show();
  const stop = connections.onChange(({ lost }) => {
    update();
    if (lost) {
      vscode.window.showWarningMessage(
        `kdb+/q: ${lost.name}: ${lost.reason.message}`,
      );
    }
  });
  return {
    dispose: () => {
      stop();
      item.dispose();
    },
  };
}
