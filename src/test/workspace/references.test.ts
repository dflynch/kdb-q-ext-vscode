// Find All References in VS Code's References view, over the q files copied
// into the test folder: the results passed by reference in a group of their
// own, and VS Code's own tree where there are none
import * as assert from "node:assert";
import * as vscode from "vscode";

type Input = {
  contextValue: string;
  resolve(): Promise<
    | {
        provider: vscode.TreeDataProvider<unknown>;
        message: string;
      }
    | undefined
  >;
};
type SymbolTree = { getInput(): Input | undefined };

const ours = "kdb-q-ext-vscode.references";

const file = (path: string) => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return vscode.Uri.joinPath(f.uri, "index", path);
};

// Runs Find All References from the place, as the editor's menu does, and
// gives the view's new input once ours has replaced VS Code's, else
// VS Code's
async function findAll(path: string, line: number, character: number) {
  const view = vscode.extensions.getExtension<SymbolTree>(
    "vscode.references-view",
  );
  assert.ok(view);
  const tree = await view.activate();
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file(path)),
  );
  const at = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(at, at);
  const before = tree.getInput();
  await vscode.commands.executeCommand("references-view.findReferences");
  for (let i = 0; i < 20; i++) {
    const input = tree.getInput();
    if (input !== before && input?.contextValue === ours) return input;
    await new Promise((r) => setTimeout(r, 50));
  }
  return tree.getInput();
}

// The tree as lines, indented by depth, each result as line:column
async function drawn(
  provider: vscode.TreeDataProvider<unknown>,
  node?: unknown,
  depth = 0,
): Promise<string[]> {
  const out: string[] = [];
  for (const child of (await provider.getChildren(node)) ?? []) {
    const item = await provider.getTreeItem(child);
    const label =
      item.resourceUri?.path.split("/index/")[1] ??
      (typeof item.label === "string" ? item.label : item.label?.label);
    const opened = item.command?.arguments?.[1]?.selection as
      | vscode.Range
      | undefined;
    const where = opened
      ? `${opened.start.line + 1}:${opened.start.character + 1}`
      : `${label}${item.description && item.description !== true ? ` ${item.description}` : ""}`;
    out.push(`${"  ".repeat(depth)}${where}`);
    out.push(...(await drawn(provider, child, depth + 1)));
  }
  return out;
}

suite("references view", () => {
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("passed by reference, in a group of their own", async () => {
    const input = await findAll("code/wdb.q", 4, 26);
    assert.strictEqual(input?.contextValue, ours);
    const model = await input.resolve();
    assert.ok(model);
    assert.strictEqual(model.message, "4 results in 2 files");
    assert.deepStrictEqual(await drawn(model.provider), [
      "code/wdb.q",
      "  1:1",
      "  5:19",
      "config/wdb.q",
      "  2:1",
      "Passed by reference 1",
      "  code/wdb.q",
      "    1:23",
    ]);
  });

  test("copied and dismissed from the tree", async () => {
    const input = await findAll("code/wdb.q", 4, 26);
    const model = await input?.resolve();
    assert.ok(model);
    const [, , group] = (await model.provider.getChildren()) ?? [];
    await vscode.commands.executeCommand(`${ours}.copy`, group);
    assert.strictEqual(
      await vscode.env.clipboard.readText(),
      "Passed by reference\n  index/code/wdb.q\n    1, 23: .merge.limit:@[value;`.merge.limit;0b]\n\n",
    );
    await vscode.commands.executeCommand(`${ours}.dismiss`, group);
    assert.strictEqual(model.message, "3 results in 2 files");
    assert.strictEqual((await model.provider.getChildren())?.length, 2);
  });

  test("VS Code's own tree, with nothing passed by reference", async () => {
    // t, a parameter
    const input = await findAll("code/wdb.q", 4, 6);
    assert.strictEqual(input?.contextValue, "vscode.executeReferenceProvider");
  });
});
