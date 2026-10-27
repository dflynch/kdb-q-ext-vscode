import * as assert from "node:assert";
import * as vscode from "vscode";
import { defaultSize } from "../format/console";
import type { Copy, Export, FromView, Posted, ToView } from "../messages";
import {
  type Copied,
  keptType,
  type Panels,
  page,
  ResultView,
  title,
  viewId,
} from "../resultView";

const extension = vscode.Uri.file("/extension");

// A stand-in webview, keeping what it's given and posted, exports and
// copies asked for apart, and saying what it's asked to
function standIn() {
  const posted: Posted[] = [];
  const exports: Export[] = [];
  const copies: Copy[] = [];
  let say: (message: FromView) => void = () => {};
  const webview = {
    cspSource: "https://source.example",
    options: {} as vscode.WebviewOptions,
    html: "",
    asWebviewUri: (uri: vscode.Uri) =>
      uri.with({ scheme: "https", authority: "source.example" }),
    onDidReceiveMessage: (listener: (message: FromView) => void) => {
      say = listener;
    },
    postMessage: async (message: Posted | Export | Copy) =>
      message.type === "export"
        ? exports.push(message)
        : message.type === "copy"
          ? copies.push(message)
          : posted.push(message),
  };
  return {
    webview,
    ...webview,
    get options() {
      return webview.options;
    },
    get html() {
      return webview.html;
    },
    posted,
    exports,
    copies,
    ready: () => say({ type: "ready" }),
    say: (message: FromView) => say(message),
  };
}

// A stand-in view, resolved by the given ResultView, that can also be closed
function resolved(results = new ResultView(extension)) {
  const view = standIn();
  let close = () => {};
  results.resolveWebviewView({
    webview: view.webview,
    onDidDispose: (listener: () => void) => {
      close = listener;
    },
  } as unknown as vscode.WebviewView);
  return Object.assign(view, { close: () => close() });
}

// Stand-in editor tabs, keeping how each was made, each active as it's made
// and can be made active again
function tabs() {
  const made: {
    title: string;
    options: unknown;
    view: ReturnType<typeof standIn>;
    activate: () => void;
    close: () => void;
  }[] = [];
  const panels = ((_type, title, _column, options) => {
    const view = standIn();
    let changed = () => {};
    let closed = () => {};
    made.push({
      title,
      options,
      view,
      activate: () => changed(),
      close: () => closed(),
    });
    return {
      webview: view.webview,
      active: true,
      onDidChangeViewState: (listener: () => void) => {
        changed = listener;
      },
      onDidDispose: (listener: () => void) => {
        closed = listener;
      },
    } as unknown as vscode.WebviewPanel;
  }) as Panels;
  return { made, panels };
}

