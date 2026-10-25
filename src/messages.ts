import type { Size } from "./format/console";

// What the extension and the Result view's webview say to each other

// To the webview: the latest result, as a q IPC message for it to decode
// and show at the console size, or an error, as q's console shows it
export type ToView =
  | { type: "result"; message: Uint8Array; size: Size }
  | { type: "error"; text: string };

// To the extension: the webview has loaded, and is listening
export type FromView = { type: "ready" };
