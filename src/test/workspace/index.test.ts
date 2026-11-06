// The workspace index, over the q files copied into the test folder as it
// opens: symbol search, and definition and references across files
import * as assert from "node:assert";
import * as vscode from "vscode";

const folder = () => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return f.uri;
};
const file = (path: string) => vscode.Uri.joinPath(folder(), "index", path);

// Each location as "path line:column", from 1, below the fixture folder
const shown = (ls: (vscode.Location | vscode.LocationLink)[]) =>
  ls.map((l) => {
    const [uri, range] =
      "uri" in l ? [l.uri, l.range] : [l.targetUri, l.targetRange];
    const path = uri.path.slice(file("").path.length + 1);
    return `${path} ${range.start.line + 1}:${range.start.character + 1}`;
  });

suite("workspace index", () => {
  // Opening a document isn't needed: the q files activate the extension
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("symbol search", async () => {
    const found = await vscode.commands.executeCommand<
      vscode.SymbolInformation[]
    >("vscode.executeWorkspaceSymbolProvider", "uupd");
    assert.deepStrictEqual(
      found.map((s) => [s.name, s.kind, shown([s.location])[0]]),
      [[".u.upd", vscode.SymbolKind.Function, "code/wdb.q 3:1"]],
    );
  });

  test("definition in another file", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/main.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(2, 3),
    );
    assert.deepStrictEqual(shown(found), ["code/wdb.q 3:1"]);
  });

  test("every file's definition, the nearest first", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/wdb.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(4, 25),
    );
    assert.deepStrictEqual(shown(found), [
      "code/wdb.q 1:1",
      "config/wdb.q 2:1",
    ]);
  });

  test("an export, in its module", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/main.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(1, 5),
    );
    assert.deepStrictEqual(shown(found), ["mods/stats/init.q 1:1"]);
  });

  test("references in every file", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/main.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      d.uri,
      new vscode.Position(2, 3),
    );
    assert.deepStrictEqual(shown(found), [
      "code/main.q 3:1",
      "code/wdb.q 3:1",
      "code/wdb.q 5:10",
    ]);
  });

  test("an unsaved edit, before it's saved", async () => {
    const d = await vscode.workspace.openTextDocument(file("config/wdb.q"));
    await vscode.window.showTextDocument(d);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(d.uri, new vscode.Position(2, 0), ".u.upd:{x}\n");
    await vscode.workspace.applyEdit(edit);
    try {
      const main = await vscode.workspace.openTextDocument(file("code/main.q"));
      const found = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        main.uri,
        new vscode.Position(2, 3),
      );
      assert.deepStrictEqual(shown(found), [
        "code/wdb.q 3:1",
        "config/wdb.q 3:1",
      ]);
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
  });
});
