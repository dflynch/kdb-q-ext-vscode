import { mkdirSync, rmSync } from "node:fs";
import { defineConfig } from "@vscode/test-cli";

// A folder for the workspace tests to write Workspace settings in, made
// afresh for each run, outside the repo's own .vscode
const workspace = ".vscode-test/workspace";
rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

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
