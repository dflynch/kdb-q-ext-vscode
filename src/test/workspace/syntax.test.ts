// Syntax errors in the Problems: open documents' as they're typed, and in
// workspace mode, every workspace file's as saved
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

suite("syntax errors", () => {
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
    await waitFor(() => shown(d.uri).length > 0);
    assert.deepStrictEqual(shown(d.uri), [") expected 3:6 (unclosed ( 2:3)"]);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(d.uri, new vscode.Position(2, 5), ")");
    await vscode.workspace.applyEdit(edit);
    await waitFor(() => shown(d.uri).length === 0);
  });

  suite("workspace mode", () => {
    const broken = () => vscode.Uri.joinPath(folder(), "broken", "a.q");

    setup(() => write(broken(), "a:(1;2\n"));
    teardown(async () => {
      await mode(undefined);
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(folder(), "broken"),
        {
          recursive: true,
        },
      );
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
