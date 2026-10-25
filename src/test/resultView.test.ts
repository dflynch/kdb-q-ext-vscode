import * as assert from "node:assert";
import * as vscode from "vscode";
import { defaultSize } from "../format/console";
import type { FromView, Posted, ToView } from "../messages";
import { page, ResultView, viewId } from "../resultView";

const extension = vscode.Uri.file("/extension");

// A stand-in view, resolved by the given ResultView, keeping what it's
// given and posted, and saying ready or closing when asked
function resolved(results = new ResultView(extension)) {
  const posted: Posted[] = [];
  let say: (message: FromView) => void = () => {};
  let close = () => {};
  const webview = {
    cspSource: "https://source.example",
    options: {} as vscode.WebviewOptions,
    html: "",
    asWebviewUri: (uri: vscode.Uri) =>
      uri.with({ scheme: "https", authority: "source.example" }),
    onDidReceiveMessage: (listener: (message: FromView) => void) => {
      say = listener;
    },
    postMessage: async (message: Posted) => posted.push(message),
  };
  results.resolveWebviewView({
    webview,
    onDidDispose: (listener: () => void) => {
      close = listener;
    },
  } as unknown as vscode.WebviewView);
  return {
    ...webview,
    get options() {
      return webview.options;
    },
    get html() {
      return webview.html;
    },
    posted,
    ready: () => say({ type: "ready" }),
    say: (message: FromView) => say(message),
    close: () => close(),
  };
}

const one: ToView = { type: "error", text: "'one" };
const two: ToView = {
  type: "result",
  message: Uint8Array.of(1, 0, 0, 0, 10, 0, 0, 0, 101, 0),
  wrapped: true,
  size: defaultSize,
};

const policy = (html: string) =>
  html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];

suite("the Result view", () => {
  test("its page loads nothing but our script, by its nonce, and our styles", () => {
    const html = page(
      "https://source.example",
      "abc123",
      vscode.Uri.parse("https://source.example/dist/webview.js"),
      vscode.Uri.parse("https://source.example/dist/webview.css"),
    );
    assert.deepStrictEqual(policy(html)?.split("; "), [
      "default-src 'none'",
      "script-src 'nonce-abc123'",
      "style-src https://source.example",
      "font-src https://source.example",
    ]);
    assert.match(
      html,
      /<script nonce="abc123" src="https:\/\/source.example\/dist\/webview.js">/,
    );
    assert.match(
      html,
      /<link rel="stylesheet" href="https:\/\/source.example\/dist\/webview.css">/,
    );
  });

  test("runs scripts, and reads files only from dist", () => {
    const { options } = resolved();
    assert.strictEqual(options.enableScripts, true);
    assert.deepStrictEqual(
      options.localResourceRoots?.map((uri) => uri.path),
      ["/extension/dist"],
    );
    assert.ok(!options.enableCommandUris);
    assert.ok(!options.enableForms);
  });

  test("a new nonce each time it's shown", () => {
    const nonce = (html: string) => html.match(/'nonce-([^']+)'/)?.[1];
    const first = nonce(resolved().html);
    const second = nonce(resolved().html);
    assert.ok(first && second && first !== second);
  });

  test("posts nothing until the webview is ready, then the latest", () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    results.show(one);
    results.show(two);
    assert.deepStrictEqual(view.posted, []);
    view.ready();
    assert.deepStrictEqual(view.posted, [{ ...two, id: 2 }]);
    results.show(one);
    assert.deepStrictEqual(view.posted, [
      { ...two, id: 2 },
      { ...one, id: 3 },
    ]);
  });

  test("closed and opened again, shows the latest once ready", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    first.ready();
    results.show(one);
    first.close();
    results.show(two);
    const second = resolved(results);
    assert.deepStrictEqual(second.posted, []);
    second.ready();
    assert.deepStrictEqual(first.posted, [{ ...one, id: 1 }]);
    assert.deepStrictEqual(second.posted, [{ ...two, id: 2 }]);
  });

  test("gives back the server's time once the webview has shown it", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    view.ready();
    const shown = results.show(two);
    view.say({ type: "shown", id: 1, execution: 7 });
    assert.strictEqual(await shown, 7);
  });

  test("an answer about an earlier one is ignored, and that one gets nothing", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    view.ready();
    const first = results.show(two);
    const second = results.show(two);
    assert.strictEqual(await first, undefined);
    view.say({ type: "shown", id: 1, execution: 7 });
    view.say({ type: "shown", id: 2, execution: 9 });
    assert.strictEqual(await second, 9);
  });

  test("is contributed, and opens", async () => {
    await vscode.commands.executeCommand(`${viewId}.focus`);
    await vscode.commands.executeCommand("workbench.action.closePanel");
  });
});
