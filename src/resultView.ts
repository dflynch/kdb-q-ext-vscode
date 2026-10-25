import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { FromView, Posted, ToView } from "./messages";

// The Result view in the bottom panel: the latest result, shown in a webview
export const viewId = "kdb-q-ext-vscode.result";

// It shows the latest result only. The webview is kept alive when hidden,
// but VS Code makes it anew if the view is closed and opened, so the latest
// is kept here too, and posted once the webview says it's ready: anything
// posted before then is lost.
export class ResultView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private latest?: Posted;
  // Gives the latest's answer to whoever showed it
  private answer?: (execution: number | undefined) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    view.webview.onDidReceiveMessage((message: FromView) => {
      if (this.view !== view) {
        return;
      }
      if (message.type === "ready") {
        this.ready = true;
        this.post();
      } else if (message.id === this.latest?.id) {
        this.answer?.(message.execution);
        this.answer = undefined;
      }
    });
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

  // Bring the view into sight, leaving the focus where it is
  async reveal() {
    await vscode.commands.executeCommand(`${viewId}.focus`, {
      preserveFocus: true,
    });
  }

  // Show a result or an error in place of the last. It resolves with how
  // long the server took, where protected evaluation said, once the webview
  // has shown it, or with nothing if another is shown first. A webview that
  // never answers, as one that has crashed, leaves it waiting.
  show(message: ToView): Promise<number | undefined> {
    this.answer?.(undefined);
    this.latest = { ...message, id: (this.latest?.id ?? 0) + 1 };
    const answered = new Promise<number | undefined>((resolve) => {
      this.answer = resolve;
    });
    this.post();
    return answered;
  }

  private post() {
    if (this.view && this.ready && this.latest) {
      this.view.webview.postMessage(this.latest);
    }
  }
}

// Where a query's result is shown
export type Results = Pick<ResultView, "reveal" | "show">;

// Registers the view, kept alive when hidden: a result can take long to
// compute, and should be there as it was left on coming back
export function registerResultView(view: ResultView) {
  return vscode.window.registerWebviewViewProvider(viewId, view, {
    webviewOptions: { retainContextWhenHidden: true },
  });
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
