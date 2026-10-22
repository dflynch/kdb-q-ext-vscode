import * as assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as textmate from "vscode-textmate";
import { loadGrammar } from "./grammar";

const fixtures = path.join(__dirname, "../../test/fixtures");
const corpusPath = path.join(fixtures, "corpus.q");
const snapshotPath = path.join(fixtures, "corpus.q.snap");

// Each source line, then each of its non-blank tokens as
// column, quoted text and every scope below source.q
function highlight(grammar: textmate.IGrammar, source: string) {
  const out: string[] = [];
  let state = textmate.INITIAL;
  source.split("\n").forEach((line, i) => {
    out.push(`${i + 1}: ${line}`);
    const result = grammar.tokenizeLine(line, state);
    for (const token of result.tokens) {
      const text = line.slice(token.startIndex, token.endIndex);
      if (text.trim()) {
        const scopes = token.scopes.slice(1).join(" ") || "-";
        out.push(`  ${token.startIndex} ${JSON.stringify(text)} ${scopes}`);
      }
    }
    state = result.ruleStack;
  });
  return `${out.join("\n")}\n`;
}

suite("q corpus", () => {
  test("highlighting matches the snapshot", async () => {
    const grammar = await loadGrammar();
    const actual = highlight(grammar, await readFile(corpusPath, "utf8"));
    if (process.env.UPDATE_SNAPSHOT) {
      await writeFile(snapshotPath, actual);
      return;
    }
    const expected = await readFile(snapshotPath, "utf8").catch(() => "");
    assert.strictEqual(
      actual,
      expected,
      "highlighting changed: check the diff, then UPDATE_SNAPSHOT=1 npm test",
    );
  });
});
