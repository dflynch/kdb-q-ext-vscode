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

  suite("workspace mode", () => {
    const broken = () => vscode.Uri.joinPath(folder(), "broken", "a.q");

    const moved = () => vscode.Uri.joinPath(folder(), "moved", "a.q");

    // Till the file watcher has told of the file: a delete soon after its
    // creation, while the watcher still holds that, is folded into it, and
    // no delete is told. The index may read it first, from disk, as the
    // mode changes, so a test can't tell from the problems
    setup(async () => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder(), "broken/a.q"),
      );
      try {
        const told = new Promise<void>((resolve) => {
          watcher.onDidCreate(() => resolve());
          watcher.onDidChange(() => resolve());
        });
        await write(broken(), "a:(1;2\n");
        await told;
      } finally {
        watcher.dispose();
      }
    });
    teardown(async () => {
      await mode(undefined);
      for (const name of ["broken", "moved"]) {
        const uri = vscode.Uri.joinPath(folder(), name);
        await vscode.workspace.fs
          .delete(uri, { recursive: true })
          .then(undefined, () => undefined);
      }
    });

    test("open files only by default: none for an unopened file", async () => {
      // Long enough for the index to have read it
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.deepStrictEqual(shown(broken()), []);
    });

    test("an unopened file's, till it's fixed", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      assert.deepStrictEqual(shown(broken()), [
        ") expected 1:6 (unclosed ( 1:3)",
      ]);
      await write(broken(), "a:(1;2)\n");
      await waitFor(() => shown(broken()).length === 0);
    });

    test("an open file's, then as saved once its tab closes", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      const d = await vscode.workspace.openTextDocument(broken());
      await vscode.window.showTextDocument(d);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(d.uri, new vscode.Position(0, 6), ")");
      await vscode.workspace.applyEdit(edit);
      await waitFor(() => shown(broken()).length === 0);
      await vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
      await waitFor(() => shown(broken()).length > 0);
      assert.deepStrictEqual(shown(broken()), [
        ") expected 1:6 (unclosed ( 1:3)",
      ]);
    });

    test("till its folder is deleted", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(folder(), "broken"),
        { recursive: true },
      );
      await waitFor(() => shown(broken()).length === 0);
    });

    test("in its folder's new place, once moved", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      await vscode.workspace.fs.rename(
        vscode.Uri.joinPath(folder(), "broken"),
        vscode.Uri.joinPath(folder(), "moved"),
      );
      await waitFor(
        () => shown(broken()).length === 0 && shown(moved()).length > 0,
      );
    });

    test("till it's deleted", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      await vscode.workspace.fs.delete(broken());
      await waitFor(() => shown(broken()).length === 0);
    });

    test("till the setting goes back", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      await mode(undefined);
      await waitFor(() => shown(broken()).length === 0);
    });

    test("till it's excluded", async () => {
      await mode("workspace");
      await waitFor(() => shown(broken()).length > 0);
      const files = vscode.workspace.getConfiguration("files");
      await files.update(
        "exclude",
        { "broken/**": true },
        vscode.ConfigurationTarget.Workspace,
      );
      try {
        await waitFor(() => shown(broken()).length === 0);
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
