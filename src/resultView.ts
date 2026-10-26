import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { About, FromView, Posted, ToView, View } from "./messages";

// The Result view in the bottom panel: the latest result, shown in a webview
export const viewId = "kdb-q-ext-vscode.result";
// A result kept in an editor tab of its own
export const keptType = "kdb-q-ext-vscode.kept";
// Whether there's a result to keep, for the Keep Result command
export const hasResult = "kdb-q-ext-vscode.hasResult";

// Makes an editor tab with a webview: VS Code's, or a stand-in for tests
export type Panels = typeof vscode.window.createWebviewPanel;

// It shows the latest result only. The webview is kept alive when hidden,
// but VS Code makes it anew if the view is closed and opened, so the latest
// is kept here too, and posted once the webview says it's ready: anything
// posted before then is lost. The latest can be kept in an editor tab,
// where the next doesn't replace it.
export class ResultView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private latest?: Posted;
  private about?: About;
  // The view chosen last, kept here too so a new webview opens on it
  private chosen: View = "grid";
  // Gives the latest's answer to whoever showed it
  private answer?: (execution: number | undefined) => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly panels: Panels = vscode.window.createWebviewPanel,
  ) {}

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
      } else if (message.type === "chose") {
        this.chosen = message.view;
      } else if (message.id === this.latest?.id) {
        this.answer?.(message.execution);
        this.answer = undefined;
      }
    });
    load(view.webview, this.extensionUri);
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
  show(message: ToView, about: Omit<About, "at">): Promise<number | undefined> {
    this.answer?.(undefined);
    this.latest = { ...message, id: (this.latest?.id ?? 0) + 1 };
    this.about = { ...about, at: Date.now() };
    vscode.commands.executeCommand("setContext", hasResult, true);
    const answered = new Promise<number | undefined>((resolve) => {
      this.answer = resolve;
    });
    this.post();
    return answered;
  }

  // Keep the latest in an editor tab of its own, in the view it's shown in,
  // where the next result doesn't replace it. The tab is kept alive when
  // hidden, as the Result view is, and closes with VS Code: nothing is saved.
  keep() {
    if (!this.latest || !this.about) {
      return;
    }
    const kept: Posted = {
      ...this.latest,
      about: this.about,
      view: this.chosen,
    };
    const panel = this.panels(
      keptType,
      title(this.about),
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "icons", "q-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "icons", "q-dark.svg"),
    };
    // Posted on each ready, should the webview be made anew
    panel.webview.onDidReceiveMessage((message: FromView) => {
      if (message.type === "ready") {
        panel.webview.postMessage(kept);
      }
    });
    load(panel.webview, this.extensionUri);
  }

  private post() {
    if (this.view && this.ready && this.latest) {
      this.view.webview.postMessage({ ...this.latest, view: this.chosen });
    }
  }
}

// Where a query's result is shown
export type Results = Pick<ResultView, "reveal" | "show">;

// A kept result's tab title: its query on one line, shortened, and the
// server. The tab has no tooltip; the page says the rest.
export function title({ query, server }: Omit<About, "at">): string {
  const line = query.replace(/\s+/g, " ").trim();
  const short = line.length > 30 ? `${line.slice(0, 29)}…` : line;
  return `${short} · ${server}`;
}

// Loads the page into a webview, which runs our script and reads files only
// from dist
function load(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const dist = vscode.Uri.joinPath(extensionUri, "dist");
  webview.options = { enableScripts: true, localResourceRoots: [dist] };
  webview.html = page(
    webview.cspSource,
    randomBytes(16).toString("base64"),
    webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.js")),
    webview.asWebviewUri(vscode.Uri.joinPath(dist, "webview.css")),
  );
}

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
    `style-src ${source} 'nonce-${nonce}'`,
    `font-src ${source}`,
    // ag-grid's icons
    "img-src data:",
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
