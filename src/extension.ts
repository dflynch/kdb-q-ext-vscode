// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as comments from "./comments";
import * as statements from "./statements";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kdb-q-ext-vscode.runSelectedText", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
          vscode.window.showWarningMessage(
            "kdb+/q: No active terminal to run the selected text in.",
          );
          return;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Select the current line, unless specific text is highlighted
        const text = selection.isEmpty
          ? document.lineAt(selection.start.line).text
          : document.getText(selection);

        // Send each statement to the terminal as a single line
        for (const statement of statements.flatten(text)) {
          terminal.sendText(statement);
        }
      }
    }),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.toggleBlockComment",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await toggleBlockComment(editor);
        }
      },
    ),
  );
}

// Comment out the selected lines with "/" and "\" marker lines, or remove the
// markers of the block comments they are in
async function toggleBlockComment(editor: vscode.TextEditor) {
  const document = editor.document;
  const selection = editor.selection;
  // As with line comments, a selection ending at column 0 excludes that line
  const end =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;
  const lines = Array.from(
    { length: document.lineCount },
    (_, i) => document.lineAt(i).text,
  );
  const toggle = comments.toggleBlockComment(lines, selection.start.line, end);

  if (toggle.kind === "none") {
    vscode.window.showInformationMessage(
      "kdb+/q: These lines are already commented out by the \\ above them.",
    );
  } else if (toggle.kind === "add") {
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const last = document.lineAt(toggle.end);
    await editor.edit((edit) => {
      edit.insert(new vscode.Position(toggle.start, 0), `/${eol}`);
      edit.insert(last.range.end, `${eol}\\`);
    });
    // Keep the same text selected, now one line further down
    editor.selection = new vscode.Selection(
      selection.anchor.translate(1),
      selection.active.translate(1),
    );
  } else {
    // Merge adjacent marker lines into one range, as edits may not overlap
    const ranges: vscode.Range[] = [];
    for (const line of toggle.lines) {
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
    await editor.edit((edit) => {
      for (const range of ranges) {
        edit.delete(range);
      }
    });
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
