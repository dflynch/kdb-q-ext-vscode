import { homedir } from "node:os";
import * as vscode from "vscode";
import type { Exported } from "./resultView";

// Where the last export was saved, for the next to be saved beside it, this
// session; at first, the workspace's folder, or the home folder with none
let folder: vscode.Uri | undefined;

// Shown in the status bar while the webview writes the CSV: a million rows
// of five columns take a second and a half
export function exporting(exported: Promise<Exported>): Promise<Exported> {
  return Promise.resolve(
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Exporting to CSV" },
      () => exported,
    ),
  );
}

// Saves a grid exported as CSV where the user says, then offers to open it
// or show it in its folder. Nothing with another view shown, as when the
// view changed, or the webview closed, as it was asked for.
export async function saveCsv({ csv, rows }: Exported) {
  if (!csv) {
    vscode.window.showInformationMessage(
      "kdb+/q: The Grid isn't shown, so there's nothing to export.",
    );
    return;
  }
  const where =
    folder ??
    vscode.workspace.workspaceFolders?.[0]?.uri ??
    vscode.Uri.file(homedir());
  const uri = await vscode.window.showSaveDialog({
    title: "Export to CSV",
    defaultUri: vscode.Uri.joinPath(where, "result.csv"),
    filters: { CSV: ["csv"] },
  });
  if (!uri) {
    return;
  }
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  try {
    await vscode.workspace.fs.writeFile(uri, csv);
  } catch (error) {
    vscode.window.showErrorMessage(
      `kdb+/q: ${name} couldn't be saved. ${error instanceof Error ? error.message : error}`,
    );
    return;
  }
  folder = vscode.Uri.joinPath(uri, "..");
  const open = "Open";
  const reveal = revealLabel();
  const choice = await vscode.window.showInformationMessage(
    `kdb+/q: Exported ${rows} ${rows === 1 ? "row" : "rows"} to ${name}.`,
    open,
    reveal,
  );
  if (choice === open) {
    await vscode.commands.executeCommand("vscode.open", uri);
  } else if (choice === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", uri);
  }
}

// What VS Code calls showing a file in its folder, on each platform
function revealLabel(): string {
  switch (process.platform) {
    case "darwin":
      return "Reveal in Finder";
    case "win32":
      return "Reveal in File Explorer";
  }
  return "Open Containing Folder";
}
