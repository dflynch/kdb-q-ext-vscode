import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

// A folder for the workspace tests to write Workspace settings in, made
// afresh for each run, outside the repo's own .vscode, with q files for the
// workspace index to read as it starts. Beside this file, as the test CLI
// finds it, wherever it's run from.
const workspace = fileURLToPath(
  new URL(".vscode-test/workspace", import.meta.url),
);
rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
cpSync(
  fileURLToPath(new URL("test/fixtures/index", import.meta.url)),
  `${workspace}/index`,
  { recursive: true },
);

export default defineConfig([
  {
    label: "unit",
    files: "out/test/*.test.js",
  },
  {
    // What crosses User and Workspace settings, with a folder open
    label: "workspace",
    files: "out/test/workspace/*.test.js",
    workspaceFolder: workspace,
  },
]);
