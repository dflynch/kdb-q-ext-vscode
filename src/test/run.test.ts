import * as assert from "node:assert";
import * as vscode from "vscode";
import { runFileOnServer, runOnServer } from "../commands";
import type { Connection, Result } from "../connection";
import { Connections } from "../connections";
import type { Results } from "../resultView";
import type { Definition } from "../servers";
import type { Status } from "../status";
import { consoleView } from "../webview/console";

// q's -8! of a long, as a response that took no time
function long(n: number): Result {
  const message = Uint8Array.of(1, 0, 0, 0, 17, 0, 0, 0, 0xf9, ...Array(8));
  new DataView(message.buffer).setBigInt64(9, BigInt(n), true);
  return { message, wrapped: false, roundtrip: 0 };
}

// Protected evaluation's reply ``result`elapsed!(::;42;7), after 3 ms
const protectedLong: Result = {
  message: Buffer.from(
    "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f90700000000000000",
    "hex",
  ),
  wrapped: true,
  roundtrip: 3,
};

// Let the Result view's answer arrive
const answered = () => new Promise((resolve) => setImmediate(resolve));
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
// and answering with the server's time; and a status bar keeping each
// query's start, end and the server's time
function shown() {
  const replaced: string[] = [];
  const told: (string | number | undefined)[][] = [];
  const results: Results = {
    reveal: async () => {},
    show: async (message) => {
      const { text, execution } = consoleView(message);
      replaced.push(text);
      return execution;
    },
  };
  const status: Status = {
    running: (name) => {
      told.push(["running", name]);
      return (roundtrip) => {
        told.push(["ended", name, roundtrip]);
        return (execution) => told.push(["executed", name, execution]);
      };
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
    const { link, sent } = scripted([protectedLong]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("f:{\n  x+1} / add one\nf 1"),
      await opened(link),
      results,
      status,
    );
    assert.deepStrictEqual(sent, ["f:{\n  x+1} / add one\nf 1"]);
    await answered();
    assert.deepStrictEqual(replaced, ["42"]);
    assert.deepStrictEqual(told, [
      ["running", "prod"],
      ["ended", "prod", 3],
      ["executed", "prod", 7],
    ]);
  });

  test("with nothing selected, the current line", async () => {
    const { link, sent } = scripted([long(1)]);
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
    const { link } = scripted([long(1), long(2)]);
    const connections = await opened(link);
    const { replaced, results, status } = shown();
    await runOnServer(await selecting("1"), connections, results, status);
    await close();
    await runOnServer(await selecting("2"), connections, results, status);
    assert.deepStrictEqual(replaced, ["1", "2"]);
  });

  test("an error signalled, with its roundtrip", async () => {
    const { link } = scripted([
      {
        message: Buffer.from("010000000e000000807479706500", "hex"),
        wrapped: false,
        roundtrip: 1,
      },
    ]);
    const { replaced, told, results, status } = shown();
    await runOnServer(
      await selecting("1+`a"),
      await opened(link),
      results,
      status,
    );
    await answered();
    assert.deepStrictEqual(replaced, ["'type"]);
    assert.deepStrictEqual(told.at(-1), ["ended", "prod", 1]);
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
    const { link } = scripted([long(1)]);
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
    assert.deepStrictEqual(told.at(-1), ["ended", "prod", 0]);
  });

  test("waits for the active connection while it opens", async () => {
    const { link, sent } = scripted([long(1)]);
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
    const { link, sent } = scripted([long(2)]);
    const editor = await selecting("a:1;\nb:1;\na+b");
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const { replaced, results, status } = shown();
    await runFileOnServer(editor, await opened(link), results, status);
    assert.deepStrictEqual(sent, ["a:1;\nb:1;\na+b"]);
    assert.deepStrictEqual(replaced, ["2"]);
  });

  test("including edits not yet saved", async () => {
    const { link, sent } = scripted([long(1)]);
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
