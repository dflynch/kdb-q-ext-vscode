import * as assert from "node:assert";
import { annotate } from "../annotate";
import {
  definitions,
  entry,
  type Index,
  position,
  references,
  resolve,
  symbols,
} from "../workspaceIndex";

// Files by path, one with a | at the cursor, taken out
type Files = Record<string, string>;

function opened(files: Files) {
  const index = new Map<string, ReturnType<typeof entry>>();
  let cursor: { file: string; text: string; offset: number } | undefined;
  for (const [file, source] of Object.entries(files)) {
    const offset = source.indexOf("|");
    const text =
      offset < 0 ? source : source.slice(0, offset) + source.slice(offset + 1);
    if (offset >= 0) cursor = { file, text, offset };
    index.set(file, entry(text, annotate(text)));
  }
  assert.ok(cursor, "no |");
  const texts = Object.fromEntries(
    Object.entries(files).map(([f, s]) => [f, s.replace("|", "")]),
  );
  const a = annotate(cursor.text);
  // Each location as "file line:column text", from 1
  const shown = (l: { file: string; start: number; end: number }) => {
    const e = index.get(l.file);
    assert.ok(e);
    const p = position(e, l.start);
    return `${l.file} ${p.line + 1}:${p.character + 1} ${texts[l.file].slice(l.start, l.end)}`;
  };
  return {
    defined: () => definitions(index, cursor.file, a, cursor.offset).map(shown),
    referenced: (withDefinition = true) =>
      references(index, cursor.file, a, cursor.offset, withDefinition).map(
        shown,
      ),
  };
}

suite("definitions across files", () => {
  const cases: [string, Files, string[]][] = [
    [
      "a global in another file",
      { "/w/a.q": "f:{x+1}", "/w/b.q": "g:|f 2" },
      ["/w/a.q 1:1 f"],
    ],
    [
      "every file's, the file itself first, then the nearest",
      {
        "/w/config/wdb.q": "lim:0b",
        "/w/code/merge.q": "lim:1b",
        "/w/code/wdb.q": "lim:@[value;`lim;0b]\n|lim",
        "/w/code/x/other.q": "lim:2",
      },
      [
        "/w/code/wdb.q 1:1 lim",
        "/w/code/merge.q 1:1 lim",
        "/w/code/x/other.q 1:1 lim",
        "/w/config/wdb.q 1:1 lim",
      ],
    ],
    [
      "at top level anywhere, before any in a lambda",
      { "/w/a.q": "init:{n::0}\n|n", "/w/b.q": "n:1" },
      ["/w/b.q 1:1 n"],
    ],
    [
      "in a lambda, if no file assigns it at top level",
      { "/w/a.q": "init:{n::0}", "/w/b.q": "g:{n::1}\n|n" },
      ["/w/b.q 1:4 n", "/w/a.q 1:7 n"],
    ],
    [
      "by absolute name, under \\d",
      { "/w/u.q": "\\d .u\nupd:{x}", "/w/b.q": ".u.|upd 1" },
      ["/w/u.q 2:1 upd"],
    ],
    [
      "set by reference",
      { "/w/a.q": "`.u.t set 1", "/w/b.q": "|.u.t" },
      ["/w/a.q 1:2 .u.t"],
    ],
    ["not an amend", { "/w/a.q": ".h.tx[`a]:1", "/w/b.q": "|.h.tx" }, []],
    [
      "a local, only in its file",
      { "/w/a.q": "a:1", "/w/b.q": "f:{a:2; |a}" },
      ["/w/b.q 1:4 a"],
    ],
    [
      "a column, as the parameter it may be",
      { "/w/a.q": "n:1", "/w/b.q": "f:{[t;n] select from t where i<|n}" },
      ["/w/b.q 1:7 n"],
    ],
    [
      "a column, as the global it may be",
      { "/w/a.q": "n:1", "/w/b.q": "f:{select from t where i<|n}" },
      ["/w/a.q 1:1 n"],
    ],
    ["nothing for a global no file defines", { "/w/a.q": "|.z.p" }, []],
    [
      "an export, where its module's export has the key",
      {
        "/w/mod/foo.q": "impl:{x+1}\nexport:([f:impl;g:{x}])",
        "/w/main.q": "m:use`foo\nm.|f 1",
      },
      ["/w/mod/foo.q 1:1 impl"],
    ],
    [
      "an export of a lambda, at its key",
      {
        "/w/mod/foo.q": "impl:{x+1}\nexport:([f:impl;g:{x}])",
        "/w/main.q": "m:use`foo\nm`|g",
      },
      ["/w/mod/foo.q 2:17 g"],
    ],
    [
      "an export built as the module loads, where it's assigned",
      {
        "/w/foo/init.q": "export:`f`g!(1;2)\nexport,:([h:3])",
        "/w/main.q": "m:use`foo\nm.|h",
      },
      ["/w/foo/init.q 1:1 export"],
    ],
    [
      "nothing for a key the export doesn't have",
      {
        "/w/foo.q": "export:([f:1])",
        "/w/main.q": "m:use`foo\nm.|g",
      },
      [],
    ],
  ];
  for (const [name, files, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(opened(files).defined(), expected);
    });
  }
});

