import * as assert from "node:assert";
import { syntaxErrors } from "../syntax";

// Line and column from 1, as the editor shows them, whatever the line ending
function at(text: string, offset: number): string {
  const before = text.slice(0, offset).split(/\r\n|\n|\r/);
  return `${before.length}:${before[before.length - 1].length + 1}`;
}

// Each problem as "message line:col", and its related "(message line:col)"
function shown(text: string): string[] {
  return syntaxErrors(text).map((p) => {
    const where = `${p.message} ${at(text, p.start)}`;
    assert.strictEqual(p.end, p.start + 1, "one character");
    return p.related
      ? `${where} (${p.related.message} ${at(text, p.related.start)})`
      : where;
  });
}

const endings: [string, string][] = [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR", "\r"],
];

// [script, what q signals loading it (q 5.0, by hand), what we show]
const cases: [string, string, string[]][] = [
  ["a:(1;2", "'( at the end", [") expected 1:6 (unclosed ( 1:3)"]],
  [
    "f:{[x] (x+1;\n  x*2",
    "'( at the end, the innermost",
    [") expected 2:5 (unclosed ( 1:8)", "} expected 2:5 (unclosed { 1:3)"],
  ],
  ["a:1 2]", "'] at the ]", ["unmatched ] 1:6"]],
  [
    "a:(1;2}",
    "'} at the }",
    ["unmatched } 1:7", ") expected 1:7 (unclosed ( 1:3)"],
  ],
  ["f:{(x+1}", "'} at the }", [") expected 1:8 (unclosed ( 1:4)"]],
  ['s:"abc', `'" at the end`, ['" expected 1:6 (unclosed " 1:3)']],
  [
    's:"ab\nc"',
    `'" at the end of line 1, as column 0 ends it`,
    ['" expected 1:5 (unclosed " 1:3)', '" expected 2:2 (unclosed " 2:2)'],
  ],
  ['a:"ab\n cd', `'" at the end`, ['" expected 2:3 (unclosed " 1:3)']],
  [
    'a:("abc',
    "'( at the end",
    ['" expected 1:7 (unclosed " 1:4)', ") expected 1:7 (unclosed ( 1:3)"],
  ],
  [
    "a:(1;[2",
    "'[ at the end",
    ["] expected 1:7 (unclosed [ 1:6)", ") expected 1:7 (unclosed ( 1:3)"],
  ],
  [
    "f:{x+1\n}",
    "'{ at the end of line 1",
    ["} expected 1:6 (unclosed { 1:3)", "unmatched } 2:1"],
  ],
  [
    "a:1 2)\nb:(3",
    "') at the ), the first",
    ["unmatched ) 1:6", ") expected 2:4 (unclosed ( 2:3)"],
  ],
  ['a:")"]', "'] at the ]", ["unmatched ] 1:6"]],
  ["a:(1;2) / (", "none: in a comment", []],
  [
    "a:(1;2 / )",
    "'( at the end, before the comment",
    [") expected 1:6 (unclosed ( 1:3)"],
  ],
  // None of these
  ["f:{[x]\n  x+1\n  }", "none", []],
  ['a:"ab\n\n  cd"', "none", []],
  ['s:"a(b"\nt:`a\n/ (\nu:1 / ]', "none", []],
  ["/\n(\n\\\nv:1", "none: a block comment", []],
  ["v:1\n\\\n(", "none: after a lone \\", []],
  ["k)a:(1", "'( (a k line, not read)", []],
  ["\\d .x(", "none: a command", []],
  ["", "none", []],
];

suite("syntax errors", () => {
  for (const [name, eol] of endings) {
    for (const [script, q, expected] of cases) {
      const text = script.replaceAll("\n", eol);
      test(`${JSON.stringify(text)} ${name} (q: ${q})`, () => {
        assert.deepStrictEqual(shown(text), expected);
      });
    }
  }

  test("deep brackets", () => {
    const text = `f:${"(".repeat(5000)}a`;
    const found = syntaxErrors(text);
    assert.strictEqual(found.length, 5000);
    // Innermost first
    assert.strictEqual(found[0].related?.start, 5001);
  });

  for (const [name, eol] of endings) {
    test(`a large file, quickly (${name})`, () => {
      const block = [
        "f:{[x;y]",
        '  a:"str(ing";',
        "  b:(x;y;`sym);",
        "  / a comment ]",
        "  c:{x+y}[a;b]}",
        "g:(1;2",
      ].join(eol);
      const text = Array(10_000).fill(block).join(eol);
      const start = performance.now();
      const found = syntaxErrors(text);
      const took = performance.now() - start;
      assert.strictEqual(found.length, 10_000);
      assert.ok(took < 500, `${took} ms`);
    });
  }
});
