import * as assert from "node:assert";
import * as statements from "../statements";

suite("statements.flatten", () => {
  const cases: [string, string, string[]][] = [
    // Statements
    ["statements", "a:1\nb:2\na+b", ["a:1", "b:2", "a+b"]],
    ["semicolon-terminated statements", "a:1;\nb:2;", ["a:1;", "b:2;"]],
    [
      "continuation lines",
      "f:{[x]\n  y:x*2;\n  y+1\n  }\nf 3",
      ["f:{[x] y:x*2; y+1 }", "f 3"],
    ],
    ["tab-indented continuation line", "f:{\n\tx}", ["f:{ x}"]],
    ["indented first line", "  x+1\n  y", ["x+1 y"]],
    [
      "blank lines",
      "a:1\nb:2\na+b\n\n\nf:{[a;b]\n a+b\n    }\n\nf[10;30]\n",
      ["a:1", "b:2", "a+b", "f:{[a;b] a+b }", "f[10;30]"],
    ],
    ["CRLF line endings", "f:{\r\n  x}\r\nb:2", ["f:{ x}", "b:2"]],
    ["whitespace in strings", 's:"a  b\tc"', ['s:"a  b\tc"']],

    // Comments
    ["trailing comment", "a:1 / note", ["a:1"]],
    ["trailing comment after tab", "a:1\t/ note", ["a:1"]],
    ["comment lines", "a:1\n/ note\nf:{\n  / note\n  x}", ["a:1", "f:{ x}"]],
    ["only comments", "/ note\n  / note", []],
    ["iterator", "a:+/[1 2] / sum", ["a:+/[1 2]"]],
    ["slash after semicolon", "a:1;/b", ["a:1;/b"]],
    [
      "slashes in strings",
      's:"a /b"; u:"http://x" / note',
      ['s:"a /b"; u:"http://x"'],
    ],
    ["escapes in strings", 's:"a\\" /b\\\\" / note', ['s:"a\\" /b\\\\"']],
    ["block comment", "a:1\n/\nnote\n\\\nb:2", ["a:1", "b:2"]],
    [
      "block comment markers with trailing whitespace",
      "a:1\n/  \nnote\n\\ \nb:2",
      ["a:1", "b:2"],
    ],
    ["unterminated block comment", "a:1\n/\nnote\nb:2", ["a:1"]],
    ["end-of-file comment", "a:1\n\\\nb:2", ["a:1"]],

    // Multi-line strings
    ["multi-line string", 'a:"x\n  y"\nb:2', ['a:"x\\n  y"', "b:2"]],
    [
      "slash in a multi-line string",
      'a:"x\n  y / z" / note',
      ['a:"x\\n  y / z"'],
    ],
    [
      "block comment marker in a multi-line string",
      'a:"x\n  /\n  y"',
      ['a:"x\\n  /\\n  y"'],
    ],
    [
      "blank lines in a multi-line string",
      'a:"x\n\n  \n  y"',
      ['a:"x\\n\\n\\n  y"'],
    ],
    [
      "trailing whitespace in a multi-line string",
      'a:"x  \n  y\t\n  z"',
      ['a:"x\\n  y\\n  z"'],
    ],
    [
      "tab at column 0 in a multi-line string",
      'a:"x\n\t\ty"',
      ['a:"x\\n \ty"'],
    ],
    [
      "multi-line string in a function",
      'f:{\n  "p\n  q";\n  x}',
      ['f:{ "p\\n  q"; x}'],
    ],
    ["string ended by a new statement", 'a:"x\nb:"/"', ['a:"x', 'b:"/"']],

    // System commands
    ["system command with path", "\\l /a/b.q", ["\\l /a/b.q"]],
    [
      "system commands between statements",
      "a:1;\n\\l b.q\n\\cd /tmp\nc:2",
      ["a:1;", "\\l b.q", "\\cd /tmp", "c:2"],
    ],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(statements.flatten(input), expected);
    });
  }
});