suite("references across files", () => {
  test("a global, in every file, the file itself first", () => {
    const files = {
      "/w/a.q": "n:0\nf:{n+1}",
      "/w/b.q": "g:{|n*2}\n`n set 3",
      "/w/c.q": "h:{[n] n}",
    };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/b.q 1:4 n",
      "/w/b.q 2:2 n",
      "/w/a.q 1:1 n",
      "/w/a.q 2:4 n",
    ]);
    // Without each file's definition
    assert.deepStrictEqual(opened(files).referenced(false), [
      "/w/b.q 1:4 n",
      "/w/a.q 2:4 n",
    ]);
  });

  test("a parameter, only in its lambda", () => {
    const files = { "/w/a.q": "n:0", "/w/b.q": "f:{[n] |n+1}" };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/b.q 1:5 n",
      "/w/b.q 1:8 n",
    ]);
  });

  test("an export, by any binding, and at its key", () => {
    const files = {
      "/w/foo.q": "export:([f:{x}])",
      "/w/a.q": "m:use`foo\nm.|f 1",
      "/w/b.q": "k:use`foo\nk`f\nk.g",
      "/w/c.q": "m:use`bar\nm.f",
    };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/a.q 2:1 m.f",
      "/w/b.q 2:3 f",
      "/w/foo.q 1:10 f",
    ]);
  });

  test("an export, from its key", () => {
    const files = {
      "/w/foo.q": "export:([|f:{x}])",
      "/w/a.q": "m:use`foo\nm.f 1",
    };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/foo.q 1:10 f",
      "/w/a.q 2:1 m.f",
    ]);
  });
});

suite("modules by file name", () => {
  const index: Index = new Map(
    [
      "/w/lib/foo.q",
      "/w/foo/init.q",
      "/w/foo/bar.q",
      "/w/foo/bar/init.q",
      "/w/foo/baz/init.q",
      "/w/other/foo/init.q",
      "/w/afoo.q",
    ].map((f) => [f, entry("", annotate(""))]),
  );
  const cases: [string, string, string, string[]][] = [
    [
      "a file, or a directory's init",
      "/w/main.q",
      "foo",
      ["/w/foo/init.q", "/w/lib/foo.q", "/w/other/foo/init.q"],
    ],
    [
      "a submodule, the file before the directory",
      "/w/main.q",
      "foo.bar",
      ["/w/foo/bar.q"],
    ],
    ["a submodule's init", "/w/main.q", "foo.baz", ["/w/foo/baz/init.q"]],
    [
      "relative, below an init's directory",
      "/w/foo/init.q",
      ".bar",
      ["/w/foo/bar.q"],
    ],
    ["relative, below a file as q looks", "/w/lib/foo.q", ".bar", []],
    ["nothing for an empty part", "/w/main.q", "foo..bar", []],
  ];
  for (const [name, from, module, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(resolve(index, from, module), expected);
    });
  }
});

suite("symbols", () => {
  const index: Index = new Map(
    Object.entries({
      "/w/u.q": "\\d .u\nupd:{[t;x] t}\nsub:{x}\ninit:{.u.w::()}",
      "/w/b.q": "upd:insert\nlg:{n::1}\nn:0",
    }).map(([f, text]) => [f, entry(text, annotate(text))]),
  );
  const listed = (query: string) =>
    symbols(index, query).map(
      (s) => `${s.file} ${s.kind} ${s.full}${s.detail ? ` ${s.detail}` : ""}`,
    );

  test("each file's, by absolute name, its characters in order", () => {
    assert.deepStrictEqual(listed("UPD"), [
      "/w/u.q function .u.upd [t;x]",
      "/w/b.q variable upd",
    ]);
    assert.deepStrictEqual(listed("usb"), ["/w/u.q function .u.sub [x]"]);
  });

  test("in a lambda only where the file has none at top level", () => {
    assert.deepStrictEqual(listed(".u.w"), ["/w/u.q variable .u.w"]);
    assert.deepStrictEqual(listed("n"), [
      "/w/u.q function .u.init [x]",
      "/w/b.q variable n",
    ]);
  });

  test("everything for no query", () => {
    assert.strictEqual(listed("").length, 7);
  });
});

suite("positions", () => {
  test("lines end at any line break", () => {
    const e = entry("a\r\nb\rc\nd", annotate(""));
    assert.deepStrictEqual(
      [0, 3, 5, 7, 8].map((o) => position(e, o)),
      [
        { line: 0, character: 0 },
        { line: 1, character: 0 },
        { line: 2, character: 0 },
        { line: 3, character: 0 },
        { line: 3, character: 1 },
      ],
    );
  });
});
