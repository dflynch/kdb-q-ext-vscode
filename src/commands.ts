import * as vscode from "vscode";
import { type Asker, add } from "./adding";
import * as comments from "./comments";
import { Connection, QError, type Timing } from "./connection";
import type { Connections, State } from "./connections";
import { credentials, type Sources } from "./credentials";
import type { Size } from "./format/console";
import { quickInput } from "./quickInput";
import * as servers from "./servers";
import * as statements from "./statements";
import { passphraseKey, secure } from "./tls";
import * as transcript from "./transcript";

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

// The console size, with any problem in it shown
function consoleSize(): Size {
  const { size, problems } = transcript.consoleSize(
    vscode.workspace.getConfiguration("kdb-q-ext-vscode").get("consoleSize"),
  );
  if (problems.length > 0) {
    vscode.window.showWarningMessage(
      `kdb+/q: Using the default, as ${problems.join(" and ")}.`,
    );
  }
  return size;
}

// Run the selected text, or the current line, on the active connection as
// one query, as written, showing it with its result as the q console does,
// and how long it took in the status bar. With several selections, the
// primary one.
export async function runOnServer(
  editor: vscode.TextEditor,
  connections: Connections<Connection>,
  output: vscode.OutputChannel,
  status: Pick<Status, "timed">,
) {
  const selection = editor.selection;
  const query = selection.isEmpty
    ? editor.document.lineAt(selection.active.line).text
    : editor.document.getText(selection);
  if (query.trim() === "") {
    return;
  }
  // With no open connection active, pick one, as Connect does
  if (connections.active?.state.kind !== "open") {
    await connect(connections);
  }
  const name = connections.active?.name;
  const link = name && connections.link(name);
  if (!name || !link) {
    return;
  }
  const size = consoleSize();
  output.show(true);
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `kdb+/q: Running on ${name}`,
    },
    () =>
      link.query(query).then(
        (result) => ({ result }),
        (error: Error) => ({ error }),
      ),
  );
  output.appendLine(transcript.entry(query, outcome, size));
  status.timed(
    name,
    "result" in outcome
      ? outcome.result.timing
      : outcome.error instanceof QError
        ? outcome.error.timing
        : undefined,
  );
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

// A server picked from those defined, under the command's title: any, or
// those that meet a test, saying why if none does, each with any detail
async function pickServer(
  title: string,
  {
    test,
    none,
    detail,
  }: {
    test?: (server: servers.Definition) => boolean;
    none?: string;
    detail?: (server: servers.Definition) => string | undefined;
  } = {},
): Promise<servers.Definition | undefined> {
  const all = definitions();
  const defined = test ? all.filter(test) : all;
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
      detail: detail?.(server),
      server,
    })),
    { title, placeHolder: "Server" },
  );
  return picked?.server;
}

// Whether a setting's value is an object, as the servers setting is
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Add a server to the user's or the workspace's settings, asking for each of
// its settings but an extension's own, which go in settings.json. That can
// be opened at the setting once it's added.
export async function addServer(
  secrets: vscode.SecretStorage,
  connections: Connections<Connection>,
  ask: Asker = quickInput("kdb+/q: Add Server"),
) {
  const config = vscode.workspace.getConfiguration("kdb-q-ext-vscode");
  const inspected = config.inspect("servers");
  const scopes = {
    user: inspected?.globalValue ?? {},
    workspace: inspected?.workspaceValue ?? {},
  };
  // Checked before asking, rather than refusing once everything's answered
  if (!isObject(scopes.user) || !isObject(scopes.workspace)) {
    vscode.window.showErrorMessage(
      "kdb+/q: The servers setting isn't an object, so a server can't be added to it.",
    );
    return;
  }
  const adding = await add(ask, {
    taken: Object.keys({ ...scopes.user, ...scopes.workspace }),
    timeout: connectionDefaults().timeout,
    workspaceOpen: vscode.workspace.workspaceFolders !== undefined,
  });
  if (adding === undefined) {
    return;
  }
  const { name, value, password, passphrase, target } = adding;
  // Read back as connecting reads it
  const read = servers.definitions({ [name]: value });
  const [definition] = read.servers;
  if (definition === undefined) {
    throw new Error(`kdb+/q: ${read.problems.join("; ")}`);
  }
  await config.update(
    "servers",
    { ...scopes[target], [name]: value },
    target === "workspace"
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global,
  );
  if (password !== undefined) {
    await secrets.store(servers.secretKey(definition), password);
  }
  const key = passphraseKey(definition.tls);
  if (key && passphrase !== undefined) {
    await secrets.store(key, passphrase);
  }
  const connect = "Connect";
  const edit = "Open settings.json";
  const choice = await vscode.window.showInformationMessage(
    `kdb+/q: Added ${name}.${typeof definition.auth === "object" ? " Any fields its extension takes go in settings.json." : ""}`,
    connect,
    edit,
  );
  if (choice === connect) {
    await connectTo(connections, definition);
  } else if (choice === edit) {
    // The Settings editor can't edit an object; a query naming a setting
    // reveals it in the file
    await vscode.commands.executeCommand(
      target === "workspace"
        ? "workbench.action.openWorkspaceSettingsFile"
        : "workbench.action.openSettingsJson",
      { query: "kdb-q-ext-vscode.servers" },
    );
  }
}

