import * as assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { type Script, scan, type Token } from "../scanner";

const fixtures = path.join(__dirname, "../../test/fixtures");

// Every token in the script, statements' and comments', in order
function tokens(script: Script): Token[] {
  return [
    ...script.statements.flatMap((s) => s.tokens),
    ...script.comments,
  ].sort((a, b) => a.start - b.start);
}

// Tokens as "kind text"
function shown(text: string): string[] {
  return tokens(scan(text)).map(
    (t) => `${t.kind} ${text.slice(t.start, t.end)}`,
  );
}

suite("scanner against q's lexer", () => {
  const read = (file: string) => readFileSync(path.join(fixtures, file));
  const fixture: {
    lexing: string;
    script: string;
    cases: { line: string; tokens: string[] | string }[];
  } = JSON.parse(read("lexing.json").toString());

  test("fixture is up to date with lexing.q (npm run fixtures)", () => {
    const md5 = createHash("md5").update(read("lexing.q")).digest("hex");
    assert.strictEqual(fixture.lexing, md5);
    const script = createHash("md5").update(read("lex.q")).digest("hex");
    assert.strictEqual(fixture.script, script);
  });

  // q's tokens without its whitespace ones, and a trailing comment from its
  // "/", as q keeps the space before it
  for (const { line, tokens: expected } of fixture.cases) {
    test(line, () => {
      assert.ok(Array.isArray(expected), `q rejects it: ${expected}`);
      const script = scan(line);
      assert.deepStrictEqual(
        tokens(script).map((t) => line.slice(t.start, t.end)),
        expected.filter((t) => t.trim()).map((t) => t.trimStart()),
      );
    });
  }
});

suite("scanner kinds", () => {
  const cases: [string, string[]][] = [
    ["p)x = 7 // 2", ["other p)x = 7 // 2"]],
    ["q)a:1", ["name a", "operator :", "number 1"]],
    ["a -1", ["name a", "number -1"]],
    ["a-1", ["name a", "operator -", "number 1"]],
    [
      ".servers.getservers[`a]",
      ["name .servers.getservers", "open [", "symbol `a", "close ]"],
    ],
    ["`a`b!1 2", ["symbol `a`b", "operator !", "number 1", "number 2"]],
    ['"a\\"b"', ['string "a\\"b"']],
    ["x::1", ["name x", "operator ::", "number 1"]],
    ["x+:1", ["name x", "operator +:", "number 1"]],
    ["0:", ["operator 0:"]],
    ["1:-1", ["operator 1:", "number -1"]],
    ["+/[x]", ["operator +", "iterator /", "open [", "name x", "close ]"]],
    ["x/:y", ["name x", "iterator /:", "name y"]],
    ["x':y", ["name x", "iterator ':", "name y"]],
    [
      "f:{x;y}",
      [
        "name f",
        "operator :",
        "open {",
        "name x",
        "separator ;",
        "name y",
        "close }",
      ],
    ],
    ["a:1 / note", ["name a", "operator :", "number 1", "comment / note"]],
    ["2026.11.04D12:00 12:00", ["number 2026.11.04D12:00", "number 12:00"]],
    ["a£", ["name a", "unknown £"]],
    ['a:"open', ["name a", "operator :", 'string "open']],
  ];
  for (const [source, expected] of cases) {
    test(source, () => {
      assert.deepStrictEqual(shown(source), expected);
    });
  }

  test("an unterminated string is flagged", () => {
    const [string] = scan('a:"x\nb:2').statements[0].tokens.slice(-1);
    assert.strictEqual(string.unterminated, true);
    assert.strictEqual(
      scan('a:"x"').statements[0].tokens[2].unterminated,
      undefined,
    );
  });
});

