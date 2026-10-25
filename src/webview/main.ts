// The Result view's script, bundled into dist/webview.js. It runs in the
// webview, with the DOM but no Node and no VS Code API, and talks to the
// extension only by messages
import type { FromView, ToView } from "../messages";
import { consoleText } from "./console";

declare function acquireVsCodeApi(): {
  postMessage(message: FromView): void;
};

const vscode = acquireVsCodeApi();

const empty = document.createElement("p");
empty.className = "empty";
empty.textContent = "No result yet";
const text = document.createElement("pre");
text.className = "console";
document.body.append(empty);

// Each result replaces the last
window.addEventListener("message", (event: MessageEvent<ToView>) => {
  text.textContent = consoleText(event.data);
  empty.replaceWith(text);
});

vscode.postMessage({ type: "ready" });
