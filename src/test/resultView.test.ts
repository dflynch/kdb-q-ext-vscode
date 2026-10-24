import * as assert from "node:assert";
import * as vscode from "vscode";
import { page, ResultView, viewId } from "../resultView";

const extension = vscode.Uri.file("/extension");

// A stand-in view keeping what it's given
function resolved() {
  const webview = {
    cspSource: "https://source.example",
    options: {} as vscode.WebviewOptions,
    html: "",
    asWebviewUri: (uri: vscode.Uri) =>
      uri.with({ scheme: "https", authority: "source.example" }),
  };
  new ResultView(extension).resolveWebviewView({
    webview,
  } as unknown as vscode.WebviewView);
  return webview;
}

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

  test("is contributed, and opens", async () => {
    await vscode.commands.executeCommand(`${viewId}.focus`);
    await vscode.commands.executeCommand("workbench.action.closePanel");
  });
});
