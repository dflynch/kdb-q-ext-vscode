// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kdb-q-ext-vscode.runSelectedText", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const document = editor.document;
        const selection = editor.selection;

        // Select the current line, unless specific text is highlighted
        let text = selection.isEmpty
          ? document.lineAt(selection.start.line).text
          : document.getText(selection);

        // Remove comment blocks
        text = text.replace(/^\/\s*$(.*?)^\\\s*$/gms, "");
        // Remove end-of-file comments
        text = text.replace(/^\\\s*$[\s\S]*/gm, "");
        // Remove in-line comments
        text = text.replace(/(?:(?<=[ \t])|(?<!.))\/.*/g, "");
        // Replace line endings with whitespace
        text = text.replace(/(\r\n|\n|\r)/g, " ").trim();
        // Remove superfluous whitespace, such as indentation
        text = text.replace(/\s+/g, " ");

        // Send the selected text to the terminal
        vscode.window.activeTerminal?.sendText(text);
      }
    })
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