// Keep a server's password in VS Code's secure storage, for the servers
// whose password comes from there
export async function setPassword(secrets: vscode.SecretStorage) {
  const title = "kdb+/q: Set Server Password";
  const server = await pickServer(title, {
    test: (server) => server.auth === undefined,
    none: "Every server gets its password from its auth setting.",
  });
  if (!server) {
    return;
  }
  const password = await vscode.window.showInputBox({
    title,
    prompt: "Password",
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
  const server = await pickServer("kdb+/q: Clear Server Password");
  if (server) {
    await secrets.delete(servers.secretKey(server));
  }
}

// The servers with a client certificate, which can need a passphrase
const certified = {
  test: (server: servers.Definition) => passphraseKey(server.tls) !== undefined,
  none: "No server has a client certificate in its tls setting.",
};

// Keep the passphrase of a server's client certificate in VS Code's secure
// storage, under the certificate's file
export async function setPassphrase(secrets: vscode.SecretStorage) {
  const title = "kdb+/q: Set Certificate Passphrase";
  const server = await pickServer(title, certified);
  const key = passphraseKey(server?.tls);
  if (!key) {
    return;
  }
  const passphrase = await vscode.window.showInputBox({
    title,
    prompt: "Passphrase for client certificate",
    password: true,
  });
  if (passphrase !== undefined) {
    await secrets.store(key, passphrase);
  }
}

export async function clearPassphrase(secrets: vscode.SecretStorage) {
  const server = await pickServer(
    "kdb+/q: Clear Certificate Passphrase",
    certified,
  );
  const key = passphraseKey(server?.tls);
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
    ask: () =>
      vscode.window.showInputBox({
        title: "kdb+/q: Connect to Server",
        prompt: "Password",
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
    const key = passphraseKey(definition.tls);
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
  const server = await pickServer("kdb+/q: Connect to Server", {
    detail: (server) => {
      const state = connections.state(server.name);
      const active = connections.active?.name === server.name;
      return state && `${active ? "Active, " : ""}${describe(state)}`;
    },
  });
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
          title: "kdb+/q: Disconnect from Server",
          placeHolder: "Server",
        });
  if (name) {
    connections.disconnect(name);
  }
}

// The status bar, which can be told how long a server's last query took
export type Status = vscode.Disposable & {
  timed(name: string, timing: Timing | undefined): void;
};

// How long a query took: the server's time, as \t gives, with protected
// evaluation, and the roundtrip
function took(timing: Timing): string {
  return timing.execution === undefined
    ? `$(watch) ${timing.roundtrip} ms roundtrip`
    : `$(watch) ${timing.execution} ms (${timing.roundtrip} ms roundtrip)`;
}

// A server's settings, all but secrets: where the password comes from, not
// what it is, and an extension's name, not the fields it's given
function details(server: servers.Definition, timeout: number): string[] {
  const auth =
    server.auth === undefined
      ? "Stored password"
      : server.auth === "prompt"
        ? "Ask each time"
        : `Extension ${server.auth.extension}`;
  const tls =
    server.tls === undefined
      ? "Off"
      : server.tls.pfx || server.tls.cert
        ? "On, with a client certificate"
        : "On";
  const wait = server.timeout ?? timeout;
  return [
    `Host: ${server.host}:${server.port}`,
    ...(server.user ? [`User: ${server.user}`] : []),
    `Authentication: ${auth}`,
    `TLS: ${tls}`,
    `Protected evaluation: ${server.protect === false ? "Off" : "On"}`,
    `Connection timeout: ${wait === 0 ? "None" : `${wait} ms`}`,
  ];
}

// The active connection in the status bar, which picks one when clicked,
// with how long its last query took, and a warning when a connection closes
// without being disconnected. Its tooltip gives the server's settings.
export function showStatus(connections: Connections<Connection>): Status {
  const item = vscode.window.createStatusBarItem(
    "kdb-q-ext-vscode.connection",
    vscode.StatusBarAlignment.Left,
  );
  item.name = "kdb+/q Connection";
  item.command = "kdb-q-ext-vscode.connect";
  // The last query's timing, kept while its connection is open
  let last: { name: string; timing: Timing } | undefined;
  const update = () => {
    const active = connections.active;
    const server = active && connections.server(active.name);
    const icon = !active
      ? "plug"
      : active.state.kind === "connecting"
        ? "loading~spin"
        : active.state.kind === "open"
          ? "database"
          : "debug-disconnect";
    const timing = last?.name === active?.name ? last?.timing : undefined;
    item.text = `$(${icon}) ${active?.name ?? "kdb+/q"}${timing ? `  ${took(timing)}` : ""}`;
    item.tooltip =
      active && server
        ? [
            `kdb+/q: ${active.name}, ${describe(active.state)}`,
            ...details(
              server,
              servers.settings(
                vscode.workspace
                  .getConfiguration("kdb-q-ext-vscode")
                  .get("connectTimeout"),
                undefined,
              ).defaults.timeout,
            ),
          ].join("\n")
        : "kdb+/q: Connect to a server";
    item.backgroundColor =
      active?.state.kind === "closed"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  };
  update();
  item.show();
  const stop = connections.onChange(({ lost }) => {
    if (last && connections.state(last.name)?.kind !== "open") {
      last = undefined;
    }
    update();
    if (lost) {
      vscode.window.showWarningMessage(
        `kdb+/q: ${lost.name}: ${lost.reason.message}`,
      );
    }
  });
  return {
    timed: (name, timing) => {
      last = timing && { name, timing };
      update();
    },
    dispose: () => {
      stop();
      item.dispose();
    },
  };
}
