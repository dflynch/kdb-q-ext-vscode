import * as vscode from "vscode";
import * as commands from "./commands";
import { Connections } from "./connections";
import { exporting, saveCsv } from "./exporting";
import { ResultView, registerResultView } from "./resultView";
import { ServerForms } from "./serverForm";
import { showStatus } from "./status";

export function activate(context: vscode.ExtensionContext) {
  const connections = new Connections(commands.opener(context.secrets));
  const results = new ResultView(context.extensionUri);
  const status = showStatus(connections);
  const forms = new ServerForms(
    context.extensionUri,
    context.secrets,
    connections,
  );
  context.subscriptions.push(
    status,
    forms,
    connections,
    registerResultView(results),
    vscode.commands.registerCommand("kdb-q-ext-vscode.keepResult", () =>
      results.keep(),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.exportResult", async () =>
      saveCsv(await exporting(results.exportShown())),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.exportKept", async () =>
      saveCsv(await exporting(results.exportKept())),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.copyWithHeaders", () =>
      results.copyWithHeaders(),
    ),
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
          await commands.runFileOnServer(editor, connections, results, status);
        }
      },
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.runOnServer",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await commands.runOnServer(editor, connections, results, status);
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
      forms.add(),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.editServer", () =>
      commands.editServer(forms),
    ),
    vscode.commands.registerCommand("kdb-q-ext-vscode.removeServer", () =>
      commands.removeServer(context.secrets, connections, forms),
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
