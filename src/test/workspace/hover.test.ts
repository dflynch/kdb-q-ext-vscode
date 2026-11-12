// Hover over the q files copied into the test folder: q's own entries, and
// a global's signature, comment and file, with a link to its other
// definitions
import * as assert from "node:assert";
import * as vscode from "vscode";

const file = (path: string) => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return vscode.Uri.joinPath(f.uri, "index", path);
};

// Each hover's markdown, at a line and column from 1
async function hovered(path: string, line: number, column: number) {
  const d = await vscode.workspace.openTextDocument(file(path));
  const found = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    d.uri,
    new vscode.Position(line - 1, column - 1),
  );
  return found.map((h) =>
    h.contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n")
      // Without the folder's own path, which differs from run to run
      .replaceAll(file("").toString(), "…/"),
  );
}

suite("hover", () => {
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("a keyword, from q's reference", async () => {
    assert.deepStrictEqual(await hovered("code/wdb.q", 3, 15), [
      "\n```q\nx insert y    insert[x;y]\n```\n" +
        "append&nbsp;records&nbsp;to&nbsp;a&nbsp;table\n\n" +
        "[code.kx.com](<https://code.kx.com/q/ref/insert/>)",
    ]);
  });

  test("a function in another file: its signature and file", async () => {
    assert.deepStrictEqual(await hovered("code/main.q", 3, 3), [
      "\n```q\n.u.upd[t;x]\n```\n\n\n" +
        "[index/code/wdb.q](<…//code/wdb.q#L3%2C1>)",
    ]);
  });

  test("the nearest definition, and a link to the others", async () => {
    const [shown] = await hovered("code/wdb.q", 5, 25);
    const args = encodeURIComponent(
      JSON.stringify([file("code/wdb.q").toString(), 4, 24]),
    );
    assert.strictEqual(
      shown,
      "\n```q\n.merge.limit\n```\n\n\n" +
        `[1 more definition](command:kdb-q-ext-vscode.peekDefinitions?${args})`,
    );
  });

  test("the signature, then the comment above, as written", async () => {
    assert.deepStrictEqual(await hovered("config/wdb.q", 2, 3), [
      "\n```q\n.merge.limit\n```\n" +
        "\n```q\n// Defaults, as a process's settings set them\n```\n\n\n" +
        "[1 more definition](command:kdb-q-ext-vscode.peekDefinitions?" +
        encodeURIComponent(
          JSON.stringify([file("config/wdb.q").toString(), 1, 2]),
        ) +
        ")",
    ]);
  });

  test("a comment holding a fence, in a longer one", async () => {
    assert.deepStrictEqual(await hovered("code/doc.q", 7, 1), [
      "\n```q\ntwice[x]\n```\n" +
        "\n````q\n/\n Doubles a number:\n  ```\n  twice 2\n  ```\n\\\n````\n",
    ]);
  });

  test("an export, as its module defines it", async () => {
    assert.deepStrictEqual(await hovered("code/main.q", 2, 5), [
      "\n```q\nmean[x]\n```\n\n\n[index/mods/stats/init.q](<…//mods/stats/init.q#L1%2C1>)",
    ]);
  });

  test("the link's command peeks at every definition", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/wdb.q"));
    await vscode.window.showTextDocument(d);
    const peeked = await vscode.commands.executeCommand<vscode.Location[]>(
      "kdb-q-ext-vscode.peekDefinitions",
      d.uri.toString(),
      4,
      24,
    );
    await vscode.commands.executeCommand("closeReferenceSearch");
    assert.deepStrictEqual(
      peeked.map(
        (l) =>
          `${vscode.workspace.asRelativePath(l.uri)} ${l.range.start.line}`,
      ),
      ["index/code/wdb.q 0", "index/config/wdb.q 1"],
    );
  });

  test("nothing for a parameter", async () => {
    assert.deepStrictEqual(await hovered("code/wdb.q", 3, 13), []);
  });
});
