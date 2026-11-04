import * as vscode from "vscode";
import * as commands from "./commands";
import { Connections } from "./connections";
import { exporting, saveCsv } from "./exporting";
import type { Scope } from "./form/fields";
import { ResultView, registerResultView } from "./resultView";
import { openServers, ServerForms } from "./serverForm";
import type { Entry } from "./servers";
import {
  newFolder,
  removeFolder,
  renameFolder,
  ServersView,
} from "./serversView";
import { showStatus } from "./status";

export function activate(context: vscode.ExtensionContext) {
  const open = commands.opener(context.secrets);
  const connections = new Connections(open);
  const results = new ResultView(context.extensionUri);
  const status = showStatus(connections);
  const forms = new ServerForms(
    context.extensionUri,
    context.secrets,
    connections,
    open,
  );
  context.subscriptions.push(
    status,
    forms,
    new ServersView(connections, forms),
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
    // Those a Servers view row offers are given the row
    vscode.commands.registerCommand("kdb-q-ext-vscode.connect", (row?: Entry) =>
      commands.connect(connections, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.makeActive",
      (row: Entry) => commands.connect(connections, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.disconnect",
      (row?: Entry) => commands.disconnect(connections, row),
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
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.addServer",
      (row?: Entry) => forms.add(row?.path),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.editServer",
      (row?: Entry) => commands.editServer(forms, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.removeServer",
      (row?: Entry) => commands.removeServer(connections, forms, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.newFolder",
      (row?: Entry) => newFolder(row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.renameFolder",
      (row: Entry) => renameFolder(connections, forms, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.removeFolder",
      (row: Entry) => removeFolder(connections, forms, row),
    ),
    vscode.commands.registerCommand(
      "kdb-q-ext-vscode.openServersSetting",
      (row: { scope: Scope }) => openServers(row.scope),
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
