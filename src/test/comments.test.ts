import * as assert from "node:assert";
import * as comments from "../comments";

suite("comments.toggleBlockComment", () => {
  const cases: [string, string, number, number, comments.BlockCommentToggle][] =
    [
      [
        "one line",
        "a:1\nb:2",
        0,
        0,
        { add: [{ start: 0, end: 0 }], remove: [] },
      ],
      [
        "several lines",
        "a:1\nb:2\nc:3",
        0,
        1,
        { add: [{ start: 0, end: 1 }], remove: [] },
      ],
      [
        "lines inside a function",
        "f:{\n  a:1;\n  b:2;\n  a}",
        2,
        2,
        { add: [{ start: 2, end: 2 }], remove: [] },
      ],
      [
        "inside a block",
        "a:1\n/\nb:2\n\\\nc:3",
        2,
        2,
        { add: [], remove: [1, 3] },
      ],
      [
        "on a marker",
        "a:1\n/\nb:2\n\\\nc:3",
        1,
        1,
        { add: [], remove: [1, 3] },
      ],
      [
        "markers with trailing whitespace",
        "/ \nb:2\n\\\t",
        1,
        1,
        { add: [], remove: [0, 2] },
      ],
      [
        "across two blocks",
        "/\na\n\\\nb\n/\nc\n\\",
        1,
        5,
        { add: [], remove: [0, 2, 4, 6] },
      ],
      [
        "inside a nested block",
        "a\n/\nb\n/\nc\n\\\nd\n\\\ne",
        4,
        4,
        { add: [], remove: [1, 7] },
      ],
      [
        "after nested blocks",
        "a\n/\nb\n/\nc\n\\\nd\n\\\ne",
        8,
        8,
        { add: [{ start: 8, end: 8 }], remove: [] },
      ],
      [
        "inside an unterminated block",
        "a:1\n/\nb:2",
        2,
        2,
        { add: [], remove: [1] },
      ],
      [
        "slash in code is not a marker",
        "a:+/[1 2]\n/ note",
        0,
        1,
        { add: [{ start: 0, end: 1 }], remove: [] },
      ],
      [
        "after a \\ ending the script",
        "a:1\n\\\nb:2",
        2,
        2,
        { add: [], remove: [] },
      ],
      [
        "a / after the end of the script is not a marker",
        "a:1\n\\\n/\nb:2",
        3,
        3,
        { add: [], remove: [] },
      ],
      [
        "up to a \\ ending the script",
        "a:1\nb:2\n\\\nc:3",
        0,
        3,
        { add: [{ start: 0, end: 1 }], remove: [] },
      ],
    ];

  for (const [name, source, start, end, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(
        comments.toggleBlockComment(source.split("\n"), [{ start, end }]),
        expected,
      );
    });
  }

  // Several ranges, as [start, end], for several selections
  const multiple: [
    string,
    string,
    [number, number][],
    comments.BlockCommentToggle,
  ][] = [
    [
      "separate lines",
      "a\nb\nc",
      [
        [2, 2],
        [0, 0],
      ],
      {
        add: [
          { start: 0, end: 0 },
          { start: 2, end: 2 },
        ],
        remove: [],
      },
    ],
    [
      "overlapping lines",
      "a\nb\nc",
      [
        [0, 1],
        [1, 2],
      ],
      { add: [{ start: 0, end: 2 }], remove: [] },
    ],
    [
      "adjacent lines",
      "a\nb\nc",
      [
        [0, 0],
        [1, 1],
      ],
      { add: [{ start: 0, end: 1 }], remove: [] },
    ],
    [
      "the same block",
      "/\na\nb\n\\",
      [
        [1, 1],
        [2, 2],
      ],
      { add: [], remove: [0, 3] },
    ],
    [
      "inside and outside a block",
      "a\n/\nb\n\\",
      [
        [0, 0],
        [2, 2],
      ],
      { add: [{ start: 0, end: 0 }], remove: [1, 3] },
    ],
  ];

  for (const [name, source, ranges, expected] of multiple) {
    test(name, () => {
      assert.deepStrictEqual(
        comments.toggleBlockComment(
          source.split("\n"),
          ranges.map(([start, end]) => ({ start, end })),
        ),
        expected,
      );
    });
  }
});
