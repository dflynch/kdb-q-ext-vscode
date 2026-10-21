import * as assert from "node:assert";
import * as vscode from "vscode";

async function open(content: string) {
  const doc = await vscode.workspace.openTextDocument({
    language: "q",
    content,
  });
  const editor = await vscode.window.showTextDocument(doc);
  editor.options = { insertSpaces: true, tabSize: 2 };
  // VS Code skips language indent rules on lines it hasn't tokenized yet
  await vscode.commands.executeCommand("editor.action.forceRetokenize");
  return editor;
}

async function close() {
  await vscode.commands.executeCommand(
    "workbench.action.revertAndCloseActiveEditor",
  );
}

suite("q editing", () => {
  teardown(close);

  // The text after typing at [line, character]. q reads a line at column 0
  // as a new statement, so closing brackets must stay indented.
  const typing: [string, string, number, number, string, string][] = [
    ["enter between braces", "f:{}", 0, 3, "\n", "f:{\n  }"],
    ["enter twice between braces", "f:{}", 0, 3, "\n\n", "f:{\n  \n  }"],
    ["enter between brackets", "f[]", 0, 2, "\n", "f[\n  ]"],
    ["enter between parentheses", "a:()", 0, 3, "\n", "a:(\n  )"],
    ["enter after an open brace", "f:{", 0, 3, "\n", "f:{\n  "],
    ["enter after a body line", "f:{\n  x", 1, 3, "\n", "f:{\n  x\n  "],
    ["enter after a statement", "a:1", 0, 3, "\n", "a:1\n"],
  ];

  for (const [name, content, line, character, text, expected] of typing) {
    test(name, async () => {
      const editor = await open(content);
      editor.selection = new vscode.Selection(line, character, line, character);
      await vscode.commands.executeCommand("type", { text });
      assert.strictEqual(editor.document.getText(), expected);
    });
  }

  test("toggle line comment", async () => {
    const editor = await open("a:1\nf:{\n  x}");
    editor.selection = new vscode.Selection(0, 0, 2, 4);
    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.strictEqual(editor.document.getText(), "/ a:1\n/ f:{\n/   x}");
    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.strictEqual(editor.document.getText(), "a:1\nf:{\n  x}");
  });

  test("fold block comment", async () => {
    const editor = await open("a:1\n/\nnote\nmore\n\\\nb:2");
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await vscode.commands.executeCommand("editor.fold");
    const visible = editor.visibleRanges.flatMap((r) => {
      const lines = [];
      for (let i = r.start.line; i <= r.end.line; i++) lines.push(i);
      return lines;
    });
    assert.deepStrictEqual(visible, [0, 1, 5]);
  });

  // [text, selection] before and after Toggle Block Comment
  const blockComments: [string, string, number[], string, number[]][] = [
    [
      "comment out lines inside a function",
      "f:{\n  a:1;\n  b:2;\n  a}",
      [2, 0, 2, 6],
      "f:{\n  a:1;\n/\n  b:2;\n\\\n  a}",
      [3, 0, 3, 6],
    ],
    [
      "comment out lines ending at column 0",
      "a:1\nb:2\nc:3",
      [0, 0, 2, 0],
      "/\na:1\nb:2\n\\\nc:3",
      [1, 0, 3, 0],
    ],
    [
      "uncomment a block",
      "a:1\n/\nb:2\n\\\nc:3",
      [2, 1, 2, 1],
      "a:1\nb:2\nc:3",
      [1, 1, 1, 1],
    ],
    [
      "uncomment a block at the end of the file",
      "a:1\n/\n\\",
      [1, 0, 1, 0],
      "a:1",
      [0, 3, 0, 3],
    ],
  ];

  for (const [name, before, from, after, to] of blockComments) {
    test(name, async () => {
      const editor = await open(before);
      editor.selection = new vscode.Selection(
        from[0],
        from[1],
        from[2],
        from[3],
      );
      await vscode.commands.executeCommand(
        "kdb-q-ext-vscode.toggleBlockComment",
      );
      assert.strictEqual(editor.document.getText(), after);
      const { start, end } = editor.selection;
      assert.deepStrictEqual(
        [start.line, start.character, end.line, end.character],
        to,
      );
    });
  }

  test("toggle block comment twice", async () => {
    const editor = await open("a:1\nb:2");
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await vscode.commands.executeCommand("kdb-q-ext-vscode.toggleBlockComment");
    await vscode.commands.executeCommand("kdb-q-ext-vscode.toggleBlockComment");
    assert.strictEqual(editor.document.getText(), "a:1\nb:2");
  });
});
