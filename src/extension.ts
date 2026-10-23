import * as vscode from "vscode";
import * as commands from "./commands";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kdb-q-ext-vscode.runSelectedText", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        commands.runSelectedText(editor);
      }
    }),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.toggleBlockComment",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await commands.toggleBlockComment(editor);
        }
      },
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.setPassword", () =>
      commands.setPassword(context.secrets),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.clearPassword", () =>
      commands.clearPassword(context.secrets),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.setPassphrase", () =>
      commands.setPassphrase(context.secrets),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.clearPassphrase", () =>
      commands.clearPassphrase(context.secrets),
    ),
  );
}
