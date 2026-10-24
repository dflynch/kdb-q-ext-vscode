// The Result view's script, bundled into dist/webview.js. It runs in the
// webview, with the DOM but no Node and no VS Code API, and talks to the
// extension only by messages

const empty = document.createElement("p");
empty.className = "empty";
empty.textContent = "No result yet";
document.body.append(empty);
