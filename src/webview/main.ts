// The script of the Result view and of each kept result's tab, bundled into
// dist/webview.js. It runs in the webview, with the DOM but no Node and no
// VS Code API, and talks to the extension only by messages
import type { Size } from "../format/console";
import type {
  About,
  Arrangement,
  Copy,
  Export,
  FromView,
  Posted,
  Step,
  View,
} from "../messages";
import { Chart } from "./chart/chart";
import { type Plotted, skipped } from "./chart/data";
import { Panel } from "./chart/panel";
import { fitted, initial, type Spec } from "./chart/spec";
import { csv, tsv } from "./delimited";
import { Grid, onCell } from "./grid";
import { present, presented } from "./present";
import type { Sheet } from "./table";

declare function acquireVsCodeApi(): {
  postMessage(message: FromView): void;
};

const vscode = acquireVsCodeApi();
const nonce = document.currentScript?.nonce ?? "";

const empty = document.createElement("p");
empty.className = "empty";
// Until the first result, how to get one: Run Selected Text on Server's key.
// A kept tab is posted its result as soon as it's ready.
const key = navigator.userAgent.includes("Mac") ? "Cmd+Enter" : "Ctrl+Enter";
empty.textContent = `Run a query with ${key} to see its result here`;

// Three views of the value shown, Console, Grid and Chart, switched between
// by tabs
const tabs = document.createElement("div");
tabs.className = "tabs";
tabs.role = "tablist";
const tab = (view: View, name: string) => {
  const button = document.createElement("button");
  button.role = "tab";
  button.textContent = name;
  button.addEventListener("click", () => {
    chosen = view;
    shownLevel().chosen = view;
    switchTo();
    vscode.postMessage({ type: "chose", view });
  });
  tabs.append(button);
  return button;
};
const consoleTab = tab("console", "Console");
const gridTab = tab("grid", "Grid");
const chartTab = tab("chart", "Chart");
// The value's size, at the tabs' right, and what the chart left out
const size = document.createElement("span");
size.className = "size";
tabs.append(size);
// In the Chart view, a button to open and close the chart's settings, open
// at first, and as they were left for each result after
const settings = document.createElement("button");
settings.className = "toggle codicon codicon-settings-gear";
settings.title = "Chart Settings";
settings.ariaLabel = "Chart Settings";
let settingsOpen = true;
settings.addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  openSettings();
  vscode.postMessage({ type: "settings", open: settingsOpen });
});
tabs.append(settings);

// A kept result says what it answers, above the tabs: the server, when it
// was shown, and the query on one line, the whole of it on hovering
const about = document.createElement("p");
about.className = "about";
const where = document.createElement("span");
const query = document.createElement("code");
about.append(where, query);

function answers({ server, at, query: written }: About) {
  where.textContent = `${server} · ${new Date(at).toLocaleTimeString()}`;
  query.textContent = written.replace(/\s+/g, " ").trim();
  query.title = written;
}

// The cells drilled into, above the tabs, each a step back to where it was
// drilled from: ⌂ › [3, 1] › [0, 2], ⌂ being the result
const trail = document.createElement("nav");
trail.className = "trail";
trail.ariaLabel = "Cells drilled into";

// The levels, one over another, all but the one shown hidden
const stack = document.createElement("div");
stack.className = "stack";

function openSettings() {
  settings.ariaPressed = String(settingsOpen);
  stack.classList.toggle("closed", !settingsOpen);
}

document.body.append(empty);

// A value shown: the result, or a cell's value drilled into from a grid.
// Each has its own console text, grid, chart and view, and is kept, hidden,
// while a cell in it is drilled into, so that coming back finds it as it
// was: its sort, filter, scroll, chart and view.
class Level {
  readonly element = document.createElement("div");
  readonly text = document.createElement("pre");
  readonly place = document.createElement("div");
  readonly grid: Grid;
  // Whether the grid shows the sheet: it's drawn only once it's in sight, as
  // a hidden grid can't fit its columns to their contents
  drawn = false;
  // How many rows the grid shows, once it's drawn: fewer when filtered
  filtered?: number;
  // The chart beside its settings, and what it draws, none for a value
  // with no numbers to draw; drawn, as the grid, once in sight, and what
  // was drawn, for what was left out
  readonly charts = document.createElement("div");
  readonly chart: Chart;
  readonly panel: Panel;
  spec?: Spec;
  plotted?: Plotted;

