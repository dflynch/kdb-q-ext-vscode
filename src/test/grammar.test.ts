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
    ["comment line", "/ note", [["/ note", "comment.line.slash.q"]]],
    [
      "trailing comment",
      "a:1 / note",
      [
        ["a", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["1", "constant.numeric.number.q"],
        ["/ note", "comment.line.slash.q"],
      ],
    ],
    [
      "trailing comment after tab",
      "a\t/ note",
      [
        ["a", "source.q"],
        ["/ note", "comment.line.slash.q"],
      ],
    ],
    ["indented comment line", "  / note", [["/ note", "comment.line.slash.q"]]],
    [
      "iterator is not a comment",
      "+/[1 2]",
      [
        ["+", "keyword.operator.arithmetic.q"],
        ["/", "keyword.operator.iterator.q"],
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
        ["a", "source.q"],
        [";", "punctuation.separator.q"],
        ["/", "keyword.operator.iterator.q"],
        ["b", "source.q"],
      ],
    ],
    [
      "block comment",
      "a\n/\nnote\n\\\nb",
      [
        ["a", "source.q"],
        ["/", "comment.block.q"],
        ["note", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["b", "source.q"],
      ],
    ],
    [
      "block comment markers with trailing whitespace",
      "/  \nnote\n\\ \nb",
      [
        ["/", "comment.block.q"],
        ["note", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["b", "source.q"],
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
      "nested block comments",
      "a\n/\nb\n/\nc\n\\\nd\n\\\ne",
      [
        ["a", "source.q"],
        ["/", "comment.block.q"],
        ["b", "comment.block.q"],
        ["/", "comment.block.q"],
        ["c", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["d", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["e", "source.q"],
      ],
    ],
    [
      "indented slash in a block comment is not a marker",
      "/\nb\n  /\n\\\nc",
      [
        ["/", "comment.block.q"],
        ["b", "comment.block.q"],
        ["/", "comment.block.q"],
        ["\\", "comment.block.q"],
        ["c", "source.q"],
      ],
    ],
    [
      "end-of-file comment",
      "a\n\\\nb:1",
      [
        ["a", "source.q"],
        ["\\", "comment.block.eof.q"],
        ["b:1", "comment.block.eof.q"],
      ],
    ],

    // Strings
    [
      "string",
      '"abc"',
      [
        ['"', "string.quoted.double.q"],
        ["abc", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
      ],
    ],
    [
      "escaped quote and backslash",
      '"a\\"b\\\\"',
      [
        ['"', "string.quoted.double.q"],
        ["a", "string.quoted.double.q"],
        ['\\"', "constant.character.escape.q"],
        ["b", "string.quoted.double.q"],
        ["\\\\", "constant.character.escape.q"],
        ['"', "string.quoted.double.q"],
      ],
    ],
    [
      "newline, tab, return and octal escapes",
      '"\\n\\t\\r\\001\\377"',
      [
        ['"', "string.quoted.double.q"],
        ["\\n", "constant.character.escape.q"],
        ["\\t", "constant.character.escape.q"],
        ["\\r", "constant.character.escape.q"],
        ["\\001", "constant.character.escape.q"],
        ["\\377", "constant.character.escape.q"],
        ['"', "string.quoted.double.q"],
      ],
    ],
    [
      "invalid escapes",
      '"\\a\\400"',
      [
        ['"', "string.quoted.double.q"],
        ["\\a\\400", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
      ],
    ],
    [
      "slashes in strings are not comments",
      '"a /b"',
      [
        ['"', "string.quoted.double.q"],
        ["a /b", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
      ],
    ],
    [
      "comment after a string",
      '"http://x" / note',
      [
        ['"', "string.quoted.double.q"],
        ["http://x", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
        ["/ note", "comment.line.slash.q"],
      ],
    ],

    // System commands
    [
      "load command",
      "\\l foo.q",
      [
        ["\\l", "meta.preprocessor.system.q"],
        ["foo.q", "source.q"],
      ],
    ],
    [
      "load command with absolute path",
      "\\l /a/b.q",
      [
        ["\\l", "meta.preprocessor.system.q"],
        ["/a/b.q", "source.q"],
      ],
    ],
    [
      "path arguments are not comments",
      "\\cd /tmp\n\\1 /tmp/out.txt",
      [
        ["\\cd", "meta.preprocessor.system.q"],
        ["/tmp", "source.q"],
        ["\\1", "meta.preprocessor.system.q"],
        ["/tmp/out.txt", "source.q"],
      ],
    ],
    [
      "iterator in a timing command",
      "\\ts f/x",
      [
        ["\\ts", "meta.preprocessor.system.q"],
        ["f", "source.q"],
        ["/", "keyword.operator.iterator.q"],
        ["x", "source.q"],
      ],
    ],
    [
      "trailing comment after a timing command",
      "\\ts f /x",
      [
        ["\\ts", "meta.preprocessor.system.q"],
        ["f", "source.q"],
        ["/x", "comment.line.slash.q"],
      ],
    ],
    [
      "timer command",
      "\\t 1000",
      [
        ["\\t", "meta.preprocessor.system.q"],
        ["1000", "constant.numeric.number.q"],
      ],
    ],
    [
      "timing command",
      "\\ts f x",
      [
        ["\\ts", "meta.preprocessor.system.q"],
        ["f", "source.q"],
        ["x", "source.q"],
      ],
    ],
    [
      "repeat counts",
      "\\t:100 f[]\n\\ts:10 f x / y",
      [
        ["\\t:100", "meta.preprocessor.system.q"],
        ["f", "source.q"],
        ["[]", "source.q"],
        ["\\ts:10", "meta.preprocessor.system.q"],
        ["f", "source.q"],
        ["x", "source.q"],
        ["/ y", "comment.line.slash.q"],
      ],
    ],
    [
      "operating system commands",
      "\\ls /tmp\n\\mkdir -p /tmp/a",
      [
        ["\\ls", "meta.preprocessor.system.q"],
        ["/tmp", "source.q"],
        ["\\mkdir", "meta.preprocessor.system.q"],
        ["-p /tmp/a", "source.q"],
      ],
    ],
    [
      "k line",
      "k)+/1 2",
      [
        ["k)", "meta.preprocessor.language.q"],
        ["+/1 2", "source.q"],
      ],
    ],

    // Keywords
    [
      "use",
      "use`kx.log",
      [
        ["use", "keyword.control.import.q"],
        ["`kx.log", "constant.language.symbol.q"],
      ],
    ],
    [
      "control flow",
      "if do while",
      [
        ["if", "keyword.control.conditional.q"],
        ["do", "keyword.control.loop.q"],
        ["while", "keyword.control.loop.q"],
      ],
    ],
    [
      "cond",
      "$[a;b;c]",
      [
        ["$", "keyword.control.conditional.q"],
        ["[", "source.q"],
        ["a", "source.q"],
        [";", "punctuation.separator.q"],
        ["b", "source.q"],
        [";", "punctuation.separator.q"],
        ["c", "source.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "vector conditional",
      "?[a;b;c]",
      [
        ["?", "keyword.control.conditional.q"],
        ["[", "source.q"],
        ["a", "source.q"],
        [";", "punctuation.separator.q"],
        ["b", "source.q"],
        [";", "punctuation.separator.q"],
        ["c", "source.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "iterator words",
      "each peach over scan prior",
      [
        ["each", "support.function.builtin.q"],
        ["peach", "support.function.builtin.q"],
        ["over", "support.function.builtin.q"],
        ["scan", "support.function.builtin.q"],
        ["prior", "support.function.builtin.q"],
      ],
    ],
    [
      "iterator glyphs",
      "f' f/: f\\: f': f/ f\\",
      [
        ["f", "source.q"],
        ["'", "keyword.operator.iterator.q"],
        ["f", "source.q"],
        ["/:", "keyword.operator.iterator.q"],
        ["f", "source.q"],
        ["\\:", "keyword.operator.iterator.q"],
        ["f", "source.q"],
        ["':", "keyword.operator.iterator.q"],
        ["f", "source.q"],
        ["/", "keyword.operator.iterator.q"],
        ["f", "source.q"],
        ["\\", "keyword.operator.iterator.q"],
      ],
    ],
    [
      "exit",
      "exit 0",
      [
        ["exit", "keyword.control.flow.q"],
        ["0", "constant.numeric.number.q"],
      ],
    ],
    [
      "signal",
      "'`a;('b);{'c};f[;'d]",
      [
        ["'", "keyword.control.flow.signal.q"],
        ["`a", "constant.language.symbol.q"],
        [";", "punctuation.separator.q"],
        ["(", "source.q"],
        ["'", "keyword.control.flow.signal.q"],
        ["b", "source.q"],
        [")", "source.q"],
        [";", "punctuation.separator.q"],
        ["{", "source.q"],
        ["'", "keyword.control.flow.signal.q"],
        ["c", "source.q"],
        ["}", "source.q"],
        [";", "punctuation.separator.q"],
        ["f", "source.q"],
        ["[", "source.q"],
        [";", "punctuation.separator.q"],
        ["'", "keyword.control.flow.signal.q"],
        ["d", "source.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "each after a value is not a signal",
      "x,'y;count'[z]",
      [
        ["x", "source.q"],
        [",", "keyword.operator.q"],
        ["'", "keyword.operator.iterator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ["count", "support.function.builtin.q"],
        ["'", "keyword.operator.iterator.q"],
        ["[", "source.q"],
        ["z", "source.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "each after assignment is not a signal",
      "r:'x",
      [
        ["r", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["'", "keyword.operator.iterator.q"],
        ["x", "source.q"],
      ],
    ],
    [
      "qSQL",
      "select a by b from t where c",
      [
        ["select", "keyword.other.qsql.q"],
        ["a", "source.q"],
        ["by", "keyword.other.qsql.q"],
        ["b", "source.q"],
        ["from", "keyword.other.qsql.q"],
        ["t", "source.q"],
        ["where", "keyword.other.qsql.q"],
        ["c", "source.q"],
      ],
    ],
    [
      "qSQL update, exec and delete",
      "update exec delete",
      [
        ["update", "keyword.other.qsql.q"],
        ["exec", "keyword.other.qsql.q"],
        ["delete", "keyword.other.qsql.q"],
      ],
    ],
    [
      "built-in functions",
      "count til wavg xbar",
      [
        ["count", "support.function.builtin.q"],
        ["til", "support.function.builtin.q"],
        ["wavg", "support.function.builtin.q"],
        ["xbar", "support.function.builtin.q"],
      ],
    ],
    [
      "built-in name inside an identifier",
      "counts tilde",
      [
        ["counts", "source.q"],
        ["tilde", "source.q"],
      ],
    ],
    [
      "two-character comparisons",
      "a<>b<=c>=d",
      [
        ["a", "source.q"],
        ["<>", "keyword.operator.comparison.q"],
        ["b", "source.q"],
        ["<=", "keyword.operator.comparison.q"],
        ["c", "source.q"],
        [">=", "keyword.operator.comparison.q"],
        ["d", "source.q"],
      ],
    ],
    [
      "operators",
      "a+b-c*d%e=f<g>h~i|j&k#l^m@n!o",
      [
        ["a", "source.q"],
        ["+", "keyword.operator.arithmetic.q"],
        ["b", "source.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["c", "source.q"],
        ["*", "keyword.operator.arithmetic.q"],
        ["d", "source.q"],
        ["%", "keyword.operator.arithmetic.q"],
        ["e", "source.q"],
        ["=", "keyword.operator.comparison.q"],
        ["f", "source.q"],
        ["<", "keyword.operator.comparison.q"],
        ["g", "source.q"],
        [">", "keyword.operator.comparison.q"],
        ["h", "source.q"],
        ["~", "keyword.operator.comparison.q"],
        ["i", "source.q"],
        ["|", "keyword.operator.q"],
        ["j", "source.q"],
        ["&", "keyword.operator.q"],
        ["k", "source.q"],
        ["#", "keyword.operator.q"],
        ["l", "source.q"],
        ["^", "keyword.operator.q"],
        ["m", "source.q"],
        ["@", "keyword.operator.q"],
        ["n", "source.q"],
        ["!", "keyword.operator.q"],
        ["o", "source.q"],
      ],
    ],
    [
      "join, drop and apply",
      "a,b;2_c;d _e;f . g;.[h;i]",
      [
        ["a", "source.q"],
        [",", "keyword.operator.q"],
        ["b", "source.q"],
        [";", "punctuation.separator.q"],
        ["2", "constant.numeric.number.q"],
        ["_", "keyword.operator.q"],
        ["c", "source.q"],
        [";", "punctuation.separator.q"],
        ["d", "source.q"],
        ["_", "keyword.operator.q"],
        ["e", "source.q"],
        [";", "punctuation.separator.q"],
        ["f", "source.q"],
        [".", "keyword.operator.q"],
        ["g", "source.q"],
        [";", "punctuation.separator.q"],
        [".", "keyword.operator.q"],
        ["[", "source.q"],
        ["h", "source.q"],
        [";", "punctuation.separator.q"],
        ["i", "source.q"],
        ["]", "source.q"],
      ],
    ],
    [
      "name ending in a digit before assignment",
      "n2:3",
      [
        ["n2", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["3", "constant.numeric.number.q"],
      ],
    ],
    [
      "minus after a value",
      'a-1;(b)-1;c[0]-1;"d"-1',
      [
        ["a", "source.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["(", "source.q"],
        ["b", "source.q"],
        [")", "source.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["c", "source.q"],
        ["[", "source.q"],
        ["0", "constant.numeric.number.q"],
        ["]", "source.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ['"', "string.quoted.double.q"],
        ["d", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["1", "constant.numeric.number.q"],
      ],
    ],
    [
      "negative numbers",
      "-5;a -1;b[0] -1;-c",
      [
        ["-5", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["a", "source.q"],
        ["-1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["b", "source.q"],
        ["[", "source.q"],
        ["0", "constant.numeric.number.q"],
        ["]", "source.q"],
        ["-1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["c", "source.q"],
      ],
    ],

    // Literals
    [
      "symbols",
      "`abc `a.b `a_1 `",
      [
        ["`abc", "constant.language.symbol.q"],
        ["`a.b", "constant.language.symbol.q"],
        ["`a_1", "constant.language.symbol.q"],
        ["`", "constant.language.symbol.q"],
      ],
    ],
    [
      "symbol list",
      "`abc`a.b``a_1",
      [["`abc`a.b``a_1", "constant.language.symbol.q"]],
    ],
    [
      "handles",
      "`:db `:localhost:5000",
      [
        ["`:db", "support.class.handle.q"],
        ["`:localhost:5000", "support.class.handle.q"],
      ],
    ],
    [
      "handle with a path",
      "`:data/trades.csv",
      [["`:data/trades.csv", "support.class.handle.q"]],
    ],
    [
      "slash after a symbol is an iterator",
      "`a/b",
      [
        ["`a", "constant.language.symbol.q"],
        ["/", "keyword.operator.iterator.q"],
        ["b", "source.q"],
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
      "temporal type suffixes",
      "3n 12t 1p 12u 12v 1.5n",
      [
        ["3n", "constant.numeric.number.q"],
        ["12t", "constant.numeric.number.q"],
        ["1p", "constant.numeric.number.q"],
        ["12u", "constant.numeric.number.q"],
        ["12v", "constant.numeric.number.q"],
        ["1.5n", "constant.numeric.number.q"],
      ],
    ],
    [
      "booleans",
      "1b 0101b",
      [
        ["1b", "constant.numeric.boolean.q"],
        ["0101b", "constant.numeric.boolean.q"],
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
        ["0N", "constant.numeric.null.q"],
        ["0n", "constant.numeric.null.q"],
        ["0w", "constant.numeric.infinity.q"],
        ["0W", "constant.numeric.infinity.q"],
        ["0Nd", "constant.numeric.null.q"],
        ["0Np", "constant.numeric.null.q"],
      ],
    ],
    [
      "typed and negative nulls and infinities",
      "0Ni 0Nc 0Ng 0Wj -0Wf -0w",
      [
        ["0Ni", "constant.numeric.null.q"],
        ["0Nc", "constant.numeric.null.q"],
        ["0Ng", "constant.numeric.null.q"],
        ["0Wj", "constant.numeric.infinity.q"],
        ["-0Wf", "constant.numeric.infinity.q"],
        ["-0w", "constant.numeric.infinity.q"],
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
        ["0:", "support.function.builtin.io.q"],
        ["1:", "support.function.builtin.io.q"],
        ["2:", "support.function.builtin.io.q"],
      ],
    ],
    [
      "internal functions",
      "-11!`:f;x-8!y",
      [
        ["-11!", "support.function.builtin.internal.q"],
        ["`:f", "support.class.handle.q"],
        [";", "punctuation.separator.q"],
        ["x", "source.q"],
        ["-", "keyword.operator.arithmetic.q"],
        ["8", "constant.numeric.number.q"],
        ["!", "keyword.operator.q"],
        ["y", "source.q"],
      ],
    ],

    // Casts and attributes
    [
      "casts by type name",
      "`int$x;`timestamp$y;`$z",
      [
        ["`int", "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["x", "source.q"],
        [";", "punctuation.separator.q"],
        ["`timestamp", "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ["`", "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["z", "source.q"],
      ],
    ],
    [
      "casts by type letter and number",
      '"j"$x;"J"$"42";"*"$y;7h$z',
      [
        ['"j"', "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["x", "source.q"],
        [";", "punctuation.separator.q"],
        ['"J"', "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ['"', "string.quoted.double.q"],
        ["42", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
        [";", "punctuation.separator.q"],
        ['"*"', "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ["7h", "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["z", "source.q"],
      ],
    ],
    [
      "enumerations and other $ are not casts",
      '`sym$`a;`intx$y;"a"$z',
      [
        ["`sym", "constant.language.symbol.q"],
        ["$", "keyword.operator.q"],
        ["`a", "constant.language.symbol.q"],
        [";", "punctuation.separator.q"],
        ["`intx", "constant.language.symbol.q"],
        ["$", "keyword.operator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ['"', "string.quoted.double.q"],
        ["a", "string.quoted.double.q"],
        ['"', "string.quoted.double.q"],
        ["$", "keyword.operator.q"],
        ["z", "source.q"],
      ],
    ],
    [
      "attributes",
      "`s#x;`u#y;`#z;`a#t",
      [
        ["`s", "storage.modifier.attribute.q"],
        ["#", "keyword.operator.q"],
        ["x", "source.q"],
        [";", "punctuation.separator.q"],
        ["`u", "storage.modifier.attribute.q"],
        ["#", "keyword.operator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ["`", "storage.modifier.attribute.q"],
        ["#", "keyword.operator.q"],
        ["z", "source.q"],
        [";", "punctuation.separator.q"],
        ["`a", "constant.language.symbol.q"],
        ["#", "keyword.operator.q"],
        ["t", "source.q"],
      ],
    ],
    [
      "symbol lists before # and $ are not attributes or casts",
      "`a`p#t;`a`int$x;`a`$y",
      [
        ["`a`p", "constant.language.symbol.q"],
        ["#", "keyword.operator.q"],
        ["t", "source.q"],
        [";", "punctuation.separator.q"],
        ["`a`int", "constant.language.symbol.q"],
        ["$", "keyword.operator.q"],
        ["x", "source.q"],
        [";", "punctuation.separator.q"],
        ["`a`", "constant.language.symbol.q"],
        ["$", "keyword.operator.q"],
        ["y", "source.q"],
      ],
    ],
    [
      "attribute and cast after a name or a spaced symbol",
      "x`int$y;`a `s#z",
      [
        ["x", "source.q"],
        ["`int", "support.type.cast.q"],
        ["$", "keyword.operator.q"],
        ["y", "source.q"],
        [";", "punctuation.separator.q"],
        ["`a", "constant.language.symbol.q"],
        ["`s", "storage.modifier.attribute.q"],
        ["#", "keyword.operator.q"],
        ["z", "source.q"],
      ],
    ],

    // Namespaces
    [
      "system namespaces",
      ".Q.dd .z.p .z.ts .h.ht .j.j",
      [
        [".Q.dd", "support.class.namespace.utilities.q"],
        [".z.p", "support.class.namespace.dotz.q"],
        [".z.ts", "support.class.namespace.dotz.q"],
        [".h.ht", "support.class.namespace.http.q"],
        [".j.j", "support.class.namespace.json.q"],
      ],
    ],
    [
      "q 5 namespace members",
      ".Q.sx .Q.L1 .Q.trpd .h.ka .z.A .z.M .z.m .z.v",
      [
        [".Q.sx", "support.class.namespace.utilities.q"],
        [".Q.L1", "support.class.namespace.utilities.q"],
        [".Q.trpd", "support.class.namespace.utilities.q"],
        [".h.ka", "support.class.namespace.http.q"],
        [".z.A", "support.class.namespace.dotz.q"],
        [".z.M", "support.class.namespace.dotz.q"],
        [".z.m", "support.class.namespace.dotz.q"],
        [".z.v", "support.class.namespace.dotz.q"],
      ],
    ],
    [
      "removed namespace members",
      ".Q.Cf .Q.Xf",
      [
        [".Q.Cf", "source.q"],
        [".Q.Xf", "source.q"],
      ],
    ],

    // Names and functions
    [
      "names",
      "trade x_1 .a.b",
      [
        ["trade", "source.q"],
        ["x_1", "source.q"],
        [".a.b", "source.q"],
      ],
    ],
    [
      "dotted names",
      "a.b a.b.c",
      [
        ["a.b", "source.q"],
        ["a.b.c", "source.q"],
      ],
    ],
    [
      "function names are names",
      "f:{1};.a.f: {2};h::{3}",
      [
        ["f", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["{", "source.q"],
        ["1", "constant.numeric.number.q"],
        ["}", "source.q"],
        [";", "punctuation.separator.q"],
        [".a.f", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["{", "source.q"],
        ["2", "constant.numeric.number.q"],
        ["}", "source.q"],
        [";", "punctuation.separator.q"],
        ["h", "source.q"],
        ["::", "keyword.operator.assignment.q"],
        ["{", "source.q"],
        ["3", "constant.numeric.number.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "implicit parameters",
      "{x+y*z}",
      [
        ["{", "source.q"],
        ["x", "variable.parameter.implicit.q"],
        ["+", "keyword.operator.arithmetic.q"],
        ["y", "variable.parameter.implicit.q"],
        ["*", "keyword.operator.arithmetic.q"],
        ["z", "variable.parameter.implicit.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "implicit parameters across lines and in nested functions",
      "{a:x;\n {y} each a}",
      [
        ["{", "source.q"],
        ["a", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["x", "variable.parameter.implicit.q"],
        [";", "punctuation.separator.q"],
        ["{", "source.q"],
        ["y", "variable.parameter.implicit.q"],
        ["}", "source.q"],
        ["each", "support.function.builtin.q"],
        ["a", "source.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "x y z outside a function",
      "x:1;y z",
      [
        ["x", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["y", "source.q"],
        ["z", "source.q"],
      ],
    ],
    [
      "x y z with a parameter list",
      "{[a] a+x}",
      [
        ["{", "source.q"],
        ["[", "source.q"],
        ["a", "variable.parameter.q"],
        ["]", "source.q"],
        ["a", "source.q"],
        ["+", "keyword.operator.arithmetic.q"],
        ["x", "source.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "x inside names, symbols and namespaces",
      "{xbar,a.x,`x,.z.x}",
      [
        ["{", "source.q"],
        ["xbar", "support.function.builtin.q"],
        [",", "keyword.operator.q"],
        ["a.x", "source.q"],
        [",", "keyword.operator.q"],
        ["`x", "constant.language.symbol.q"],
        [",", "keyword.operator.q"],
        [".z.x", "support.class.namespace.dotz.q"],
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
        ["a", "source.q"],
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
        [";", "punctuation.separator.q"],
        ["b.c", "variable.parameter.q"],
        ["]", "source.q"],
        ["a", "source.q"],
        ["}", "source.q"],
        ["{", "source.q"],
        ["[", "source.q"],
        ["d", "variable.parameter.q"],
        [";", "punctuation.separator.q"],
        ["e", "variable.parameter.q"],
        ["]", "source.q"],
        ["}", "source.q"],
      ],
    ],
    [
      "assignment",
      "a:1;b::2",
      [
        ["a", "source.q"],
        [":", "keyword.operator.assignment.q"],
        ["1", "constant.numeric.number.q"],
        [";", "punctuation.separator.q"],
        ["b", "source.q"],
        ["::", "keyword.operator.assignment.q"],
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
