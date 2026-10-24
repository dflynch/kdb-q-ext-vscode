import * as vscode from "vscode";
import * as commands from "./commands";
import { Connections } from "./connections";
import { registerResultView } from "./resultView";
import { showStatus } from "./status";

export function activate(context: vscode.ExtensionContext) {
  const connections = new Connections(commands.opener(context.secrets));
  const output = vscode.window.createOutputChannel("kdb+/q");
  const status = showStatus(connections);
  context.subscriptions.push(
    output,
    status,
    connections,
    registerResultView(context.extensionUri),
    vscode.commands.registerCommand("kdb-q-ext-vscode.connect", () =>
      commands.connect(connections),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.disconnect", () =>
      commands.disconnect(connections),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.showServerMenu",
      commands.showServerMenu,
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `@ext:${context.extension.id}`,
      ),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.runFileOnServer",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await commands.runFileOnServer(editor, connections, output, status);
        }
      },
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.runOnServer",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await commands.runOnServer(editor, connections, output, status);
        }
      },
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
    vscode.commands.registerCommand("kdb-q-ext-vscode.addServer", () =>
      commands.addServer(context.secrets, connections),
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
