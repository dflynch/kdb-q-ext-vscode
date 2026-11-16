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

  test("each definition in a file", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/again.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(5, 0),
    );
    // In VS Code's order, by file and position
    assert.deepStrictEqual(shown(found), [
      "code/again.q 1:1",
      "code/again.q 4:1",
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

  test("an export, through a module bound in another file", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/report.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(1, 5),
    );
    assert.deepStrictEqual(shown(found), ["mods/stats/init.q 1:1"]);
    // And as s`mean
    const keyed = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(3, 4),
    );
    assert.deepStrictEqual(shown(keyed), ["mods/stats/init.q 1:1"]);
  });

  test("a module's own global, only in the module", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/report.q"));
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      d.uri,
      new vscode.Position(2, 3),
    );
    assert.deepStrictEqual(shown(found), []);
    // Symbol search still finds it, as written in the module
    const listed = await vscode.commands.executeCommand<
      vscode.SymbolInformation[]
    >("vscode.executeWorkspaceSymbolProvider", "spread");
    assert.deepStrictEqual(
      listed.map((s) => shown([s.location])[0]),
      ["mods/stats/init.q 4:1"],
    );
  });

  test("the files a \\l may load", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/load.q"));
    const links = (line: number, character: number) =>
      vscode.commands.executeCommand<vscode.LocationLink[]>(
        "vscode.executeDefinitionProvider",
        d.uri,
        new vscode.Position(line, character),
      );
    const at = (line: number, character: number) =>
      links(line, character).then(shown);
    assert.deepStrictEqual(await at(1, 12), ["config/wdb.q 1:1"]);
    // Linked from the whole path, as Cmd+hover underlines it
    const [link] = await links(1, 4);
    assert.ok(link.originSelectionRange);
    assert.strictEqual(d.getText(link.originSelectionRange), "../config/wdb.q");
    // In VS Code's order, by file
    assert.deepStrictEqual(await at(2, 5), [
      "code/wdb.q 1:1",
      "config/wdb.q 1:1",
    ]);
    assert.deepStrictEqual(await at(2, 1), []);
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

  // The one test of VS Code's watcher reaching the index, the rest of
  // whose answers to file events are tested with stand-ins. Early in a run
  // the watcher may not be telling of changes yet, so till the file is
  // read it's written again, as VS Code tells of the change. Deleted once
  // read, as a delete while its creation is still held back is lost
  test("files created and deleted on disk, as VS Code's watcher tells", async function () {
    this.timeout(15000);
    const made = file("made.q");
    const names = () =>
      vscode.commands
        .executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          ".made.f",
        )
        .then((found) => found.map((s) => s.name));
    const until = async (done: (n: string[]) => boolean, ms: number) => {
      for (let i = 0; i < ms / 100 && !done(await names()); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return done(await names());
    };
    try {
      let read = false;
      for (let i = 0; i < 8 && !read; i++) {
        await vscode.workspace.fs.writeFile(
          made,
          new TextEncoder().encode(".made.f:{x}"),
        );
        read = await until((n) => n.length > 0, 1000);
      }
      assert.ok(read, "the watcher told of no change in 8 s");
      assert.deepStrictEqual(await names(), [".made.f"]);
      await vscode.workspace.fs.delete(made);
      assert.ok(
        await until((n) => n.length === 0, 5000),
        "the watcher told of no delete in 5 s",
      );
    } finally {
      await vscode.workspace.fs.delete(made).then(undefined, () => undefined);
    }
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