  constructor(
    // The cell drilled into, or none for the result
    readonly step: Step | undefined,
    text: string,
    readonly sheet: Sheet | undefined,
    public chosen: View,
    // How its grid is arranged: as it was, for a webview opening on it, or
    // as it's changed here
    public arranged: Arrangement,
  ) {
    this.element.className = "level";
    this.text.className = "console";
    this.text.textContent = text;
    this.place.className = "grid";
    // For Copy with Headers in the grid's menu, beside the webview's own
    this.place.dataset.vscodeContext = JSON.stringify({
      webviewSection: "grid",
    });
    this.charts.className = "charts";
    const plot = document.createElement("div");
    plot.className = "plot";
    this.chart = new Chart(plot, (hidden) => {
      if (this.spec) {
        this.charted({ ...this.spec, hidden }, false);
      }
    });
    this.panel = new Panel((spec) => this.charted(spec, true));
    this.charts.append(plot, this.panel.element);
    // As it was, should it have been, else as first drawn
    this.spec =
      sheet &&
      (arranged.chart ? fitted(arranged.chart as Spec, sheet) : initial(sheet));
    this.element.append(this.text, this.place, this.charts);
    this.grid = new Grid(
      this.place,
      nonce,
      (rows) => {
        this.filtered = rows;
        switchTo();
      },
      (row, column) => drill([row, column]),
      (grid) => {
        this.arranged = { ...this.arranged, grid };
        tellLevels();
      },
    );
  }

  // Draw the chart, once in sight
  draw() {
    if (this.sheet && this.spec && !this.plotted) {
      this.plotted = this.chart.draw(this.sheet, this.spec);
      this.panel.show(this.sheet, this.spec);
    }
  }

  // A chart changed, by its settings, drawn anew, or by its legend, as
  // drawn already
  charted(spec: Spec, redraw: boolean) {
    this.spec = spec;
    this.arranged = { ...this.arranged, chart: spec };
    if (redraw && this.sheet) {
      this.plotted = this.chart.draw(this.sheet, spec);
      switchTo();
    }
    tellLevels();
  }

  clear() {
    this.grid.clear();
    this.chart.clear();
    this.element.remove();
  }
}

// The view chosen last, kept for the next result and each value drilled
// into: at first, the one the extension says, or the Grid. A value the grid
// can't show, or an error, is shown in the Console.
let chosen: View = "grid";
// The result first, then each value drilled into from the one before
let levels: Level[] = [];
// The console size the result came with, for the values drilled into, and
// its number, for the extension to match the cells drilled into to it
let consoleSize: Size | undefined;
let shownId = 0;

const shownLevel = () => levels[levels.length - 1];
// Whether the Grid view is shown, and so can be exported, as the extension
// was told last
let exportable = false;

// The view shown: the one chosen, else the Grid, else the Console
function viewOf({ chosen, sheet, spec }: Level): View {
  return chosen === "chart" && spec
    ? "chart"
    : chosen !== "console" && sheet
      ? "grid"
      : "console";
}

