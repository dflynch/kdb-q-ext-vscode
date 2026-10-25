import type { Size } from "./format/console";

// What the extension and the Result view's webview say to each other

// To the webview: the latest response, as it arrived, for the webview to
// decode, unwrap if it's protected evaluation's reply, and show at the
// console size; or an error of the extension's own, as q's console shows
// errors
export type ToView =
  | { type: "result"; message: Uint8Array; wrapped: boolean; size: Size }
  | { type: "error"; text: string };

// As posted, numbered, so that the webview's answer can be matched to it
export type Posted = ToView & { id: number };

// To the extension: the webview has loaded, and is listening; or it has
// shown what was posted, and how long the server took, where protected
// evaluation said
export type FromView =
  | { type: "ready" }
  | { type: "shown"; id: number; execution?: number };