suite("scanner layout", () => {
  // Each statement's text, start to end
  function statements(text: string): string[] {
    return scan(text).statements.map((s) => text.slice(s.start, s.end));
  }

  const cases: [string, string, string[]][] = [
    ["statements", "a:1\nb:2", ["a:1", "b:2"]],
    ["continuation lines", "f:{\n  x+1\n  }\ng", ["f:{\n  x+1\n  }", "g"]],
    ["brace at column 0 starts a statement", "f:{\n  x\n}", ["f:{\n  x", "}"]],
    ["indented first line", "  x\n  y", ["x\n  y"]],
    ["blank lines inside", "f:{\n\n  x}", ["f:{\n\n  x}"]],
    ["comment line inside", "a:1\n/ c\n  +2", ["a:1\n/ c\n  +2"]],
    ["comment line after", "a:1\n/ c\nb", ["a:1", "b"]],
    ["block inside", "f:{\n/\nnote\n\\\n  x}", ["f:{\n/\nnote\n\\\n  x}"]],
    ["string over lines", 'a:"x\n  y"\nb', ['a:"x\n  y"', "b"]],
    ["string ended at column 0", 'a:"x\nb', ['a:"x', "b"]],
    [
      "system command",
      "\\l a/b.q / not a comment\nb",
      ["\\l a/b.q / not a comment", "b"],
    ],
    ["k line", "k)+/1 2 / sum\n  +1\nb", ["k)+/1 2 / sum\n  +1", "b"]],
    ["shebang", "#!/usr/bin/env q\na:1", ["a:1"]],
    ["end of script", "a:1\n\\\nb:2", ["a:1"]],
    ["CRLF", "f:{\r\n  x}\r\nb", ["f:{\r\n  x}", "b"]],
    // Another language's prefix: its lines to .X.e as written (q 5.0)
    [
      "other language",
      "p)def f(x:\n   return (x / y\nb",
      ["p)def f(x:\n   return (x / y", "b"],
    ],
    ["q's own prefix", "q)a:(1;\n  2)\nb", ["q)a:(1;\n  2)", "b"]],
    // q reads a lone \r as whitespace, not a line break (q 5.0)
    ["lone CR", "a:(1;\r2)\rb:3", ["a:(1;\r2)\rb:3"]],
    ["lone CR, then a comment", "a:1\r/ (\rb", ["a:1\r/ (\rb"]],
    ["lone CR at a line's start, not indentation", "f:{\n\r}", ["f:{", "}"]],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(statements(text), expected);
    });
  }

  test("comments between statements", () => {
    const text = "/ about f\nf:1\n/\nblock\n\\\ng:2 / trailing";
    const script = scan(text);
    assert.deepStrictEqual(
      script.comments.map((t) => text.slice(t.start, t.end)),
      ["/ about f", "/\nblock\n\\"],
    );
    assert.deepStrictEqual(script.blocks, [{ open: 2, close: 4 }]);
  });

  test("k lines are opaque", () => {
    assert.deepStrictEqual(shown("k)f:{x+y} / c"), [
      "k k)f:{x+y}",
      "comment / c",
    ]);
  });

  test("the end of the script", () => {
    assert.strictEqual(scan("a:1\n\\\nb:2").end, 1);
    assert.strictEqual(scan("a:1\n/\n\\\nb:2").end, undefined);
  });
});

suite("scanner over the corpus", () => {
  const corpus = readFileSync(path.join(fixtures, "corpus.q"), "utf8");

  // Tokens in order, not overlapping, and every character outside them
  // whitespace, a shebang, or after the end of the script
  function check(text: string) {
    const script = scan(text);
    for (const s of script.statements) {
      s.tokens.forEach((t, i) => {
        assert.ok(
          i === 0 || t.start >= s.tokens[i - 1].end,
          "in order as made",
        );
      });
    }
    const all = tokens(script);
    let at = 0;
    const lines = text.split("\n");
    const stop =
      script.end === undefined
        ? text.length
        : lines.slice(0, script.end).join("\n").length;
    for (const t of all) {
      assert.ok(t.start >= at && t.end > t.start, "tokens in order");
      assert.match(text.slice(at, t.start), /^\s*$/, "only whitespace between");
      at = t.end;
    }
    assert.match(text.slice(at, stop), /^\s*$/, "only whitespace after");
  }

  test("nothing is lost", () => {
    check(corpus);
  });

  test("never throws on a half-typed file", () => {
    for (let i = 0; i < corpus.length; i += 3) {
      check(corpus.slice(0, i));
    }
  })
    // Every prefix of the corpus, not a measure of speed: CI's machines are
    // slower
    .timeout(20000);
});