function switchTo() {
  const level = shownLevel();
  const { sheet, spec } = level;
  const view = viewOf(level);
  // Inert, as well as hidden, so no key or click reaches one drilled from
  for (const each of levels) {
    each.element.hidden = each !== level;
    each.element.inert = each !== level;
  }
  if (exportable !== (view === "grid")) {
    exportable = view === "grid";
    vscode.postMessage({ type: "exportable", exportable });
  }
  level.text.hidden = view !== "console";
  level.place.hidden = view !== "grid";
  level.charts.hidden = view !== "chart";
  if (sheet && view === "grid" && !level.drawn) {
    // First, as the grid says how many rows it shows as it's drawn
    level.drawn = true;
    level.grid.show(sheet, level.arranged.grid);
  }
  if (view === "chart") {
    // In sight, to fill its place
    level.draw();
  }
  consoleTab.ariaSelected = String(view === "console");
  gridTab.ariaSelected = String(view === "grid");
  chartTab.ariaSelected = String(view === "chart");
  const shows =
    "Only a table, a dictionary or a list, but a string, shows in the";
  gridTab.disabled = !sheet;
  gridTab.title = sheet ? "" : `${shows} Grid`;
  chartTab.disabled = !spec;
  chartTab.title = spec
    ? ""
    : sheet
      ? "Only a value with a numeric column shows in the Chart"
      : `${shows} Chart`;
  const left = view === "chart" && level.plotted ? skipped(level.plotted) : "";
  size.textContent = sheet
    ? [sized(sheet, view === "grid" ? level.filtered : undefined), left]
        .filter(Boolean)
        .join(" · ")
    : "";
  settings.hidden = view !== "chart";
  showTrail();
}

