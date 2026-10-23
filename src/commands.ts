import * as vscode from "vscode";
import * as comments from "./comments";
import * as servers from "./servers";
import * as statements from "./statements";

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

async function pickServer(
  placeHolder: string,
): Promise<servers.Definition | undefined> {
  const defined = definitions();
  if (defined.length === 0) {
    const open = "Open Settings";
    const choice = await vscode.window.showInformationMessage(
      "kdb+/q: No servers are defined in the settings.",
      open,
    );
    if (choice === open) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "kdb-q-ext-vscode.servers",
      );
    }
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    defined.map((server) => ({
      label: server.name,
      description: `${server.user ? `${server.user}@` : ""}${server.host}:${server.port}`,
      server,
    })),
    { placeHolder },
  );
  return picked?.server;
}

// Keep a server's password in VS Code's secure storage
export async function setPassword(secrets: vscode.SecretStorage) {
  const server = await pickServer("The server to set the password for");
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

export async function clearPassword(secrets: vscode.SecretStorage) {
  const server = await pickServer("The server to clear the password for");
  if (server) {
    await secrets.delete(servers.secretKey(server));
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
