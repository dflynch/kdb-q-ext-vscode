import type { Size } from "./format/console";

// What the extension and the Result view's webview say to each other

// To the webview: the latest response, as it arrived, for the webview to
// decode, unwrap if it's protected evaluation's reply, and show at the
// console size; or an error of the extension's own, as q's console shows
// errors
export type ToView =
  | { type: "result"; message: Uint8Array; wrapped: boolean; size: Size }
  | { type: "error"; text: string };

// The three views of a result
export type View = "console" | "grid" | "chart";

// What a result answers: the query as written, the server it ran on, and
// when it was shown, in milliseconds since the epoch
export type About = { query: string; server: string; at: number };

// A cell drilled into from a grid: its row in the result, as the result
// came, and its column, keys first
export type Step = [row: number, column: number];

// How a level is arranged: its grid's sort, filter and column order, as
// the grid says them, and what its chart draws, as the chart's settings
// say. The extension keeps it for a webview that opens on it, and never
// reads it.
export type Arrangement = {
  grid?: Record<string, unknown>;
  chart?: Record<string, unknown>;
};

// As posted, numbered, so that the webview's answer can be matched to it,
// with the view chosen last, whether the chart's settings are open, the
// cells drilled into, and how each level is arranged, the result's first,
// for a webview that opens on them. A kept result also says what it
// answers.
export type Posted = ToView & {
  id: number;
  about?: About;
  view?: View;
  settings?: boolean;
  path?: Step[];
  arranged?: Arrangement[];
};

// To the webview: asked for the value shown as CSV, numbered, to match the
// answer to the asking
export type Export = { type: "export"; request: number };

// To the webview: asked for the cells selected, with the columns' names, as
// the grid's menu was opened on, for Copy with Headers
export type Copy = { type: "copy" };

// To the extension: the webview has loaded, and is listening; it has shown
// what was posted, and how long the server took, where protected evaluation
// said; the view chosen; the chart's settings opened or closed; the cells
// drilled into and how each level is arranged, the result's first, after a
// drill, a step back, a sort, filter or column changed, or a chart's
// settings changed, together so they never disagree; whether the
// Grid view is shown, and so can be exported, each time it changes; or the
// Grid view as CSV, in UTF-8, and its rows, or the shown columns that are
// mixed lists, which CSV can't hold, or nothing with another view shown;
// the grid's menu opened, the webview's own and ours;
// or the cells selected, copied, as tab-separated text, or the selected
// columns that are mixed lists, which it can't hold, or nothing with no
// cell selected
export type FromView =
  | { type: "ready" }
  | { type: "shown"; id: number; execution?: number }
  | { type: "chose"; view: View }
  | { type: "settings"; open: boolean }
  | { type: "levels"; id: number; path: Step[]; arranged: Arrangement[] }
  | { type: "exportable"; exportable: boolean }
  | {
      type: "exported";
      request: number;
      csv?: Uint8Array;
      rows?: number;
      mixed?: string[];
    }
  | { type: "menu" }
  | { type: "copied"; text?: string; mixed?: string[] };
