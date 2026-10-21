import * as vscode from "vscode";
import * as comments from "./comments";
import * as statements from "./statements";

// Send the selected text, or the current line, to the active terminal one
// statement at a time
export function runSelectedText(editor: vscode.TextEditor) {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showWarningMessage(
      "kdb+/q: No active terminal to run the selected text in.",
    );
    return;
  }

  const document = editor.document;
  const selection = editor.selection;
  const text = selection.isEmpty
    ? document.lineAt(selection.start.line).text
    : document.getText(selection);

  for (const statement of statements.flatten(text)) {
    terminal.sendText(statement);
  }
}

// Comment out the selected lines with "/" and "\" marker lines, or remove the
// markers of the block comments they are in
export async function toggleBlockComment(editor: vscode.TextEditor) {
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
      "kdb+/q: A \\ on its own line ends the script, so everything from it on is already commented out.",
    );
  } else if (toggle.kind === "add") {
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const last = document.lineAt(toggle.end);
    const applied = await editor.edit((edit) => {
      edit.insert(new vscode.Position(toggle.start, 0), `/${eol}`);
      edit.insert(last.range.end, `${eol}\\`);
    });
    if (!applied) {
      return;
    }
    // Keep the same text selected: lines in the block move down past the "/",
    // and lines after it past the "\" too (when the block stopped early). A
    // selection ending at column 0 just after the block selects whole lines,
    // so it ends before the "\".
    const moved = (p: vscode.Position) => {
      if (p.line <= toggle.end) {
        return p.translate(1);
      }
      if (p.line === toggle.end + 1 && p.character === 0) {
        return new vscode.Position(toggle.end + 2, 0);
      }
      return p.translate(2);
    };
    editor.selection = new vscode.Selection(
      moved(selection.anchor),
      moved(selection.active),
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
