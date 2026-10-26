// The Result view's script, bundled into dist/webview.js. It runs in the
// webview, with the DOM but no Node and no VS Code API, and talks to the
// extension only by messages
import type { About, FromView, Posted, View } from "../messages";
import { Grid } from "./grid";
import { present } from "./present";
import type { Sheet } from "./table";

declare function acquireVsCodeApi(): {
  postMessage(message: FromView): void;
};

const vscode = acquireVsCodeApi();

const empty = document.createElement("p");
empty.className = "empty";
// Until the first result, how to get one: Run Selected Text on Server's key
const key = navigator.userAgent.includes("Mac") ? "Cmd+Enter" : "Ctrl+Enter";
empty.textContent = `Run a query with ${key} to see its result here`;

// Two views of the latest result, Console and Grid, switched between by tabs
const tabs = document.createElement("div");
tabs.className = "tabs";
tabs.role = "tablist";
const tab = (view: View, name: string) => {
  const button = document.createElement("button");
  button.role = "tab";
  button.textContent = name;
  button.addEventListener("click", () => {
    chosen = view;
    switchTo();
    vscode.postMessage({ type: "chose", view });
  });
  tabs.append(button);
  return button;
};
const consoleTab = tab("console", "Console");
const gridTab = tab("grid", "Grid");
// The result's size, at the tabs' right
const size = document.createElement("span");
size.className = "size";
tabs.append(size);

const text = document.createElement("pre");
text.className = "console";
const place = document.createElement("div");
place.className = "grid";
const grid = new Grid(place, document.currentScript?.nonce ?? "", (rows) => {
  filtered = rows;
  switchTo();
});

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

document.body.append(empty);

// The view chosen last, kept for the next result: at first, the one the
// extension says, or the Grid. A result the grid can't show, or an error, is
// shown in the Console.
let chosen: View = "grid";
let sheet: Sheet | undefined;
// Whether the grid shows the latest result: it's drawn only once it's in
// sight, as a hidden grid can't fit its columns to their contents
let drawn = false;
// How many rows the grid shows, once it's drawn: fewer when filtered
let filtered: number | undefined;

function switchTo() {
  const view = sheet && chosen === "grid" ? "grid" : "console";
  consoleTab.ariaSelected = String(view === "console");
  gridTab.ariaSelected = String(view === "grid");
  gridTab.disabled = !sheet;
  gridTab.title = sheet
    ? ""
    : "Only a table, a keyed table or a dictionary shows in the Grid";
  size.textContent = sheet
    ? sized(sheet, view === "grid" ? filtered : undefined)
    : "";
  text.hidden = view !== "console";
  place.hidden = view !== "grid";
  if (sheet && view === "grid" && !drawn) {
    // First, as the grid says how many rows it shows as it's drawn
    drawn = true;
    grid.show(sheet);
  }
}

// As 3 rows, 2 columns, or 1 of 3 rows, 2 columns while filtered
function sized({ rows, columns }: Sheet, shown?: number): string {
  const of = shown === undefined || shown === rows ? "" : `${shown} of `;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${of}${plural(rows, "row")}, ${plural(columns.length, "column")}`;
}

// Each result replaces the last, and the extension is told how long the
// server took, for the status bar
window.addEventListener("message", ({ data }: MessageEvent<Posted>) => {
  const { text: shown, sheet: table, ...timing } = present(data);
  text.textContent = shown;
  sheet = table;
  grid.clear();
  drawn = false;
  filtered = undefined;
  // The first result opens on the view chosen last, should this webview be
  // new; later ones keep the one chosen here
  if (empty.isConnected) {
    chosen = data.view ?? chosen;
    empty.replaceWith(tabs, text, place);
    if (data.about) {
      answers(data.about);
      tabs.before(about);
    }
  }
  switchTo();
  vscode.postMessage({ type: "shown", id: data.id, ...timing });
});

vscode.postMessage({ type: "ready" });
