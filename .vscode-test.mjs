import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const { fetch, dir, deploy } = createRequire(import.meta.url)(
  "./test/evaluate/fetch.js",
);

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

// TorQ for the navigation tests, deployed afresh: the first run fetches it
fetch();

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
  {
    // Navigation on TorQ, scored against q's answers in truth.json
    label: "navigation",
    files: "test/evaluate/navigation.test.js",
    workspaceFolder: deploy,
    env: { EVALUATION_DIR: dir },
    launchArgs: ["--disable-extensions"],
    mocha: { timeout: 0 },
  },
]);
