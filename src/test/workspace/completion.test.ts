// Completion over the q files copied into the test folder, as VS Code asks
// for it: what's offered, as which kind, over what typed, with what detail
// and documentation; and VS Code's word-based suggestions off for q
import * as assert from "node:assert";
import * as vscode from "vscode";

const untitled = (content: string) =>
  vscode.workspace.openTextDocument({ language: "q", content });

// The items offered at the end of the document's text, by label
async function offered(d: vscode.TextDocument, trigger?: string) {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    d.uri,
    d.positionAt(d.getText().length),
    trigger,
    // Resolve each, for its documentation
    10000,
  );
  return new Map(
    list.items.map((i) => [
      typeof i.label === "string" ? i.label : i.label.label,
      i,
    ]),
  );
}

const inserted = (d: vscode.TextDocument, i: vscode.CompletionItem) => {
  const r = i.range;
  assert.ok(r && !(r instanceof vscode.Range));
  return d.getText(r.inserting);
};

const documented = (i: vscode.CompletionItem | undefined) => {
  const doc = i?.documentation;
  return typeof doc === "string" ? doc : (doc?.value ?? "");
};

suite("completion", () => {
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("word-based suggestions are off for q", () => {
    const editor = vscode.workspace.getConfiguration("editor", {
      languageId: "q",
    });
    assert.strictEqual(editor.get("wordBasedSuggestions"), "off");
  });

  test("parameters before keywords, and globals from other files", async () => {
    const d = await untitled("f:{[price;qty] pr");
    const items = await offered(d);
    const price = items.get("price");
    assert.strictEqual(price?.kind, vscode.CompletionItemKind.Variable);
    assert.strictEqual(price && inserted(d, price), "pr");
    assert.strictEqual(
      items.get("run")?.kind,
      vscode.CompletionItemKind.Function,
    );
    assert.strictEqual(
      items.get("prd")?.kind,
      vscode.CompletionItemKind.Keyword,
    );
    assert.ok(
      (price?.sortText ?? "") < (items.get("prd")?.sortText ?? ""),
      "in scope before q's",
    );
  });

  test("a namespace's members after a dot, with signature and file", async () => {
    const d = await untitled("x:.u.");
    const upd = (await offered(d, ".")).get(".u.upd");
    assert.strictEqual(upd?.kind, vscode.CompletionItemKind.Function);
    assert.strictEqual(upd?.detail, "[t;x]");
    assert.strictEqual(upd && inserted(d, upd), ".u.");
    assert.match(documented(upd), /index\/code\/wdb\.q/);
  });

  test("q's own, with KX's line and link", async () => {
    const d = await untitled("x:.Q.");
    const s1 = (await offered(d, ".")).get(".Q.s1");
    assert.strictEqual(s1?.kind, vscode.CompletionItemKind.Function);
    assert.ok(s1?.detail);
    assert.match(documented(s1), /code\.kx\.com/);
  });

  test(".z's as events, as q's hooks", async () => {
    const items = await offered(await untitled("x:.z."), ".");
    for (const name of [".z.pg", ".z.p"]) {
      assert.strictEqual(
        items.get(name)?.kind,
        vscode.CompletionItemKind.Event,
      );
    }
  });

  test("a module's exports", async () => {
    const d = await untitled("s:use`stats\nx:s.");
    const mean = (await offered(d, ".")).get("s.mean");
    assert.strictEqual(mean?.kind, vscode.CompletionItemKind.Function);
  });

  test("nothing in a string", async () => {
    const d = await untitled('x:"pr');
    assert.strictEqual((await offered(d)).size, 0);
  });
});
