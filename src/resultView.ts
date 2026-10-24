import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

// The Result view in the bottom panel: the latest result, shown in a webview
export const viewId = "kdb-q-ext-vscode.result";

export class ResultView implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist");
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    webview.html = page(
      webview.cspSource,
      randomBytes(16).toString("base64"),
      webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.js")),
      webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.css")),
    );
  }
}

// Registers the view, kept alive when hidden: a result can take long to
// compute, and its scroll, sort and filter should be there on coming back
export function registerResultView(extensionUri: vscode.Uri) {
  return vscode.window.registerWebviewViewProvider(
    viewId,
    new ResultView(extensionUri),
    { webviewOptions: { retainContextWhenHidden: true } },
  );
}

// The webview's page. It loads nothing but our script, by its nonce, and our
// styles, and connects to nothing: it talks to the extension by messages
export function page(
  source: string,
  nonce: string,
  script: vscode.Uri,
  style: vscode.Uri,
): string {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${source}`,
    `font-src ${source}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
</head>
<body>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
