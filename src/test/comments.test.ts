import * as assert from "node:assert";
import * as comments from "../comments";

suite("comments.toggleBlockComment", () => {
  const cases: [string, string, number, number, comments.BlockCommentToggle][] =
    [
      ["one line", "a:1\nb:2", 0, 0, { kind: "add", start: 0, end: 0 }],
      [
        "several lines",
        "a:1\nb:2\nc:3",
        0,
        1,
        { kind: "add", start: 0, end: 1 },
      ],
      [
        "lines inside a function",
        "f:{\n  a:1;\n  b:2;\n  a}",
        2,
        2,
        { kind: "add", start: 2, end: 2 },
      ],
      [
        "inside a block",
        "a:1\n/\nb:2\n\\\nc:3",
        2,
        2,
        { kind: "remove", lines: [1, 3] },
      ],
      [
        "on a marker",
        "a:1\n/\nb:2\n\\\nc:3",
        1,
        1,
        { kind: "remove", lines: [1, 3] },
      ],
      [
        "markers with trailing whitespace",
        "/ \nb:2\n\\\t",
        1,
        1,
        { kind: "remove", lines: [0, 2] },
      ],
      [
        "across two blocks",
        "/\na\n\\\nb\n/\nc\n\\",
        1,
        5,
        { kind: "remove", lines: [0, 2, 4, 6] },
      ],
      [
        "inside a nested block",
        "a\n/\nb\n/\nc\n\\\nd\n\\\ne",
        4,
        4,
        { kind: "remove", lines: [1, 7] },
      ],
      [
        "after nested blocks",
        "a\n/\nb\n/\nc\n\\\nd\n\\\ne",
        8,
        8,
        { kind: "add", start: 8, end: 8 },
      ],
      [
        "inside an unterminated block",
        "a:1\n/\nb:2",
        2,
        2,
        { kind: "remove", lines: [1] },
      ],
      [
        "slash in code is not a marker",
        "a:+/[1 2]\n/ note",
        0,
        1,
        { kind: "add", start: 0, end: 1 },
      ],
      ["after a \\ ending the script", "a:1\n\\\nb:2", 2, 2, { kind: "none" }],
      [
        "a / after the end of the script is not a marker",
        "a:1\n\\\n/\nb:2",
        3,
        3,
        { kind: "none" },
      ],
      [
        "up to a \\ ending the script",
        "a:1\nb:2\n\\\nc:3",
        0,
        3,
        { kind: "add", start: 0, end: 1 },
      ],
    ];

  for (const [name, source, start, end, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(
        comments.toggleBlockComment(source.split("\n"), start, end),
        expected,
      );
    });
  }
});
