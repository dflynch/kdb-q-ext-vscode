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

// As posted, numbered, so that the webview's answer can be matched to it,
// with the view chosen last, for a webview that opens on it. A kept result
// also says what it answers.
export type Posted = ToView & { id: number; about?: About; view?: View };

// To the extension: the webview has loaded, and is listening; it has shown
// what was posted, and how long the server took, where protected evaluation
// said; or the view chosen
export type FromView =
  | { type: "ready" }
  | { type: "shown"; id: number; execution?: number }
  | { type: "chose"; view: View };
