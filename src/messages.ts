import type { Size } from "./format/console";

// What the extension and the Result view's webview say to each other

// To the webview: the latest response, as it arrived, for the webview to
// decode, unwrap if it's protected evaluation's reply, and show at the
// console size; or an error of the extension's own, as q's console shows
// errors
export type ToView =
  | { type: "result"; message: Uint8Array; wrapped: boolean; size: Size }
  | { type: "error"; text: string };

// The two views of a result
export type View = "console" | "grid";

// What a result answers: the query as written, the server it ran on, and
// when it was shown, in milliseconds since the epoch
export type About = { query: string; server: string; at: number };

// A cell drilled into from a grid: its row in the result, as the result
// came, and its column, keys first
export type Step = [row: number, column: number];

// As posted, numbered, so that the webview's answer can be matched to it,
// with the view chosen last and the cells drilled into, for a webview that
// opens on them. A kept result also says what it answers.
export type Posted = ToView & {
  id: number;
  about?: About;
  view?: View;
  path?: Step[];
};

// To the webview: asked for the value shown as CSV, numbered, to match the
// answer to the asking
export type Export = { type: "export"; request: number };

// To the extension: the webview has loaded, and is listening; it has shown
// what was posted, and how long the server took, where protected evaluation
// said; the view chosen; the cells drilled into, after a drill or a step
// back; whether the Grid view is shown, and so can be exported, each time
// it changes; or the Grid view as CSV, in UTF-8, and its rows, or the
// shown columns that are mixed lists, which CSV can't hold, or nothing with
// another view shown
export type FromView =
  | { type: "ready" }
  | { type: "shown"; id: number; execution?: number }
  | { type: "chose"; view: View }
  | { type: "drilled"; id: number; path: Step[] }
  | { type: "exportable"; exportable: boolean }
  | {
      type: "exported";
      request: number;
      csv?: Uint8Array;
      rows?: number;
      mixed?: string[];
    };
