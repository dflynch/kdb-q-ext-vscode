// The navigation part of npm run evaluate: the extension in VS Code's test
// host on the TorQ deploy that evaluate.js makes
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const repo = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export default defineConfig({
  label: "evaluate",
  files: fileURLToPath(new URL("./navigation.test.js", import.meta.url)),
  extensionDevelopmentPath: repo(""),
  workspaceFolder: repo(".vscode-test/evaluation/deploy"),
  env: { EVALUATION_DIR: repo(".vscode-test/evaluation") },
  launchArgs: ["--disable-extensions"],
  mocha: { timeout: 0 },
});
