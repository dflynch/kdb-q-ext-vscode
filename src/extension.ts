// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
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
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
