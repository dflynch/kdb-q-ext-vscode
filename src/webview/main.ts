// The script of the Result view and of each kept result's tab, bundled into
// dist/webview.js. It runs in the webview, with the DOM but no Node and no
// VS Code API, and talks to the extension only by messages
import type { Size } from "../format/console";
import type { About, FromView, Posted, Step, View } from "../messages";
import { Grid } from "./grid";
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

// Two views of the value shown, Console and Grid, switched between by tabs
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
// The value's size, at the tabs' right
const size = document.createElement("span");
size.className = "size";
tabs.append(size);

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
// drilled from: Result › [3, 1] › [0, 2]
const trail = document.createElement("nav");
trail.className = "trail";
trail.ariaLabel = "Cells drilled into";

// The levels, one over another, all but the one shown hidden
const stack = document.createElement("div");
stack.className = "stack";

document.body.append(empty);

// A value shown: the result, or a cell's value drilled into from a grid.
// Each has its own console text, grid and view, and is kept, hidden, while
// a cell in it is drilled into, so that coming back finds it as it was:
// its sort, filter, scroll and view.
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

  constructor(
    // The cell drilled into, or none for the result
    readonly step: Step | undefined,
    text: string,
    readonly sheet: Sheet | undefined,
    public chosen: View,
  ) {
    this.element.className = "level";
    this.text.className = "console";
    this.text.textContent = text;
    this.place.className = "grid";
    this.element.append(this.text, this.place);
    this.grid = new Grid(
      this.place,
      nonce,
      (rows) => {
        this.filtered = rows;
        switchTo();
      },
      (row, column) => drill([row, column]),
    );
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

function switchTo() {
  const level = shownLevel();
  const { sheet } = level;
  const view = sheet && level.chosen === "grid" ? "grid" : "console";
  consoleTab.ariaSelected = String(view === "console");
  gridTab.ariaSelected = String(view === "grid");
  gridTab.disabled = !sheet;
  gridTab.title = sheet
    ? ""
    : "Only a table, a keyed table or a dictionary shows in the Grid";
  size.textContent = sheet
    ? sized(sheet, view === "grid" ? level.filtered : undefined)
    : "";
  // Inert, as well as hidden, so no key or click reaches one drilled from
  for (const each of levels) {
    each.element.hidden = each !== level;
    each.element.inert = each !== level;
  }
  level.text.hidden = view !== "console";
  level.place.hidden = view !== "grid";
  if (sheet && view === "grid" && !level.drawn) {
    // First, as the grid says how many rows it shows as it's drawn
    level.drawn = true;
    level.grid.show(sheet);
  }
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
// last goes back to it
function showTrail() {
  trail.hidden = levels.length < 2;
  trail.replaceChildren();
  levels.forEach((level, i) => {
    const name = level.step ? `[${level.step.join(", ")}]` : "Result";
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
      button.addEventListener("click", () => back(i));
      trail.append(button);
    }
  });
}

// Show a cell's value of the value shown, as a value of its own. It
// can't fail for a cell the grid shows, so a step that does is a bug.
function drill(step: Step, told = true) {
  const [row, column] = step;
  const sheet = shownLevel().sheet;
  if (!sheet || !consoleSize) {
    throw new Error("drilled into a value with no grid");
  }
  const { text, sheet: table } = presented(
    sheet.columns[column].value(row),
    consoleSize,
  );
  const level = new Level(step, text, table, chosen);
  levels.push(level);
  stack.append(level.element);
  switchTo();
  if (told) {
    tellPath();
  }
  if (level.drawn) {
    level.grid.focus();
  }
}

// Go back to the level at i, as it was left, dropping those after it, with
// the focus on the cell drilled into from it: the trail's next step
function back(i: number) {
  const from = levels[i + 1].step as Step;
  for (const level of levels.splice(i + 1)) {
    level.grid.clear();
    level.element.remove();
  }
  switchTo();
  tellPath();
  if (shownLevel().drawn) {
    shownLevel().grid.focus(from);
  }
}

// The extension keeps the cells drilled into, so that a kept tab, or this
// view made anew, opens on the same value
function tellPath() {
  const path = levels.slice(1).map((level) => level.step as Step);
  vscode.postMessage({ type: "drilled", id: shownId, path });
}

// Alt+Left goes back a step, as a browser's Back, but not while typing, as
// in a filter, where it moves a word left
document.addEventListener("keydown", (event) => {
  const typing =
    event.target instanceof HTMLElement &&
    event.target.matches("input, textarea, [contenteditable]");
  if (
    event.altKey &&
    event.key === "ArrowLeft" &&
    !typing &&
    !event.defaultPrevented &&
    levels.length > 1
  ) {
    event.preventDefault();
    back(levels.length - 2);
  }
});

// Each result replaces the last, drilled-into values and all, and the
// extension is told how long the server took, for the status bar
window.addEventListener("message", ({ data }: MessageEvent<Posted>) => {
  const { text, sheet, ...timing } = present(data);
  // The first result opens on the view chosen last, and the cells drilled
  // into, should this webview be new; later ones keep the view chosen here
  const first = empty.isConnected;
  if (first) {
    chosen = data.view ?? chosen;
    empty.replaceWith(trail, tabs, stack);
    if (data.about) {
      answers(data.about);
      trail.before(about);
    }
  }
  for (const level of levels) {
    level.grid.clear();
    level.element.remove();
  }
  consoleSize = data.type === "result" ? data.size : undefined;
  shownId = data.id;
  levels = [new Level(undefined, text, sheet, chosen)];
  stack.append(levels[0].element);
  switchTo();
  if (first) {
    for (const step of data.path ?? []) {
      drill(step, false);
    }
  }
  vscode.postMessage({ type: "shown", id: data.id, ...timing });
});

vscode.postMessage({ type: "ready" });
