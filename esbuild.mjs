// Bundles the extension for VS Code's Node host and the Result view's
// script for its webview, which can't load from node_modules. tsc checks the
// types and builds the tests; this only bundles.
//   node esbuild.mjs               a development build, with source maps
//   node esbuild.mjs --production  minified, without source maps
//   node esbuild.mjs --watch       rebuilds on change, for F5
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Prints errors in the shape .vscode/tasks.json's problem matcher reads and,
// when watching, marks each build's start and end so F5 waits for the first
const problems = {
  name: "problems",
  setup(build) {
    build.onStart(() => {
      if (watch) console.log("[watch] build started");
    });
    build.onEnd(({ errors }) => {
      for (const { text, location } of errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line}:${location.column}:`,
          );
        }
      }
      if (watch) console.log("[watch] build finished");
    });
  },
};

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  target: "es2024",
  logLevel: "silent",
  plugins: [problems],
};

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  }),
  esbuild.context({
    ...shared,
    // dist/webview.js and dist/webview.css
    entryPoints: [
      { in: "src/webview/main.ts", out: "webview" },
      { in: "src/webview/main.css", out: "webview" },
    ],
    outdir: "dist",
    platform: "browser",
    format: "iife",
  }),
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  try {
    await Promise.all(contexts.map((context) => context.rebuild()));
  } catch {
    // The plugin has printed the errors
    process.exitCode = 1;
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
}
