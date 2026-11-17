import * as assert from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as vscode from "vscode";
import { TerminalRun } from "../terminal";

async function open(content: string) {
  const doc = await vscode.workspace.openTextDocument({
    language: "q",
    content,
  });
  const editor = await vscode.window.showTextDocument(doc);
  editor.options = { insertSpaces: true, tabSize: 2 };
  // Use the content's line endings, or LF, rather than the OS default
  const eol = content.includes("\r\n")
    ? vscode.EndOfLine.CRLF
    : vscode.EndOfLine.LF;
  await editor.edit((edit) => edit.setEndOfLine(eol));
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
      "comment out lines up to a \\ ending the script",
      "a\n\\\nb",
      [0, 0, 2, 1],
      "/\na\n\\\n\\\nb",
      [1, 0, 4, 1],
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
    [
      "comment out lines with CRLF line endings",
      "a:1\r\nb:2",
      [0, 0, 0, 0],
      "/\r\na:1\r\n\\\r\nb:2",
      [1, 0, 1, 0],
    ],
    [
      "uncomment a block with CRLF line endings",
      "a:1\r\n/\r\nb:2\r\n\\\r\nc:3",
      [2, 1, 2, 1],
      "a:1\r\nb:2\r\nc:3",
      [1, 1, 1, 1],
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

  test("toggle block comment with several selections", async () => {
    const editor = await open("a:1\n/\nb:2\n\\\nc:3\nd:4");
    editor.selections = [
      new vscode.Selection(0, 0, 0, 0),
      new vscode.Selection(2, 0, 2, 0),
      new vscode.Selection(4, 1, 4, 1),
    ];
    await vscode.commands.executeCommand("kdb-q-ext-vscode.toggleBlockComment");
    assert.strictEqual(
      editor.document.getText(),
      "/\na:1\n\\\nb:2\n/\nc:3\n\\\nd:4",
    );
    assert.deepStrictEqual(
      editor.selections.map((s) => [s.active.line, s.active.character]),
      [
        [1, 0],
        [3, 0],
        [5, 1],
      ],
    );
    await vscode.commands.executeCommand("undo");
    assert.strictEqual(editor.document.getText(), "a:1\n/\nb:2\n\\\nc:3\nd:4");
  });

  test("toggle block comment twice", async () => {
    const editor = await open("a:1\nb:2");
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await vscode.commands.executeCommand("kdb-q-ext-vscode.toggleBlockComment");
    await vscode.commands.executeCommand("kdb-q-ext-vscode.toggleBlockComment");
    assert.strictEqual(editor.document.getText(), "a:1\nb:2");
  });
});

suite("q Run Selected Text in Terminal", () => {
  // What the terminal receives
  let received = "";
  let terminal: vscode.Terminal;

  // VS Code starts the terminal, and delivers its first input, in its own
  // time, which can be seconds on CI's macOS: a round trip here, so that no
  // test is charged for it
  suiteSetup(async function () {
    this.timeout(10000);
    const write = new vscode.EventEmitter<string>();
    terminal = vscode.window.createTerminal({
      name: "q",
      pty: {
        onDidWrite: write.event,
        open: () => {},
        close: () => {},
        handleInput: (data: string) => {
          received += data;
        },
      },
    });
    terminal.show();
    await waitFor(() => vscode.window.activeTerminal === terminal);
    terminal.sendText("");
    await waitFor(() => received !== "");
  });

  suiteTeardown(() => terminal.dispose());

  teardown(close);

  // The file q is asked to load after running with the given selections
  async function run(content: string, selections: vscode.Selection[]) {
    const editor = await open(content);
    editor.selections = selections;
    received = "";
    await vscode.commands.executeCommand("kdb-q-ext-vscode.runSelectedText");
    await waitFor(() => /\r\n?|\n/.test(received));
    const match = /^\\l (\S+\.q)(?:\r\n?|\n)$/.exec(received);
    assert.ok(match, `sent ${JSON.stringify(received)}`);
    return match[1];
  }

  // The script q is asked to load
  async function script(content: string, selections: vscode.Selection[]) {
    return readFileSync(await run(content, selections), "utf8");
  }

  test("run the current line", async () => {
    assert.strictEqual(
      await script("a:1\nb:2", [new vscode.Selection(1, 1, 1, 1)]),
      "b:2",
    );
  });

  test("run a selection as written", async () => {
    const content = 'f:{\n  x} / f\n/ note\ns:"a\n b"\n\\d .foo\nb:2';
    assert.strictEqual(
      await script(content, [new vscode.Selection(0, 0, 6, 3)]),
      content,
    );
  });

  test("run a selection with CRLF line endings", async () => {
    assert.strictEqual(
      await script("f:{\r\n  x}\r\nb:2", [new vscode.Selection(0, 0, 2, 3)]),
      "f:{\r\n  x}\r\nb:2",
    );
  });

  test("run several selections", async () => {
    assert.strictEqual(
      await script("a:1\nb:2\nc:3", [
        new vscode.Selection(2, 0, 2, 0),
        new vscode.Selection(0, 0, 0, 0),
        new vscode.Selection(0, 2, 0, 2),
      ]),
      "a:1\nc:3",
    );
  });

  test("run several selections with CRLF line endings", async () => {
    assert.strictEqual(
      await script("a:1\r\nb:2\r\nc:3", [
        new vscode.Selection(2, 0, 2, 0),
        new vscode.Selection(0, 0, 0, 0),
      ]),
      "a:1\r\nc:3",
    );
  });

  test("each run has a file of its own", async () => {
    const first = await run("a:1", [new vscode.Selection(0, 0, 0, 0)]);
    await close();
    const second = await run("b:2", [new vscode.Selection(0, 0, 0, 0)]);
    assert.notStrictEqual(first, second);
    assert.strictEqual(readFileSync(first, "utf8"), "a:1");
    assert.strictEqual(readFileSync(second, "utf8"), "b:2");
    if (process.platform !== "win32") {
      assert.strictEqual(statSync(second).mode & 0o777, 0o600);
    }
  });

  test("its files are removed when it's disposed", async () => {
    const editor = await open("a:1");
    received = "";
    const runs = new TerminalRun();
    runs.run(editor);
    await waitFor(() => /\r\n?|\n/.test(received));
    const file = /^\\l (\S+\.q)/.exec(received)?.[1] ?? "";
    assert.ok(existsSync(file), file);
    runs.dispose();
    assert.ok(!existsSync(file), file);
  });
});

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 50 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(condition(), "timed out");
}