// As 3 rows, 2 columns, or 1 of 3 rows, 2 columns while filtered
function sized({ rows, columns }: Sheet, shown?: number): string {
  const of = shown === undefined || shown === rows ? "" : `${shown} of `;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${of}${plural(rows, "row")}, ${plural(columns.length, "column")}`;
}

// The trail, shown only once a cell is drilled into: every step but the
// last goes back to it. ⌂ is named the result for a screen reader, which
// would otherwise read it as a house.
function showTrail() {
  trail.hidden = levels.length < 2;
  trail.replaceChildren();
  levels.forEach((level, i) => {
    const { step } = level;
    const name = step ? `[${step.join(", ")}]` : "⌂";
    if (i > 0) {
      const between = document.createElement("span");
      between.ariaHidden = "true";
      between.textContent = " › ";
      trail.append(between);
    }
    if (i === levels.length - 1) {
      const here = document.createElement("span");
      here.ariaCurrent = "location";
      here.textContent = name;
      trail.append(here);
    } else {
      const button = document.createElement("button");
      button.textContent = name;
      if (!step) {
        button.ariaLabel = "Result";
        button.classList.add("home");
      }
      button.addEventListener("click", () => back(i));
      trail.append(button);
    }
  });
}

// Show a cell's value of the value shown, as a value of its own, its grid
// arranged as given. It can't fail for a cell the grid shows, so a step
// that does is a bug.
function drill(step: Step, told = true, view = chosen, arranged = {}) {
  const [row, column] = step;
  const sheet = shownLevel().sheet;
  if (!sheet || !consoleSize) {
    throw new Error("type", { cause: "drilled into value with no grid" });
  }
  const { text, sheet: table } = presented(
    sheet.columns[column].value(row),
    consoleSize,
  );
  const level = new Level(step, text, table, view, arranged);
  levels.push(level);
  stack.append(level.element);
  switchTo();
  if (told) {
    tellLevels();
  }
  if (level.drawn) {
    level.grid.focus();
  }
}

// Go back to the level at i, as it was left, dropping those after it, with
// the focus on the cell drilled into from it: the trail's next step. Its
// view, the Grid, drilled from, is the one chosen now, for the next result
// and for Keep Result.
function back(i: number) {
  const from = levels[i + 1].step as Step;
  for (const level of levels.splice(i + 1)) {
    level.clear();
  }
  switchTo();
  tellLevels();
  if (chosen !== shownLevel().chosen) {
    chosen = shownLevel().chosen;
    vscode.postMessage({ type: "chose", view: chosen });
  }
  if (shownLevel().drawn) {
    shownLevel().grid.focus(from);
  }
}

// The extension keeps the cells drilled into, and how each level's grid
// is arranged, so that a kept tab, or this view made anew, opens on the
// same value, arranged the same
function tellLevels() {
  const path = levels.slice(1).map((level) => level.step as Step);
  const arranged = levels.map((level) => level.arranged);
  vscode.postMessage({ type: "levels", id: shownId, path, arranged });
}

// Alt+Left goes back a step, as a browser's Back, but not while typing, as
// in a filter, where it moves a word left. Caught on its way down, before
// the grid, which would take it as Left, from a cell or a header.
document.addEventListener(
  "keydown",
  (event) => {
    const typing =
      event.target instanceof HTMLElement &&
      event.target.matches("input, textarea, [contenteditable]");
    if (
      event.altKey &&
      event.key === "ArrowLeft" &&
      !typing &&
      levels.length > 1
    ) {
      event.preventDefault();
      event.stopPropagation();
      back(levels.length - 2);
    }
  },
  { capture: true },
);

// The Grid view as CSV: its rows and columns as shown, sorted, filtered and
// moved. Nothing from another view, which shows the value otherwise.
function exported(request: number): FromView {
  const level = shownLevel();
  const order = exportable ? level?.grid.shownOrder() : undefined;
  if (!level?.sheet || !order) {
    return { type: "exported", request };
  }
  const written = csv(level.sheet, order.rows, order.columns);
  return "mixed" in written
    ? { type: "exported", request, mixed: written.mixed }
    : {
        type: "exported",
        request,
        csv: new TextEncoder().encode(written.text),
        rows: order.rows.length,
      };
}

// The cells selected in the Grid view shown, or the focused cell, as
// tab-separated text, to copy
function copied(headers: boolean): FromView {
  const level = shownLevel();
  const selected = exportable ? level?.grid.selected() : undefined;
  if (!level?.sheet || !selected) {
    return { type: "copied" };
  }
  const written = tsv(level.sheet, selected.rows, selected.columns, headers);
  return "mixed" in written
    ? { type: "copied", mixed: written.mixed }
    : { type: "copied", text: written.text };
}

// Copy, by its key or the webview's menu, with a grid's cell focused: the
// cells selected, written to the clipboard by the extension. Elsewhere, as
// in the Console, a header or a filter, the page's own.
document.addEventListener("copy", (event) => {
  const focus = document.activeElement;
  const level = shownLevel();
  if (!exportable || !level?.place.contains(focus) || !onCell(focus)) {
    return;
  }
  event.preventDefault();
  vscode.postMessage(copied(false));
});

// The grid's menu, for the extension to ask this webview, of any, for
// Copy with Headers
document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest(".grid")) {
    vscode.postMessage({ type: "menu" });
  }
});

// What the extension posts: a result to show, or asking for it as CSV, or
// for the cells selected
type Received = Posted | Export | Copy;

// Each result replaces the last, drilled-into values and all, and the
// extension is told how long the server took, for the status bar
window.addEventListener("message", ({ data }: MessageEvent<Received>) => {
  if (data.type === "export") {
    vscode.postMessage(exported(data.request));
    return;
  }
  if (data.type === "copy") {
    vscode.postMessage(copied(true));
    return;
  }
  const { text, sheet, ...timing } = present(data);
  // The first result opens on the view chosen last, and the cells drilled
  // into, should this webview be new; later ones keep the view chosen here
  const first = empty.isConnected;
  if (first) {
    chosen = data.view ?? chosen;
    settingsOpen = data.settings ?? settingsOpen;
    openSettings();
    empty.replaceWith(trail, tabs, stack);
    if (data.about) {
      answers(data.about);
      trail.before(about);
    }
  }
  for (const level of levels) {
    level.clear();
  }
  consoleSize = data.type === "result" ? data.size : undefined;
  shownId = data.id;
  // Each value a cell was drilled into from was in the Grid; the last
  // drilled into opens on the view chosen. Each grid is arranged as it was.
  const path = first ? (data.path ?? []) : [];
  const arranged = first ? (data.arranged ?? []) : [];
  levels = [
    new Level(
      undefined,
      text,
      sheet,
      path.length ? "grid" : chosen,
      arranged[0] ?? {},
    ),
  ];
  stack.append(levels[0].element);
  switchTo();
  path.forEach((step, i) => {
    drill(
      step,
      false,
      i < path.length - 1 ? "grid" : chosen,
      arranged[i + 1] ?? {},
    );
  });
  vscode.postMessage({ type: "shown", id: data.id, ...timing });
});

vscode.postMessage({ type: "ready" });
