import * as vscode from "vscode";
import * as commands from "./commands";
import { Connections } from "./connections";

export function activate(context: vscode.ExtensionContext) {
  const connections = new Connections(commands.opener(context.secrets));
  context.subscriptions.push(
    commands.showStatus(connections),
    connections,
    vscode.commands.registerCommand("kdb-q-ext-vscode.connect", () =>
      commands.connect(connections),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.disconnect", () =>
      commands.disconnect(connections),
    ),
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
