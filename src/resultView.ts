import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { copy as clipboard } from "./exporting";
import type {
  About,
  Arrangement,
  Copy,
  Export,
  FromView,
  Posted,
  Step,
  ToView,
  View,
} from "./messages";

// The Result view in the bottom panel: the latest result, shown in a webview
export const viewId = "kdb-q-ext-vscode.result";
// A result kept in an editor tab of its own
export const keptType = "kdb-q-ext-vscode.kept";
// Whether there's a result to keep, for the Keep Result command
export const hasResult = "kdb-q-ext-vscode.hasResult";
// Whether the Grid view is shown, in the Result view and in the kept tab
// that's active, for the Export to CSV commands
export const exportable = "kdb-q-ext-vscode.exportable";
export const keptExportable = "kdb-q-ext-vscode.keptExportable";

// A Grid view, exported as CSV in UTF-8, and its rows; or its shown columns
// that are mixed lists, which CSV can't hold; or nothing with another view
// shown
export type Exported = { csv?: Uint8Array; rows?: number; mixed?: string[] };

// Cells copied from a grid, as tab-separated text; or the selected columns
// that are mixed lists, which it can't hold; or nothing with none selected
export type Copied = { text?: string; mixed?: string[] };

// A kept tab, and whether it shows the Grid view
type Kept = { panel: vscode.WebviewPanel; exportable: boolean };

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
  // The view chosen last, and the cells drilled into in the latest and how
  // each level's grid is arranged, kept here too so a new webview, or a
  // kept tab, opens on them
  private chosen: View = "grid";
  private path: Step[] = [];
  private arranged: Arrangement[] = [];
  // Gives the latest's answer to whoever showed it
  private answer?: (execution: number | undefined) => void;
  // The kept tab that's active, if one is
  private active?: Kept;
  // The exports asked for and not yet answered, by number, and the webview
  // asked
  private exports = new Map<
    number,
    { webview: vscode.Webview; resolve: (exported: Exported) => void }
  >();
  private request = 0;
  // The webview whose grid's menu was opened last, for Copy with Headers
  private menu?: vscode.Webview;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly panels: Panels = vscode.window.createWebviewPanel,
    // Puts cells copied on the clipboard: VS Code's, or a stand-in for tests
    private readonly copy: (copied: Copied) => void = clipboard,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    vscode.commands.executeCommand("setContext", exportable, false);
    view.onDidDispose(() => {
      this.unanswered(view.webview);
      if (this.view === view) {
        this.view = undefined;
        vscode.commands.executeCommand("setContext", exportable, false);
      }
    });
    view.webview.onDidReceiveMessage((message: FromView) => {
      if (this.view !== view) {
        return;
      }
      if (message.type === "ready") {
        // A page loaded anew, which shows no grid until it's posted the
        // latest, and won't answer what was asked of the one before
        this.ready = true;
        vscode.commands.executeCommand("setContext", exportable, false);
        this.unanswered(view.webview);
        this.post();
      } else if (message.type === "chose") {
        this.chosen = message.view;
      } else if (message.type === "levels") {
        // Not about an earlier one, changed before the latest arrived
        if (message.id === this.latest?.id) {
          this.path = message.path;
          this.arranged = message.arranged;
        }
      } else if (message.type === "exportable") {
        vscode.commands.executeCommand(
          "setContext",
          exportable,
          message.exportable,
        );
      } else if (message.type === "exported") {
        this.exported(message);
      } else if (message.type === "menu") {
        this.menu = view.webview;
      } else if (message.type === "copied") {
        this.copied(message);
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
    this.path = [];
    this.arranged = [];
    vscode.commands.executeCommand("setContext", hasResult, true);
    const answered = new Promise<number | undefined>((resolve) => {
      this.answer = resolve;
    });
    this.post();
    return answered;
  }

  // Keep the latest in an editor tab of its own, in the view it's shown in,
  // on the cell drilled into and with its grids arranged as they are, where
  // the next result doesn't replace it.
  // The tab is kept alive when hidden, as the Result view is, and closes
  // with VS Code: nothing is saved.
  keep() {
    if (!this.latest || !this.about) {
      return;
    }
    const kept: Posted = {
      ...this.latest,
      about: this.about,
      view: this.chosen,
      path: this.path,
      arranged: this.arranged,
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
    const tab: Kept = { panel, exportable: false };
    // Active as it opens
    this.activate(tab);
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.activate(tab);
      }
    });
    panel.onDidDispose(() => {
      this.unanswered(panel.webview);
      if (this.active === tab) {
        this.active = undefined;
      }
    });
    // Posted on each ready, should the webview be made anew
    panel.webview.onDidReceiveMessage((message: FromView) => {
      if (message.type === "ready") {
        tab.exportable = false;
        if (this.active === tab) {
          this.activate(tab);
        }
        this.unanswered(panel.webview);
        panel.webview.postMessage(kept);
      } else if (message.type === "exportable") {
        tab.exportable = message.exportable;
        if (this.active === tab) {
          this.activate(tab);
        }
      } else if (message.type === "exported") {
        this.exported(message);
      } else if (message.type === "menu") {
        this.menu = panel.webview;
      } else if (message.type === "copied") {
        this.copied(message);
      }
    });
    load(panel.webview, this.extensionUri);
  }

  // The Result view's grid, exported as CSV: its rows and columns as shown
  exportShown(): Promise<Exported> {
    return this.export(this.view?.webview);
  }

  // The grid of the kept tab that's active, exported as CSV
  exportKept(): Promise<Exported> {
    return this.export(this.active?.panel.webview);
  }

  // Copy with Headers: the cells selected in the grid whose menu was opened
  copyWithHeaders() {
    const ask: Copy = { type: "copy" };
    this.menu?.postMessage(ask);
  }

  private copied({ type, ...copied }: Extract<FromView, { type: "copied" }>) {
    this.copy(copied);
  }

  // Answered with nothing if the webview closes or loads anew first
  private export(webview?: vscode.Webview): Promise<Exported> {
    if (!webview) {
      return Promise.resolve({});
    }
    const request = ++this.request;
    const exported = new Promise<Exported>((resolve) => {
      this.exports.set(request, { webview, resolve });
    });
    const ask: Export = { type: "export", request };
    webview.postMessage(ask);
    return exported;
  }

  private exported({
    type,
    request,
    ...answer
  }: Extract<FromView, { type: "exported" }>) {
    this.exports.get(request)?.resolve(answer);
    this.exports.delete(request);
  }

  // Answers with nothing what was asked of a webview that won't answer,
  // and forgets its menu
  private unanswered(webview: vscode.Webview) {
    if (this.menu === webview) {
      this.menu = undefined;
    }
    for (const [request, asked] of this.exports) {
      if (asked.webview === webview) {
        asked.resolve({});
        this.exports.delete(request);
      }
    }
  }

  private activate(tab: Kept) {
    this.active = tab;
    vscode.commands.executeCommand(
      "setContext",
      keptExportable,
      tab.exportable,
    );
  }

  private post() {
    if (this.view && this.ready && this.latest) {
      this.view.webview.postMessage({
        ...this.latest,
        view: this.chosen,
        path: this.path,
        arranged: this.arranged,
      });
    }
  }
}

// Where a query's result is shown
export type Results = Pick<ResultView, "reveal" | "show">;

// A kept result's tab title: its query on one line, shortened, and the
// server. The tab has no tooltip; the page says the rest.
export function title({ query, server }: Omit<About, "at">): string {
  const line = query.replace(/\s+/g, " ").trim();
  // By characters, so as not to split one in two UTF-16 units
  const characters = [...line];
  const short =
    characters.length > 30 ? `${characters.slice(0, 29).join("")}…` : line;
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