const asked = { query: "select from trade", server: "prod" };

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
      "style-src https://source.example 'nonce-abc123'",
      "font-src https://source.example",
      "img-src data:",
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
    results.show(one, asked);
    results.show(two, asked);
    assert.deepStrictEqual(view.posted, []);
    view.ready();
    assert.deepStrictEqual(view.posted, [
      { ...two, id: 2, view: "grid", settings: true, path: [], arranged: [] },
    ]);
    results.show(one, asked);
    assert.deepStrictEqual(view.posted, [
      { ...two, id: 2, view: "grid", settings: true, path: [], arranged: [] },
      { ...one, id: 3, view: "grid", settings: true, path: [], arranged: [] },
    ]);
  });

  test("closed and opened again, shows the latest once ready", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    first.ready();
    results.show(one, asked);
    first.close();
    results.show(two, asked);
    const second = resolved(results);
    assert.deepStrictEqual(second.posted, []);
    second.ready();
    assert.deepStrictEqual(first.posted, [
      { ...one, id: 1, view: "grid", settings: true, path: [], arranged: [] },
    ]);
    assert.deepStrictEqual(second.posted, [
      { ...two, id: 2, view: "grid", settings: true, path: [], arranged: [] },
    ]);
  });

  test("a webview it has replaced is not listened to", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    const second = resolved(results);
    results.show(one, asked);
    first.ready();
    assert.deepStrictEqual(second.posted, []);
    assert.deepStrictEqual(first.posted, []);
  });

  test("gives back the server's time once the webview has shown it", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    view.ready();
    const shown = results.show(two, asked);
    view.say({ type: "shown", id: 1, execution: 7 });
    assert.strictEqual(await shown, 7);
  });

  test("an answer about an earlier one is ignored, and that one gets nothing", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    view.ready();
    const first = results.show(two, asked);
    const second = results.show(two, asked);
    assert.strictEqual(await first, undefined);
    view.say({ type: "shown", id: 1, execution: 7 });
    view.say({ type: "shown", id: 2, execution: 9 });
    assert.strictEqual(await second, 9);
  });

  test("a view chosen is the one a new webview opens on", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    first.say({ type: "chose", view: "console" });
    results.show(one, asked);
    const second = resolved(results);
    second.ready();
    assert.deepStrictEqual(second.posted, [
      {
        ...one,
        id: 1,
        view: "console",
        settings: true,
        path: [],
        arranged: [],
      },
    ]);
  });

  test("a new webview opens on the cells drilled into, and its grids as arranged, until the next result", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    first.ready();
    results.show(two, asked);
    first.say({
      type: "levels",
      id: 1,
      path: [
        [3, 1],
        [0, 2],
      ],
      arranged: [
        { grid: { sort: { sortModel: [{ colId: "0", sort: "desc" }] } } },
        {},
        {},
      ],
    });
    const second = resolved(results);
    second.ready();
    assert.deepStrictEqual(second.posted, [
      {
        ...two,
        id: 1,
        view: "grid",
        settings: true,
        path: [
          [3, 1],
          [0, 2],
        ],
        arranged: [
          { grid: { sort: { sortModel: [{ colId: "0", sort: "desc" }] } } },
          {},
          {},
        ],
      },
    ]);
    results.show(one, asked);
    assert.deepStrictEqual(second.posted[1], {
      ...one,
      id: 2,
      view: "grid",
      settings: true,
      path: [],
      arranged: [],
    });
  });

  test("cells drilled into in an earlier result are ignored", () => {
    const results = new ResultView(extension);
    const first = resolved(results);
    first.ready();
    results.show(two, asked);
    results.show(one, asked);
    // Drilled into the first before the second arrived
    first.say({ type: "levels", id: 1, path: [[3, 1]], arranged: [{}, {}] });
    const second = resolved(results);
    second.ready();
    assert.deepStrictEqual(second.posted[0].path, []);
    assert.deepStrictEqual(second.posted[0].arranged, []);
  });

  test("keeps the cell drilled into, and its grids and charts as arranged", () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels);
    const view = resolved(results);
    results.show(two, asked);
    const filtered = {
      grid: { filter: { filterModel: { "0": { type: "contains" } } } },
      chart: { type: "bar", x: null, y: ["price"], hidden: [], steps: false },
    };
    view.say({
      type: "levels",
      id: 1,
      path: [[3, 1]],
      arranged: [filtered, {}],
    });
    results.keep();
    made[0].view.ready();
    assert.deepStrictEqual(made[0].view.posted[0].path, [[3, 1]]);
    assert.deepStrictEqual(made[0].view.posted[0].arranged, [filtered, {}]);
  });

  test("the Chart chosen, and its settings closed, are what a new webview and a kept tab open on", () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels);
    const first = resolved(results);
    first.say({ type: "chose", view: "chart" });
    first.say({ type: "settings", open: false });
    results.show(one, asked);
    const second = resolved(results);
    second.ready();
    assert.strictEqual(second.posted[0].view, "chart");
    assert.strictEqual(second.posted[0].settings, false);
    results.keep();
    made[0].view.ready();
    assert.strictEqual(made[0].view.posted[0].view, "chart");
    assert.strictEqual(made[0].view.posted[0].settings, false);
  });

  test("keeps the latest in an editor tab, with what it answers, in the view chosen", () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels);
    const view = resolved(results);
    view.say({ type: "chose", view: "console" });
    const before = Date.now();
    results.show(two, asked);
    results.keep();
    assert.strictEqual(made.length, 1);
    const [{ title: named, options, view: kept }] = made;
    assert.strictEqual(named, "select from trade · prod");
    assert.deepStrictEqual(options, { retainContextWhenHidden: true });
    assert.strictEqual(kept.options.enableScripts, true);
    assert.strictEqual(kept.posted.length, 0);
    kept.ready();
    const [posted] = kept.posted;
    const at = posted.about?.at ?? 0;
    assert.ok(at >= before && at <= Date.now());
    assert.deepStrictEqual(posted, {
      ...two,
      id: 1,
      view: "console",
      settings: true,
      path: [],
      arranged: [],
      about: { ...asked, at },
    });
  });

  test("a kept result stays as it was when the next is shown", () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels);
    results.show(two, asked);
    results.keep();
    results.show(one, { query: "1+", server: "dev" });
    const [{ view: kept }] = made;
    kept.ready();
    // Should its webview be made anew
    kept.ready();
    assert.strictEqual(kept.posted.length, 2);
    for (const posted of kept.posted) {
      assert.strictEqual(posted.id, 1);
      assert.strictEqual(posted.about?.query, "select from trade");
    }
  });

  test("keeps nothing before the first result", () => {
    const { made, panels } = tabs();
    new ResultView(extension, panels).keep();
    assert.deepStrictEqual(made, []);
  });

  test("a kept tab's title is its query on one line, shortened, and the server", () => {
    assert.strictEqual(title({ query: " 1+1\n", server: "dev" }), "1+1 · dev");
    assert.strictEqual(
      title({
        query: "select last price\n  by sym\tfrom trade",
        server: "prod",
      }),
      "select last price by sym from… · prod",
    );
    assert.strictEqual(
      title({ query: "x".repeat(30), server: "dev" }),
      `${"x".repeat(30)} · dev`,
    );
    assert.strictEqual(
      title({ query: `${"x".repeat(28)}🙂🙂`, server: "dev" }),
      `${"x".repeat(28)}🙂🙂 · dev`,
    );
    assert.strictEqual(
      title({ query: `${"x".repeat(28)}🙂🙂🙂`, server: "dev" }),
      `${"x".repeat(28)}🙂… · dev`,
    );
  });

  test("its bundled script loads, decodes a result, and answers", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension(
      "dflynch3.kdb-q-ext-vscode",
    );
    assert.ok(extension);
    // A webview in an editor tab stands in for the panel's: the page, its
    // policy and the script are the same
    const panel = vscode.window.createWebviewPanel(
      "kdb-q-ext-vscode.test",
      "Result",
      vscode.ViewColumn.One,
    );
    try {
      // ``result`elapsed!(::;42;7), protected evaluation's reply
      const message = Buffer.from(
        "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f90700000000000000",
        "hex",
      );
      const results = new ResultView(extension.extensionUri);
      results.resolveWebviewView(panel as unknown as vscode.WebviewView);
      const execution = await results.show(
        {
          type: "result",
          message: new Uint8Array(message),
          wrapped: true,
          size: defaultSize,
        },
        asked,
      );
      assert.strictEqual(execution, 7);
    } finally {
      panel.dispose();
    }
  });

  test("a kept result opens in an editor tab, where its webview shows it", async function () {
    this.timeout(10000);
    const extension = vscode.extensions.getExtension(
      "dflynch3.kdb-q-ext-vscode",
    );
    assert.ok(extension);
    // The real tab, kept hold of to hear its webview, which answers
    // whoever listens though the extension doesn't
    let panel: vscode.WebviewPanel | undefined;
    const results = new ResultView(extension.extensionUri, (...made) => {
      panel = vscode.window.createWebviewPanel(...made);
      return panel;
    });
    try {
      // ``result`elapsed!(::;42;7), protected evaluation's reply
      const message = Buffer.from(
        "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f90700000000000000",
        "hex",
      );
      results.show(
        {
          type: "result",
          message: new Uint8Array(message),
          wrapped: true,
          size: defaultSize,
        },
        asked,
      );
      results.keep();
      assert.ok(panel);
      const kept = panel;
      const answer = await new Promise<FromView>((resolve) => {
        kept.webview.onDidReceiveMessage((message: FromView) => {
          if (message.type === "shown") {
            resolve(message);
          }
        });
      });
      assert.deepStrictEqual(answer, { type: "shown", id: 1, execution: 7 });
      const tab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.label === "select from trade · prod");
      assert.ok(tab?.input instanceof vscode.TabInputWebview);
      assert.match(tab.input.viewType, /kdb-q-ext-vscode\.kept$/);
    } finally {
      panel?.dispose();
    }
  });

  test("asks the Result view for the value shown as CSV, and gives back its answer", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    const exported = results.exportShown();
    assert.deepStrictEqual(view.exports, [{ type: "export", request: 1 }]);
    const csv = new TextEncoder().encode("value\n1\n");
    view.say({ type: "exported", request: 1, csv, rows: 1 });
    assert.deepStrictEqual(await exported, { csv, rows: 1 });
  });

  test("an answer of mixed columns is given back as it came", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    const exported = results.exportShown();
    view.say({ type: "exported", request: 1, mixed: ["t", "v"] });
    assert.deepStrictEqual(await exported, { mixed: ["t", "v"] });
  });

  test("an answer is matched to its asking", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    const first = results.exportShown();
    const second = results.exportShown();
    view.say({ type: "exported", request: 2, rows: 2 });
    view.say({ type: "exported", request: 1 });
    assert.deepStrictEqual(await first, {});
    assert.deepStrictEqual(await second, { rows: 2 });
  });

  test("an export asked of a webview that closes, or loads anew, is answered with nothing", async () => {
    const results = new ResultView(extension);
    const view = resolved(results);
    const closing = results.exportShown();
    view.close();
    assert.deepStrictEqual(await closing, {});
    const again = resolved(results);
    const reloading = results.exportShown();
    again.ready();
    assert.deepStrictEqual(await reloading, {});

    const { made, panels } = tabs();
    const keeping = new ResultView(extension, panels);
    keeping.show(two, asked);
    keeping.keep();
    const kept = keeping.exportKept();
    made[0].close();
    assert.deepStrictEqual(await kept, {});
  });

  test("exports nothing with no Result view", async () => {
    assert.deepStrictEqual(await new ResultView(extension).exportShown(), {});
  });

  test("asks the kept tab that's active for its value as CSV", async () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels);
    assert.deepStrictEqual(await results.exportKept(), {});
    results.show(two, asked);
    results.keep();
    results.keep();
    made[0].activate();
    const exported = results.exportKept();
    assert.deepStrictEqual(made[1].view.exports, []);
    assert.deepStrictEqual(made[0].view.exports, [
      { type: "export", request: 1 },
    ]);
    made[0].view.say({ type: "exported", request: 1, rows: 3 });
    assert.deepStrictEqual(await exported, { rows: 3 });
  });

  test("cells copied are put on the clipboard, or mixed columns refused, as they came", () => {
    const copied: Copied[] = [];
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels, (c) => copied.push(c));
    const view = resolved(results);
    view.say({ type: "copied", text: "a\t1" });
    results.show(two, asked);
    results.keep();
    made[0].view.say({ type: "copied", mixed: ["v"] });
    view.say({ type: "copied" });
    assert.deepStrictEqual(copied, [{ text: "a\t1" }, { mixed: ["v"] }, {}]);
  });

  test("Copy with Headers asks the webview whose grid's menu was opened last", () => {
    const { made, panels } = tabs();
    const results = new ResultView(extension, panels, () => {});
    const view = resolved(results);
    results.copyWithHeaders();
    results.show(two, asked);
    results.keep();
    view.say({ type: "menu" });
    made[0].view.say({ type: "menu" });
    results.copyWithHeaders();
    assert.deepStrictEqual(view.copies, []);
    assert.deepStrictEqual(made[0].view.copies, [{ type: "copy" }]);
    // Not one closed, or loaded anew
    made[0].close();
    results.copyWithHeaders();
    view.say({ type: "menu" });
    view.ready();
    results.copyWithHeaders();
    assert.strictEqual(made[0].view.copies.length, 1);
    assert.deepStrictEqual(view.copies, []);
  });

  test("Copy with Headers is in the menu of a grid, in the Result view and a kept tab", async () => {
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        "kdb-q-ext-vscode.copyWithHeaders",
      ),
    );
    const manifest = vscode.extensions.getExtension(
      "dflynch3.kdb-q-ext-vscode",
    )?.packageJSON;
    assert.deepStrictEqual(manifest.contributes.menus["webview/context"], [
      {
        command: "kdb-q-ext-vscode.copyWithHeaders",
        when: `webviewSection == grid && (webviewId == ${viewId} || webviewId == ${keptType})`,
        group: "9_cutcopypaste",
      },
    ]);
  });

  test("Keep Result is a command, pinned to the Result view", async () => {
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        "kdb-q-ext-vscode.keepResult",
      ),
    );
    const manifest = vscode.extensions.getExtension(
      "dflynch3.kdb-q-ext-vscode",
    )?.packageJSON;
    assert.deepStrictEqual(
      manifest.contributes.menus["view/title"].map(
        ({ command, when }: { command: string; when: string }) => [
          command,
          when,
        ],
      ),
      [
        ["kdb-q-ext-vscode.exportResult", `view == ${viewId}`],
        ["kdb-q-ext-vscode.keepResult", `view == ${viewId}`],
      ],
    );
  });

  test("Export to CSV is a command for the Result view and for a kept tab", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("kdb-q-ext-vscode.exportResult"));
    assert.ok(commands.includes("kdb-q-ext-vscode.exportKept"));
    const manifest = vscode.extensions.getExtension(
      "dflynch3.kdb-q-ext-vscode",
    )?.packageJSON;
    assert.deepStrictEqual(manifest.contributes.menus["editor/title"], [
      {
        command: "kdb-q-ext-vscode.exportKept",
        when: `activeWebviewPanelId == ${keptType}`,
        group: "navigation",
      },
    ]);
  });

  test("is contributed, and opens", async () => {
    await vscode.commands.executeCommand(`${viewId}.focus`);
    await vscode.commands.executeCommand("workbench.action.closePanel");
  });
});
