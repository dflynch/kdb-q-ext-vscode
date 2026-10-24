import * as assert from "node:assert";
import * as vscode from "vscode";
import type { Value } from "../codec/types";
import { runOnServer } from "../commands";
import {
  type Connection,
  QError,
  type Result,
  type Timing,
} from "../connection";
import { Connections } from "../connections";
import { defaultSize } from "../format/console";
import { consoleText, sizeSetting } from "../result";
import type { Definition } from "../servers";

const long = (n: number): Value => ({ type: -7, value: BigInt(n) });
const generic: Value = { type: 101, code: 0 };

const til = (n: number): Value => ({
  type: 7,
  attribute: 0,
  data: BigInt64Array.from({ length: n }, (_, i) => BigInt(i)),
});

suite("result", () => {
  test("a result as the q console shows it", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: til(3), timing: { roundtrip: 0 } } },
        defaultSize,
      ),
      "0 1 2",
    );
  });

  test(":: shows nothing, as an assignment's result", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: generic, timing: { roundtrip: 0 } } },
        defaultSize,
      ),
      "",
    );
  });

  test("an error after a ', with its backtrace", () => {
    const error = new QError(
      "type",
      { roundtrip: 1, execution: 0 },
      "  [0]  1+`a\n        ^\n",
    );
    assert.strictEqual(
      consoleText({ error }, defaultSize),
      "'type\n  [0]  1+`a\n        ^",
    );
  });

  test("an error of ours, the same way", () => {
    assert.strictEqual(
      consoleText({ error: new Error("the result is too big") }, defaultSize),
      "'the result is too big",
    );
  });

  test("the result cut at the console size", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: til(100), timing: { roundtrip: 0 } } },
        { lines: 10, width: 10 },
      ),
      "0 1 2 3 ..",
    );
  });

  test("the console size is lines then width, each from 10 to 2000", () => {
    assert.deepStrictEqual(sizeSetting(undefined), {
      size: defaultSize,
      problems: [],
    });
    assert.deepStrictEqual(sizeSetting([25, 80]), {
      size: { ...defaultSize, lines: 25, width: 80 },
      problems: [],
    });
    for (const wrong of [[9, 80], [25, 2001], [25], [25, 80.5], "25 80"]) {
      assert.deepStrictEqual(
        sizeSetting(wrong),
        {
          size: defaultSize,
          problems: [
            "the console size isn't two whole numbers from 10 to 2000",
          ],
        },
        JSON.stringify(wrong),
      );
    }
  });
});

// A stand-in connection answering each query from a script
function scripted(answers: (Result | Error)[]) {
  const sent: string[] = [];
  const link = {
    closed: new Promise<Error>(() => {}),
    close: () => {},
    query: async (text: string) => {
      sent.push(text);
      const answer = answers.shift();
      if (answer === undefined || answer instanceof Error) {
        throw answer ?? new Error("no answer scripted");
      }
      return answer;
    },
  };
  return { link: link as unknown as Connection, sent };
}

// An output channel keeping what it shows, which is replaced each time, and
// a status bar keeping what it's told: a query running, then its timing
function shown() {
  const lines: string[] = [];
  const timed: [string, Timing | "running" | undefined][] = [];
  return {
    lines,
    timed,
    output: {
      replace: (text: string) => lines.splice(0, lines.length, text),
      show: () => {},
    } as unknown as vscode.OutputChannel,
    status: {
      running: (name: string) => timed.push([name, "running"]),
      timed: (name: string, timing?: Timing) => timed.push([name, timing]),
    },
  };
}

const prod: Definition = { name: "prod", host: "kdb1", port: 5010 };

// A q editor with the text given, all of it selected
async function selecting(content: string) {
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument({ language: "q", content }),
  );
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
  return editor;
}

suite("runOnServer", () => {
  teardown(() =>
    vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    ),
  );

  test("sends the selected text as one query, as written", async () => {
    const timing = { roundtrip: 3, execution: 2 };
    const { link, sent } = scripted([{ value: long(2), timing }]);
    const connections = new Connections<Connection>(async () => link);
    await connections.connect(prod);
    const { lines, timed, output, status } = shown();
    await runOnServer(
      await selecting("f:{\n  x+1} / add one\nf 1"),
      connections,
      output,
      status,
    );
    assert.deepStrictEqual(sent, ["f:{\n  x+1} / add one\nf 1"]);
    assert.deepStrictEqual(lines, ["2"]);
    assert.deepStrictEqual(timed, [
      ["prod", "running"],
      ["prod", timing],
    ]);
  });

  test("with nothing selected, the current line, and an error", async () => {
    const timing = { roundtrip: 0, execution: 0 };
    const { link, sent } = scripted([new QError("type", timing)]);
    const connections = new Connections<Connection>(async () => link);
    await connections.connect(prod);
    const { lines, timed, output, status } = shown();
    const editor = await selecting("a:1\n1+`a\nb:2");
    editor.selection = new vscode.Selection(1, 2, 1, 2);
    await runOnServer(editor, connections, output, status);
    assert.deepStrictEqual(sent, ["1+`a"]);
    assert.deepStrictEqual(lines, ["'type"]);
    assert.deepStrictEqual(timed, [
      ["prod", "running"],
      ["prod", timing],
    ]);
  });

  test("each result replaces the last", async () => {
    const { link } = scripted([
      { value: long(1), timing: { roundtrip: 0 } },
      { value: long(2), timing: { roundtrip: 0 } },
    ]);
    const connections = new Connections<Connection>(async () => link);
    await connections.connect(prod);
    const { lines, output, status } = shown();
    await runOnServer(await selecting("1"), connections, output, status);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    await runOnServer(await selecting("2"), connections, output, status);
    assert.deepStrictEqual(lines, ["2"]);
  });

  test("an error of ours has no timing", async () => {
    const { link } = scripted([new Error("the connection closed")]);
    const connections = new Connections<Connection>(async () => link);
    await connections.connect(prod);
    const { lines, timed, output, status } = shown();
    await runOnServer(await selecting("1"), connections, output, status);
    assert.deepStrictEqual(lines, ["'the connection closed"]);
    assert.deepStrictEqual(timed, [
      ["prod", "running"],
      ["prod", undefined],
    ]);
  });
});
