// The Result view's script, bundled into dist/webview.js. It runs in the
// webview, with the DOM but no Node and no VS Code API, and talks to the
// extension only by messages
import type { FromView, Posted } from "../messages";
import { consoleView } from "./console";

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

// Each result replaces the last, and the extension is told how long the
// server took, for the status bar
window.addEventListener("message", ({ data }: MessageEvent<Posted>) => {
  const { text: shown, execution } = consoleView(data);
  text.textContent = shown;
  empty.replaceWith(text);
  vscode.postMessage(
    execution === undefined
      ? { type: "shown", id: data.id }
      : { type: "shown", id: data.id, execution },
  );
});

vscode.postMessage({ type: "ready" });
