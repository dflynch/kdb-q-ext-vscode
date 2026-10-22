import * as assert from "node:assert";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";

const grammarPath = path.join(__dirname, "../../syntaxes/q.tmGrammar.json");

let grammar: Promise<textmate.IGrammar> | undefined;

// Shared by every suite: the WASM module can only be loaded once
export function loadGrammar(): Promise<textmate.IGrammar> {
  grammar ??= load();
  return grammar;
}

async function load(): Promise<textmate.IGrammar> {
  const wasm = await readFile(
    require.resolve("vscode-oniguruma/release/onig.wasm"),
  );
  await oniguruma.loadWASM(wasm.buffer as ArrayBuffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async () =>
      textmate.parseRawGrammar(
        await readFile(grammarPath, "utf8"),
        grammarPath,
      ),
  });
  const loaded = await registry.loadGrammar("source.q");
  assert.ok(loaded, "grammar did not load");
  return loaded;
}
