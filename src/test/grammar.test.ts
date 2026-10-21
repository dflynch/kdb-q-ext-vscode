import * as assert from "node:assert";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";

const grammarPath = path.join(__dirname, "../../syntaxes/q.tmGrammar.json");

async function loadGrammar(): Promise<textmate.IGrammar> {
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
  const grammar = await registry.loadGrammar("source.q");
  assert.ok(grammar, "grammar did not load");
  return grammar;
}

// Every non-whitespace token across all lines, as [text, innermost scope]
function tokenize(grammar: textmate.IGrammar, source: string) {
  const tokens: [string, string][] = [];
  let state = textmate.INITIAL;
  for (const line of source.split("\n")) {
    const result = grammar.tokenizeLine(line, state);
    for (const token of result.tokens) {
      const text = line.slice(token.startIndex, token.endIndex).trim();
      if (text) {
        tokens.push([text, token.scopes[token.scopes.length - 1]]);
      }
    }
    state = result.ruleStack;
  }
  return tokens;
}

suite("q grammar", () => {
  let grammar: textmate.IGrammar;

  suiteSetup(async () => {
    grammar = await loadGrammar();
  });

  const cases: [string, string, [string, string][]][] = [
    // Comments
    ["comment line", "/ note", [["/ note", "comment.line.q"]]],
    [
      "trailing comment",
      "a:1 / note",
      [
        ["a", "variable.other.q"],
        [":", "punctuation.assignment.q"],
        ["1", "constant.numeric.number.q"],
        ["/ note", "comment.line.q"],
      ],
    ],
    [
      "trailing comment after tab",
      "a\t/ note",
      [
        ["a", "variable.other.q"],
        ["/ note", "comment.line.q"],
      ],
    ],
    ["indented comment line", "  / note", [["/ note", "comment.line.q"]]],
    [
      "iterator is not a comment",
      "+/[1 2]",
      [
        ["+", "keyword.operator.q"],
        ["/", "keyword.control.iterators.q"],
        ["[", "source.q"],
        ["1", "constant.numeric.number.q"],
        ["2", "constant.numeric.number.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "slash after semicolon is not a comment",
      "a;/b",
      [
        ["a", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["/", "keyword.control.iterators.q"],
        ["b", "variable.other.q"],
      ],
    ],
    [
      "block comment",
      "a\n/\nnote\n\\\nb",
      [
        ["a", "variable.other.q"],
        ["/", "comment.block.q"],
        ["note", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["b", "variable.other.q"],
      ],
    ],
    [
      "block comment markers with trailing whitespace",
      "/  \nnote\n\\ \nb",
      [
        ["/", "comment.block.q"],
        ["note", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["b", "variable.other.q"],
      ],
    ],
    [
      "unterminated block comment",
      "/\nnote\nb",
      [
        ["/", "comment.block.q"],
        ["note", "comment.block.q"],
        ["b", "comment.block.q"],
      ],
    ],
    [
      "end-of-file comment",
      "a\n\\\nb:1",
      [
        ["a", "variable.other.q"],
        ["\\", "comment.last.q"],
        ["b:1", "comment.last.q"],
      ],
    ],

    // Strings
    [
      "string",
      '"abc"',
      [
        ['"', "string.quoted.q"],
        ["abc", "string.quoted.q"],
        ['"', "string.quoted.q"],
      ],
    ],
    [
      "escaped quote and backslash",
      '"a\\"b\\\\"',
      [
        ['"', "string.quoted.q"],
        ["a", "string.quoted.q"],
        ['\\"', "constant.character.escape.q"],
        ["b", "string.quoted.q"],
        ["\\\\", "constant.character.escape.q"],
        ['"', "string.quoted.q"],
      ],
    ],
    [
      "newline, tab, return and octal escapes",
      '"\\n\\t\\r\\001\\377"',
      [
        ['"', "string.quoted.q"],
        ["\\n", "constant.character.escape.q"],
        ["\\t", "constant.character.escape.q"],
        ["\\r", "constant.character.escape.q"],
        ["\\001", "constant.character.escape.q"],
        ["\\377", "constant.character.escape.q"],
        ['"', "string.quoted.q"],
      ],
    ],
    [
      "invalid escapes",
      '"\\a\\400"',
      [
        ['"', "string.quoted.q"],
        ["\\a\\400", "string.quoted.q"],
        ['"', "string.quoted.q"],
      ],
    ],
    [
      "slashes in strings are not comments",
      '"a /b"',
      [
        ['"', "string.quoted.q"],
        ["a /b", "string.quoted.q"],
        ['"', "string.quoted.q"],
      ],
    ],
    [
      "comment after a string",
      '"http://x" / note',
      [
        ['"', "string.quoted.q"],
        ["http://x", "string.quoted.q"],
        ['"', "string.quoted.q"],
        ["/ note", "comment.line.q"],
      ],
    ],

    // System commands
    ["load command", "\\l foo.q", [["\\l foo.q", "entity.other.load.q"]]],
    [
      "load command with absolute path",
      "\\l /a/b.q",
      [["\\l /a/b.q", "entity.other.load.q"]],
    ],
    [
      "path arguments are not comments",
      "\\cd /tmp\n\\1 /tmp/out.txt",
      [
        ["\\cd", "entity.other.command.q"],
        ["/tmp", "source.q"],
        ["\\1", "entity.other.command.q"],
        ["/tmp/out.txt", "source.q"],
      ],
    ],
    [
      "expression arguments are not comments",
      "\\ts f /x",
      [
        ["\\ts", "entity.other.command.q"],
        ["f", "variable.other.q"],
        ["/", "keyword.control.iterators.q"],
        ["x", "variable.other.q"],
      ],
    ],
    [
      "timer command",
      "\\t 1000",
      [
        ["\\t", "entity.other.command.q"],
        ["1000", "constant.numeric.number.q"],
      ],
    ],
    [
      "timing command",
      "\\ts f x",
      [
        ["\\ts", "entity.other.command.q"],
        ["f", "variable.other.q"],
        ["x", "variable.other.q"],
      ],
    ],

    // Keywords
    [
      "use",
      "use`kx.log",
      [
        ["use", "keyword.control.import.q"],
        ["`kx.log", "support.type.symbol.q"],
      ],
    ],
    [
      "control flow",
      "if do while",
      [
        ["if", "keyword.control.q"],
        ["do", "keyword.control.q"],
        ["while", "keyword.control.q"],
      ],
    ],
    [
      "cond",
      "$[a;b;c]",
      [
        ["$", "keyword.control.q"],
        ["[", "source.q"],
        ["a", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["b", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["c", "variable.other.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "vector conditional",
      "?[a;b;c]",
      [
        ["?", "keyword.control.q"],
        ["[", "source.q"],
        ["a", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["b", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["c", "variable.other.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "iterator words",
      "each peach over scan prior",
      [
        ["each", "keyword.control.q"],
        ["peach", "keyword.control.q"],
        ["over", "keyword.control.q"],
        ["scan", "keyword.control.q"],
        ["prior", "keyword.control.q"],
      ],
    ],
    [
      "iterator glyphs",
      "f' f/: f\\: f': f/ f\\",
      [
        ["f", "variable.other.q"],
        ["'", "keyword.control.iterators.q"],
        ["f", "variable.other.q"],
        ["/:", "keyword.control.iterators.q"],
        ["f", "variable.other.q"],
        ["\\:", "keyword.control.iterators.q"],
        ["f", "variable.other.q"],
        ["':", "keyword.control.iterators.q"],
        ["f", "variable.other.q"],
        ["/", "keyword.control.iterators.q"],
        ["f", "variable.other.q"],
        ["\\", "keyword.control.iterators.q"],
      ],
    ],
    [
      "qSQL",
      "select a by b from t where c",
      [
        ["select", "keyword.control.qsql.q"],
        ["a", "variable.other.q"],
        ["by", "keyword.control.qsql.q"],
        ["b", "variable.other.q"],
        ["from", "keyword.control.qsql.q"],
        ["t", "variable.other.q"],
        ["where", "keyword.control.qsql.q"],
        ["c", "variable.other.q"],
      ],
    ],
    [
      "qSQL update, exec and delete",
      "update exec delete",
      [
        ["update", "keyword.control.qsql.q"],
        ["exec", "keyword.control.qsql.q"],
        ["delete", "keyword.control.qsql.q"],
      ],
    ],
    [
      "built-in functions",
      "count til wavg xbar",
      [
        ["count", "keyword.other.q"],
        ["til", "keyword.other.q"],
        ["wavg", "keyword.other.q"],
        ["xbar", "keyword.other.q"],
      ],
    ],
    [
      "built-in name inside an identifier",
      "counts tilde",
      [
        ["counts", "variable.other.q"],
        ["tilde", "variable.other.q"],
      ],
    ],
    [
      "operators",
      "a+b-c*d%e=f<g>h~i|j&k#l^m@n!o",
      [
        ["a", "variable.other.q"],
        ["+", "keyword.operator.q"],
        ["b", "variable.other.q"],
        ["-", "keyword.operator.q"],
        ["c", "variable.other.q"],
        ["*", "keyword.operator.q"],
        ["d", "variable.other.q"],
        ["%", "keyword.operator.q"],
        ["e", "variable.other.q"],
        ["=", "keyword.operator.q"],
        ["f", "variable.other.q"],
        ["<", "keyword.operator.q"],
        ["g", "variable.other.q"],
        [">", "keyword.operator.q"],
        ["h", "variable.other.q"],
        ["~", "keyword.operator.q"],
        ["i", "variable.other.q"],
        ["|", "keyword.operator.q"],
        ["j", "variable.other.q"],
        ["&", "keyword.operator.q"],
        ["k", "variable.other.q"],
        ["#", "keyword.operator.q"],
        ["l", "variable.other.q"],
        ["^", "keyword.operator.q"],
        ["m", "variable.other.q"],
        ["@", "keyword.operator.q"],
        ["n", "variable.other.q"],
        ["!", "keyword.operator.q"],
        ["o", "variable.other.q"],
      ],
    ],
    [
      "join, drop and apply",
      "a,b;2_c;d _e;f . g;.[h;i]",
      [
        ["a", "variable.other.q"],
        [",", "keyword.operator.q"],
        ["b", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["2", "constant.numeric.number.q"],
        ["_", "keyword.operator.q"],
        ["c", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["d", "variable.other.q"],
        ["_", "keyword.operator.q"],
        ["e", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["f", "variable.other.q"],
        [".", "keyword.operator.q"],
        ["g", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        [".", "keyword.operator.q"],
        ["[", "source.q"],
        ["h", "variable.other.q"],
        [";", "punctuation.terminator.statement.q"],
        ["i", "variable.other.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "name ending in a digit before assignment",
      "n2:3",
      [
        ["n2", "variable.other.q"],
        [":", "punctuation.assignment.q"],
        ["3", "constant.numeric.number.q"],
      ],
    ],
    [
      "minus after a value",
      'a-1;(b)-1;c[0]-1;"d"-1',
      [
        ["a", "variable.other.q"],
        ["-", "keyword.operator.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["(", "source.q"],
        ["b", "variable.other.q"],
        [")", "source.q"],
        ["-", "keyword.operator.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["c", "variable.other.q"],
        ["[", "source.q"],
        ["0", "constant.numeric.number.q"],
        ["]", "source.q"],
        ["-", "keyword.operator.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ['"', "string.quoted.q"],
        ["d", "string.quoted.q"],
        ['"', "string.quoted.q"],
        ["-", "keyword.operator.q"],
        ["1", "constant.numeric.number.q"],
      ],
    ],
    [
      "negative numbers",
      "-5;a -1;b[0] -1;-c",
      [
        ["-5", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["a", "variable.other.q"],
        ["-1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["b", "variable.other.q"],
        ["[", "source.q"],
        ["0", "constant.numeric.number.q"],
        ["]", "source.q"],
        ["-1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["-", "keyword.operator.q"],
        ["c", "variable.other.q"],
      ],
    ],

    // Literals
    [
      "symbols",
      "`abc`a.b`a_1 `",
      [
        ["`abc", "support.type.symbol.q"],
        ["`a.b", "support.type.symbol.q"],
        ["`a_1", "support.type.symbol.q"],
        ["`", "support.type.symbol.q"],
      ],
    ],
    [
      "handles",
      "`:db `:localhost:5000",
      [
        ["`:db", "support.type.symbol.q"],
        ["`:localhost:5000", "support.type.symbol.q"],
      ],
    ],
    [
      "handle with a path",
      "`:data/trades.csv",
      [["`:data/trades.csv", "support.type.symbol.q"]],
    ],
    [
      "slash after a symbol is an iterator",
      "`a/b",
      [
        ["`a", "support.type.symbol.q"],
        ["/", "keyword.control.iterators.q"],
        ["b", "variable.other.q"],
      ],
    ],
    [
      "numbers",
      "42 1.5 .5 1. 1e10 1e-3 1e100 1.e2 3i 7j 2h 2.5e 1f",
      [
        ["42", "constant.numeric.number.q"],
        ["1.5", "constant.numeric.number.q"],
        [".5", "constant.numeric.number.q"],
        ["1.", "constant.numeric.number.q"],
        ["1e10", "constant.numeric.number.q"],
        ["1e-3", "constant.numeric.number.q"],
        ["1e100", "constant.numeric.number.q"],
        ["1.e2", "constant.numeric.number.q"],
        ["3i", "constant.numeric.number.q"],
        ["7j", "constant.numeric.number.q"],
        ["2h", "constant.numeric.number.q"],
        ["2.5e", "constant.numeric.number.q"],
        ["1f", "constant.numeric.number.q"],
      ],
    ],
    [
      "booleans",
      "1b 0101b",
      [
        ["1b", "constant.numeric.binary.q"],
        ["0101b", "constant.numeric.binary.q"],
      ],
    ],
    [
      "bytes",
      "0x1f 0x00ff 0x0 0x",
      [
        ["0x1f", "constant.numeric.byte.q"],
        ["0x00ff", "constant.numeric.byte.q"],
        ["0x0", "constant.numeric.byte.q"],
        ["0x", "constant.numeric.byte.q"],
      ],
    ],
    [
      "nulls and infinities",
      "0N 0n 0w 0W 0Nd 0Np",
      [
        ["0N", "constant.language.infinity.q"],
        ["0n", "constant.language.infinity.q"],
        ["0w", "constant.language.infinity.q"],
        ["0W", "constant.language.infinity.q"],
        ["0Nd", "constant.language.infinity.q"],
        ["0Np", "constant.language.infinity.q"],
      ],
    ],
    [
      "typed and negative nulls and infinities",
      "0Ni 0Nc 0Ng 0Wj -0Wf -0w",
      [
        ["0Ni", "constant.language.infinity.q"],
        ["0Nc", "constant.language.infinity.q"],
        ["0Ng", "constant.language.infinity.q"],
        ["0Wj", "constant.language.infinity.q"],
        ["-0Wf", "constant.language.infinity.q"],
        ["-0w", "constant.language.infinity.q"],
      ],
    ],
    ["date", "2026.10.21", [["2026.10.21", "constant.numeric.date.q"]]],
    ["month", "2026.10m", [["2026.10m", "constant.numeric.month.q"]]],
    [
      "times",
      "09:30 09:30:00 09:30:00.000",
      [
        ["09:30", "constant.numeric.time.q"],
        ["09:30:00", "constant.numeric.time.q"],
        ["09:30:00.000", "constant.numeric.time.q"],
      ],
    ],
    [
      "timespans",
      "0D09:30:00.000000000 1D 2D03 -1D02:00:00",
      [
        ["0D09:30:00.000000000", "constant.numeric.timespan.q"],
        ["1D", "constant.numeric.timespan.q"],
        ["2D03", "constant.numeric.timespan.q"],
        ["-1D02:00:00", "constant.numeric.timespan.q"],
      ],
    ],
    [
      "timestamp",
      "2026.10.21D09:30:00.000000000",
      [["2026.10.21D09:30:00.000000000", "constant.numeric.timestamp.q"]],
    ],
    [
      "timestamps with partial times",
      "2026.10.21D 2026.10.21D09",
      [
        ["2026.10.21D", "constant.numeric.timestamp.q"],
        ["2026.10.21D09", "constant.numeric.timestamp.q"],
      ],
    ],
    [
      "datetime",
      "2026.10.21T09:30:00.000",
      [["2026.10.21T09:30:00.000", "constant.numeric.datetime.q"]],
    ],
    [
      "file and IPC operators",
      "0: 1: 2:",
      [
        ["0:", "constant.numeric.file.q"],
        ["1:", "constant.numeric.file.q"],
        ["2:", "constant.numeric.file.q"],
      ],
    ],

    // Namespaces
    [
      "system namespaces",
      ".Q.dd .z.p .z.ts .h.ht .j.j",
      [
        [".Q.dd", "support.function.namespace.utilities.q"],
        [".z.p", "support.function.namespace.dotz.q"],
        [".z.ts", "support.function.namespace.dotz.q"],
        [".h.ht", "support.function.namespace.http.q"],
        [".j.j", "support.function.namespace.json.q"],
      ],
    ],
    [
      "q 5 namespace members",
      ".Q.sx .Q.L1 .Q.trpd .h.ka",
      [
        [".Q.sx", "support.function.namespace.utilities.q"],
        [".Q.L1", "support.function.namespace.utilities.q"],
        [".Q.trpd", "support.function.namespace.utilities.q"],
        [".h.ka", "support.function.namespace.http.q"],
      ],
    ],
    [
      "removed namespace members",
      ".Q.Cf .Q.Xf",
      [
        [".Q.Cf", "variable.other.q"],
        [".Q.Xf", "variable.other.q"],
      ],
    ],

    // Names and functions
    [
      "names",
      "trade x_1 .a.b",
      [
        ["trade", "variable.other.q"],
        ["x_1", "variable.other.q"],
        [".a.b", "variable.other.q"],
      ],
    ],
    [
      "dotted names",
      "a.b a.b.c",
      [
        ["a.b", "variable.other.q"],
        ["a.b.c", "variable.other.q"],
      ],
    ],
    [
      "function definition",
      "f:{x}",
      [
        ["f", "entity.name.function.q"],
        [":", "punctuation.assignment.q"],
        ["{", "source.q"],
        ["x", "variable.other.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "namespaced function definition",
      ".a.f: {x}",
      [
        [".a.f", "entity.name.function.q"],
        [":", "punctuation.assignment.q"],
        ["{", "source.q"],
        ["x", "variable.other.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "global function definition",
      "h::{x}",
      [
        ["h", "entity.name.function.q"],
        ["::", "punctuation.assignment.q"],
        ["{", "source.q"],
        ["x", "variable.other.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "parameter",
      "{[a] a}",
      [
        ["{", "source.q"],
        ["[", "source.q"],
        ["a", "variable.parameter.q"],
        ["]", "source.q"],
        ["a", "variable.other.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "parameters",
      "{[a;b.c] a}\n{[ d ;\n e ]}",
      [
        ["{", "source.q"],
        ["[", "source.q"],
        ["a", "variable.parameter.q"],
        [";", "punctuation.terminator.statement.q"],
        ["b.c", "variable.parameter.q"],
        ["]", "source.q"],
        ["a", "variable.other.q"],
        ["}", "source.q"],
        ["{", "source.q"],
        ["[", "source.q"],
        ["d", "variable.parameter.q"],
        [";", "punctuation.terminator.statement.q"],
        ["e", "variable.parameter.q"],
        ["]", "source.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "assignment",
      "a:1;b::2",
      [
        ["a", "variable.other.q"],
        [":", "punctuation.assignment.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.terminator.statement.q"],
        ["b", "variable.other.q"],
        ["::", "punctuation.assignment.q"],
        ["2", "constant.numeric.number.q"],
      ],
    ],
  ];

  for (const [name, source, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(tokenize(grammar, source), expected);
    });
  }
});
