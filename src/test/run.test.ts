import * as assert from "node:assert";
import * as vscode from "vscode";
import { runFileOnServer, runOnServer } from "../commands";
import {
  type Connection,
  QError,
  type Result,
  type Timing,
} from "../connection";
import { Connections } from "../connections";
import type { Results } from "../resultView";
import type { Definition } from "../servers";
import type { Status } from "../status";
import { consoleText } from "../webview/console";

// q's -8! of a long
function long(n: number): Uint8Array {
  const message = Uint8Array.of(1, 0, 0, 0, 17, 0, 0, 0, 0xf9, ...Array(8));
  new DataView(message.buffer).setBigInt64(9, BigInt(n), true);
  return message;
}
const prod: Definition = { name: "prod", host: "kdb1", port: 5010 };

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

// Connections with the given one open, as prod
async function opened(link: Connection) {
  const connections = new Connections<Connection>(async () => link);
  await connections.connect(prod);
  return connections;
}

// A Result view keeping each text it shows, as the Console view shows it,
// and a status bar keeping each query's start and end
function shown() {
  const replaced: string[] = [];
  const told: (string | Timing | undefined)[][] = [];
  const results: Results = {
    reveal: async () => {},
    show: (message) => replaced.push(consoleText(message)),
  };
  const status: Status = {
    running: (name) => {
      told.push(["running", name]);
      return (timing) => told.push(["ended", name, timing]);
    },
  };
  return { replaced, told, results, status };
}

// A q editor with the text given, all of it selected
async function selecting(content: string) {
  const editor = await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument({ language: "q", content }),
  );
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(new vscode.Position(0, 0), end);
  return editor;
}

const close = () =>
  vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

suite("runOnServer", () => {
  teardown(close);

  test("sends the selected text as one query, as written", async () => {
    const timing = { roundtrip: 3, execution: 2 };
    const { link, sent } = scripted([{ message: long(2), timing }]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("f:{\n  x+1} / add one\nf 1"),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(sent, ["f:{\n  x+1} / add one\nf 1"]);
    assert.deepStrictEqual(replaced, ["2"]);
    assert.deepStrictEqual(told, [
      ["running", "prod"],
      ["ended", "prod", timing],
    ]);
  });

  test("with nothing selected, the current line", async () => {
    const { link, sent } = scripted([
      { message: long(1), timing: { roundtrip: 0 } },
    ]);
    const editor = await selecting("a:1\n1+1\nb:2");
    editor.selection = new vscode.Selection(1, 2, 1, 2);
    const { results, status } = shown();
    await runOnServer(editor, await opened(link), results, status);
    assert.deepStrictEqual(sent, ["1+1"]);
  });

  test("a blank line sends nothing", async () => {
    const { link, sent } = scripted([]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("  "),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(replaced, []);
    assert.deepStrictEqual(told, []);
  });

  test("each result replaces the last", async () => {
    const { link } = scripted([
      { message: long(1), timing: { roundtrip: 0 } },
      { message: long(2), timing: { roundtrip: 0 } },
    ]);
    const connections = await opened(link);
    const { replaced, results, status } = shown();
    await runOnServer(await selecting("1"), connections, results, status);
    await close();
    await runOnServer(await selecting("2"), connections, results, status);
    assert.deepStrictEqual(replaced, ["1", "2"]);
  });

  test("an error signalled, with its timing", async () => {
    const timing = { roundtrip: 0, execution: 0 };
    const { link } = scripted([new QError("type", timing)]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("1+`a"),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(replaced, ["'type"]);
    assert.deepStrictEqual(told.at(-1), ["ended", "prod", timing]);
  });

  test("an error of ours, with no timing", async () => {
    const { link } = scripted([new Error("connection closed unexpectedly")]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("1"),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(replaced, ["'connection closed unexpectedly"]);
    assert.deepStrictEqual(told.at(-1), ["ended", "prod", undefined]);
  });

  test("the query ends even if showing its result fails", async () => {
    const { link } = scripted([{ message: long(1), timing: { roundtrip: 0 } }]);
    const { told, status } = shown();
    const results: Results = {
      reveal: async () => {},
      show: () => {
        throw new Error("can't show it");
      },
    };
    await assert.rejects(
      runOnServer(await selecting("1"), await opened(link), results, status),
      { message: "can't show it" },
    );
    assert.deepStrictEqual(told.at(-1), ["ended", "prod", { roundtrip: 0 }]);
  });

  test("waits for the active connection while it opens", async () => {
    const { link, sent } = scripted([
      { message: long(1), timing: { roundtrip: 0 } },
    ]);
    let open: (link: Connection) => void = () => {};
    const connections = new Connections<Connection>(
      () => new Promise((resolve) => (open = resolve)),
    );
    const connecting = connections.connect(prod);
    const { replaced, results, status } = shown();
    const run = runOnServer(await selecting("1"), connections, results, status);
    open(link);
    await Promise.all([connecting, run]);
    assert.deepStrictEqual(sent, ["1"]);
    assert.deepStrictEqual(replaced, ["1"]);
  });
});

suite("runFileOnServer", () => {
  teardown(close);

  test("sends the whole file as one query, whatever is selected", async () => {
    const { link, sent } = scripted([
      { message: long(2), timing: { roundtrip: 0 } },
    ]);
    const editor = await selecting("a:1;\nb:1;\na+b");
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const { replaced, results, status } = shown();
    await runFileOnServer(editor, await opened(link), results, status);
    assert.deepStrictEqual(sent, ["a:1;\nb:1;\na+b"]);
    assert.deepStrictEqual(replaced, ["2"]);
  });

  test("including edits not yet saved", async () => {
    const { link, sent } = scripted([
      { message: long(1), timing: { roundtrip: 0 } },
    ]);
    const editor = await selecting("1");
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "0+"));
    const { results, status } = shown();
    await runFileOnServer(editor, await opened(link), results, status);
    assert.deepStrictEqual(sent, ["0+1"]);
  });

  test("a blank file sends nothing", async () => {
    const { link, sent } = scripted([]);
    const { replaced, results, status } = shown();
    await runFileOnServer(
      await selecting("\n  \n"),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(sent, []);
    assert.deepStrictEqual(replaced, []);
  });
});
