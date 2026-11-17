import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

// The selected text, or the current line, run in the active terminal's q as a
// script: written as it is to a temp file, which q loads with \l. q reads the
// statements itself, so a run stops at the first error, and a \d in it lasts
// only to its end, as in any script. Each run has a file of its own, as q may
// still be busy when the next is sent, named at random so that it reads as
// the throwaway it is; this window's are removed when it closes.
export class TerminalRun implements vscode.Disposable {
  private readonly files: string[] = [];

  run(editor: vscode.TextEditor) {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showWarningMessage(
        "kdb+/q: No active terminal to run the selected text in.",
      );
      return;
    }
    let file: string;
    try {
      file = this.write(script(editor));
    } catch (error) {
      vscode.window.showErrorMessage(
        `kdb+/q: failed to run in terminal: ${(error as Error).message}`,
      );
      return;
    }
    // q takes / on Windows too
    terminal.sendText(`\\l ${file.replaceAll("\\", "/")}`);
  }

  // A new file with the script, in /tmp, short to read, or Windows' temp
  // folder, readable by this user only; \l reads a path up to the first
  // space, so a folder with one is refused
  private write(text: string): string {
    const folder = process.platform === "win32" ? tmpdir() : "/tmp";
    if (/\s/.test(folder)) {
      throw new Error("temp folder path has spaces", { cause: folder });
    }
    for (;;) {
      const file = join(folder, `ink-${name()}.q`);
      try {
        writeFileSync(file, text, { flag: "wx", mode: 0o600 });
      } catch (error) {
        // Another's, by a chance in billions
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      this.files.push(file);
      return file;
    }
  }

  dispose() {
    for (const file of this.files) {
      rmSync(file, { force: true });
    }
  }
}

// Six letters or digits at random, as mkstemp makes
function name(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(randomBytes(6), (b) => chars[b % chars.length]).join("");
}

// The selections, from the top of the document, a line each where empty, one
// after another; several cursors on one line take it once
function script(editor: vscode.TextEditor): string {
  const document = editor.document;
  const selections = [...editor.selections].sort((a, b) =>
    a.start.compareTo(b.start),
  );
  const lines = new Set<number>();
  const parts: string[] = [];
  for (const selection of selections) {
    if (selection.isEmpty && lines.has(selection.start.line)) {
      continue;
    }
    lines.add(selection.start.line);
    parts.push(
      selection.isEmpty
        ? document.lineAt(selection.start.line).text
        : document.getText(selection),
    );
  }
  return parts.join(document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
}
