// Syntax errors in the Problems: documents open in tabs as they're typed, and
// in workspace mode, every workspace file's as saved
import * as assert from "node:assert";
import * as vscode from "vscode";

const folder = () => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return f.uri;
};

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(condition(), "timed out");
}

// Each problem as "message line:col (related line:col)", from 1
const shown = (uri: vscode.Uri) =>
  vscode.languages.getDiagnostics(uri).map((d) => {
    const at = (r: vscode.Range) =>
      `${r.start.line + 1}:${r.start.character + 1}`;
    const [related] = d.relatedInformation ?? [];
    assert.strictEqual(d.source, "q");
    assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Error);
    return related
      ? `${d.message} ${at(d.range)} (${related.message} ${at(related.location.range)})`
      : `${d.message} ${at(d.range)}`;
  });

const mode = (value: string | undefined) =>
  vscode.workspace
    .getConfiguration("kdb-q-ext-vscode")
    .update("diagnosticMode", value, vscode.ConfigurationTarget.Workspace);

const write = (uri: vscode.Uri, text: string) =>
  vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

// Each test waits on the file watcher, or for typing to pause, which a slow
// machine can take longer than mocha's 2 s for
suite("syntax errors", function () {
  this.timeout(10000);

  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("an open document's, as it's typed", async () => {
    const d = await vscode.workspace.openTextDocument({
      language: "q",
      content: "f:{[x]\n  (x+1;\n  x*2}",
    });
    await vscode.window.showTextDocument(d);
    await waitFor(() => shown(d.uri).length > 0);
    assert.deepStrictEqual(shown(d.uri), [") expected 3:6 (unclosed ( 2:3)"]);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(d.uri, new vscode.Position(2, 5), ")");
    await vscode.workspace.applyEdit(edit);
    await waitFor(() => shown(d.uri).length === 0);
    // Undone, then its tab closed
    const undo = new vscode.WorkspaceEdit();
    undo.delete(d.uri, new vscode.Range(2, 5, 2, 6));
    await vscode.workspace.applyEdit(undo);
    await waitFor(() => shown(d.uri).length > 0);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    await waitFor(() => shown(d.uri).length === 0);
  });

  test("none for a file opened without a tab", async () => {
    // As the References view opens each file it previews
    const uri = vscode.Uri.joinPath(folder(), "untabbed.q");
    await write(uri, "a:(1;2\n");
    try {
      const d = await vscode.workspace.openTextDocument(uri);
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepStrictEqual(shown(d.uri), []);
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
  });

  // Each test's own file, read as the mode changes, not as VS Code's
  // watcher tells of it: those events are the index's own tests'
  suite("workspace mode", () => {
    let broken: vscode.Uri;

    setup(async function () {
      const name = this.currentTest?.title.replace(/\W+/g, "-") ?? "";
      broken = vscode.Uri.joinPath(folder(), "syntax", name, "a.q");
      await write(broken, "a:(1;2\n");
    });
    teardown(async () => {
      await mode(undefined);
      await vscode.workspace.fs
        .delete(vscode.Uri.joinPath(folder(), "syntax"), { recursive: true })
        .then(undefined, () => undefined);
    });

    test("an open file's, then as saved once its tab closes", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken).length > 0);
      const d = await vscode.workspace.openTextDocument(broken);
      await vscode.window.showTextDocument(d);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(d.uri, new vscode.Position(0, 6), ")");
      await vscode.workspace.applyEdit(edit);
      await waitFor(() => shown(broken).length === 0);
      await vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
      await waitFor(() => shown(broken).length > 0);
      assert.deepStrictEqual(shown(broken), [
        ") expected 1:6 (unclosed ( 1:3)",
      ]);
    });

    test("till the setting goes back", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken).length > 0);
      await mode(undefined);
      await waitFor(() => shown(broken).length === 0);
    });

    test("till it's excluded", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken).length > 0);
      const files = vscode.workspace.getConfiguration("files");
      await files.update(
        "exclude",
        { [vscode.workspace.asRelativePath(broken, false)]: true },
        vscode.ConfigurationTarget.Workspace,
      );
      try {
        await waitFor(() => shown(broken).length === 0);
      } finally {
        await files.update(
          "exclude",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    });
  });
});
