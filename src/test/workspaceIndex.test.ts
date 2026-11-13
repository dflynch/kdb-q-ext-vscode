import * as assert from "node:assert";
import { annotate } from "../annotate";
import { occurrences } from "../navigation";
import {
  definitions,
  entry,
  hover,
  type Index,
  loaded,
  position,
  references,
  resolve,
  signatures,
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
    // q's entry's syntax, then each definition as "file line:column
    // signature doc"
    hovered: () => {
      const h = hover(index, cursor.file, a, cursor.offset);
      return (
        h && [
          ...(h.builtin ? [h.builtin.syntax] : []),
          ...h.defined.map(
            (d) =>
              `${shown({ file: d.file, ...d.nameSpan })}` +
              `${d.detail ?? ""} ${d.doc ?? "-"}`,
          ),
        ]
      );
    },
    // Each signature, its active parameter in «», then where it's from
    signed: () => {
      const found = signatures(index, cursor.file, a, cursor.offset);
      return found?.signatures.map((s) => {
        const p = s.params[found.active];
        const label = p
          ? `${s.label.slice(0, p[0])}«${s.label.slice(...p)}»${s.label.slice(p[1])}`
          : s.label;
        return "builtin" in s
          ? label
          : `${label} ${shown({ file: s.defined.file, ...s.defined.nameSpan })} ${s.defined.doc ?? "-"}`;
      });
    },
    // Each with whether it's passed by reference
    referencedAll: (withDefinition = true) =>
      references(index, cursor.file, a, cursor.offset, withDefinition).map(
        (r) => [shown(r), r.passed] as const,
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
      "each file's every definition, the latest first",
      {
        "/w/a.q": "f:1\nf:2",
        "/w/c/d.q": "f:3\n`f set 4",
        "/w/c/e.q": "|f",
      },
      ["/w/c/d.q 2:2 f", "/w/c/d.q 1:1 f", "/w/a.q 2:1 f", "/w/a.q 1:1 f"],
    ],
    [
      "its own directory before one only named like it, or a subdirectory",
      {
        "/w/code-old/f.q": "f:1",
        "/w/code/a/f.q": "f:2",
        "/w/code/f.q": "f:3",
        "/w/code/x.q": "|f",
      },
      ["/w/code/f.q 1:1 f", "/w/code/a/f.q 1:1 f", "/w/code-old/f.q 1:1 f"],
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
      "an export named alone, as ([f;g]) is ([f:f;g:g]), where it's defined",
      {
        "/w/mod/foo.q": "f:{x+1}\ng:2\nexport:([f;g])",
        "/w/main.q": "m:use`foo\nm.|g",
      },
      ["/w/mod/foo.q 2:1 g"],
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

suite("every definition", () => {
  // Each way to define f as a value, the column its name is at, and
  // whether it's in a lambda
  const forms: [string, (v: string) => string, number, boolean][] = [
    ["a name", (v) => `f:${v}`, 1, false],
    ["a handle", (v) => `\`f set ${v}`, 2, false],
    ["set[`f;…]", (v) => `set[\`f;${v}]`, 6, false],
    ["f:g:", (v) => `f:g:${v}`, 1, false],
    ["in a lambda", (v) => `h:{f::${v}}`, 4, true],
    ["by a handle in a lambda", (v) => `h:{\`f set ${v}}`, 5, true],
  ];
  // Each case's lines, n for the form's nth definition, else as written,
  // then the lines defining f, the latest first, for a form at top level
  // and for one in a lambda, as an assignment at top level comes before
  // any in one
  const cases: [string, (number | string)[], number[], number[]][] = [
    ["once", [1], [1], [1]],
    ["twice, a comment above the latest", [1, "/ again", 2], [3, 1], [3, 1]],
    ["a variable assigned between", [1, "f:1", 2], [3, 2, 1], [2]],
    ["an amend between", [1, "f[`k]:1", 2], [3, 1], [3, 1]],
    ["an append between", [1, "f,:1", 2], [3, 1], [3, 1]],
    ["an upsert between", [1, "`f upsert 1", 2], [3, 1], [3, 1]],
    ["an insert between", [1, "insert[`f;1]", 2], [3, 1], [3, 1]],
    ["an amend at the path ()", [1, "@[`f;();,;1]", 2], [3, 1], [3, 1]],
  ];
  // Where the definitions are written, the file, and the use at the cursor
  const places: [string, string, (defs: string) => Files][] = [
    ["in the file", "/w/a.q", (d) => ({ "/w/a.q": `${d}\n|f[]` })],
    ["in another file", "/w/a.q", (d) => ({ "/w/a.q": d, "/w/b.q": "|f[]" })],
    [
      "an export",
      "/w/m.q",
      (d) => ({
        "/w/m.q": `${d}\nexport:([f:f])`,
        "/w/b.q": "s:use`m\ns.|f[]",
      }),
    ],
  ];
  // q's line breaks; a lone \r isn't one (see the scanner's tests)
  const endings = { LF: "\n", CRLF: "\r\n" };
  for (const [place, at, written] of places) {
    for (const [form, define, column, inLambda] of forms) {
      for (const [name, lines, top, inner] of cases) {
        test(`${place}, ${form}, ${name}`, () => {
          const text = lines
            .map((l) => (typeof l === "number" ? define(`{[a${l}] a${l}}`) : l))
            .join("\n");
          const latest = inLambda ? inner : top;
          const where = (n: number) =>
            `${at} ${n}:${typeof lines[n - 1] === "number" ? column : 1} f`;
          // The hover's: each one's signature, and the comment above it if
          // it starts its line
          const hovered = latest.map((n) => {
            const l = lines[n - 1];
            const above = lines[n - 2];
            const doc =
              typeof l === "number" &&
              !inLambda &&
              typeof above === "string" &&
              above.startsWith("/")
                ? above
                : "-";
            return `${where(n)}${typeof l === "number" ? `[a${l}]` : ""} ${doc}`;
          });
          for (const [ending, eol] of Object.entries(endings)) {
            const files = Object.fromEntries(
              Object.entries(written(text)).map(([f, t]) => [
                f,
                t.replaceAll("\n", eol),
              ]),
            );
            const o = opened(files);
            assert.deepStrictEqual(o.defined(), latest.map(where), ending);
            assert.deepStrictEqual(o.hovered(), hovered, ending);
            if (place === "an export") continue;
            // Find All References, without any of them unless asked
            const without = o.referenced(false);
            const all = o.referenced();
            for (const n of latest) {
              assert.ok(!without.includes(where(n)), ending);
              assert.ok(all.includes(where(n)), ending);
            }
          }
        });
      }
    }
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

  test("a global, and the columns that may be it, in every file", () => {
    const files = {
      "/w/a.q": "|a:1",
      "/w/b.q": "f:{select from t where a>0}",
    };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/a.q 1:1 a",
      "/w/b.q 1:24 a",
    ]);
  });

  test("each passed by reference or not", () => {
    const files = {
      "/w/u.q": "\\d .u\nw:()\n\\d .",
      "/w/a.q":
        ".u.|w,:1\n`.u.w set ()\nn:@[value;`.u.w;()]\nf:{select from t where .u.w}",
      "/w/foo.q": "export:([w:1])",
      "/w/b.q": "m:use`foo\nm`w",
    };
    assert.deepStrictEqual(
      opened(files)
        .referencedAll()
        .map(([s, passed]) => `${s}${passed ? " passed" : ""}`),
      [
        "/w/a.q 1:1 .u.w",
        "/w/a.q 2:2 .u.w passed",
        "/w/a.q 3:12 .u.w passed",
        "/w/a.q 4:24 .u.w",
        "/w/u.q 2:1 w",
      ],
    );
    // An export's key, named by a symbol, isn't a global
    const exported = {
      "/w/foo.q": "export:([w:1])",
      "/w/b.q": "m:use`foo\nm`|w",
    };
    assert.deepStrictEqual(
      opened(exported)
        .referencedAll()
        .map(([, passed]) => passed),
      [false, false],
    );
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

  test("an export, without its key unless asked", () => {
    const files = {
      "/w/foo.q": "h:{x}\nk:{y}\nexport:`f`g!(h;k)",
      "/w/a.q": "m:use`foo\nm.|g 1",
    };
    assert.deepStrictEqual(opened(files).referenced(false), ["/w/a.q 2:1 m.g"]);
  });

  test("an export, from just after a key, not the next one", () => {
    const files = {
      "/w/foo.q": "h:{x}\nk:{y}\nexport:`f|`g!(h;k)",
      "/w/a.q": "m:use`foo\nm.f 1\nm.g 2",
    };
    assert.deepStrictEqual(opened(files).referenced(), [
      "/w/foo.q 3:9 f",
      "/w/a.q 2:1 m.f",
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

suite("hover", () => {
  const cases: [string, Files, string[] | undefined][] = [
    ["a keyword", { "/w/a.q": "|count 1 2" }, ["count x     count[x]"]],
    [
      "a global, each file's, the nearest first",
      {
        "/w/a.q": "/ adds one\nf:{x+1}",
        "/w/b/c.q": "f:{[a] a}",
        "/w/b/d.q": "g:|f 2",
      },
      ["/w/b/c.q 1:1 f[a] -", "/w/a.q 2:1 f[x] / adds one"],
    ],
    [
      "a global defined again in its file: each, the latest first",
      {
        "/w/a.q": "f:{[a;b] a+b}\n\n/ Subtract d from c\nf:{[c;d] c-d}\n\n|f[]",
      },
      ["/w/a.q 4:1 f[c;d] / Subtract d from c", "/w/a.q 1:1 f[a;b] -"],
    ],
    [
      "a callback q has, and the file's definition",
      { "/w/a.q": "/ logs\n|.z.pg:{value x}" },
      [".z.pg:f", "/w/a.q 2:1 .z.pg[x] / logs"],
    ],
    [
      "an export, as its module defines it",
      {
        "/w/m.q": "/ middle\nmid:{x}\nexport:([mid:mid])",
        "/w/a.q": "s:use`m\ns.|mid 1",
      },
      ["/w/m.q 2:1 mid[x] / middle"],
    ],
    [
      "an export its module sets by handle",
      {
        "/w/m.q": "/ middle\n`mid set {x}\nexport:([mid:mid])",
        "/w/a.q": "s:use`m\ns.|mid 1",
      },
      ["/w/m.q 2:2 mid[x] / middle"],
    ],
    [
      "an export, first as Go to Definition lists it",
      {
        "/w/x/m.q": "mid:{x}\nexport:.z.m",
        "/w/y/m.q": "/ y\nmid:{x}\nexport:([mid:mid])",
        "/w/a.q": "s:use`m\ns.|mid 1",
      },
      ["/w/x/m.q 2:1 export -", "/w/y/m.q 2:1 mid[x] / y"],
    ],
    [
      "an export written out in its module's export, a lambda",
      { "/w/m.q": "export:([mid:{x}])", "/w/a.q": "s:use`m\ns.|mid 1" },
      ["/w/m.q 1:10 mid[x] -"],
    ],
    [
      "an export written out as a lambda with typed parameters",
      {
        "/w/m.q": "export:([mid:{[a:`j;b] a}])",
        "/w/a.q": "s:use`m\ns.|mid 1",
      },
      ["/w/m.q 1:10 mid[a:`j;b] -"],
    ],
    [
      "a global with typed parameters",
      { "/w/a.q": "f:{[a:`j;(b;c)] a}\n|f 1" },
      ["/w/a.q 1:1 f[a:`j;(b;c)] -"],
    ],
    ["a name in .Q", { "/w/a.q": "|.Q.s 1" }, [".Q.s x"]],
    ["a name in .h", { "/w/a.q": "|.h.ht 1" }, [".h.ht x"]],
    ["a name in .j", { "/w/a.q": "|.j.j 1" }, [".j.j x"]],
    ["a glyph", { "/w/a.q": "1|+2" }, undefined],
    ["a glyph just after a global", { "/w/a.q": "f:{x}\nf|+1" }, undefined],
    ["a glyph just after a keyword", { "/w/a.q": "count|+1" }, undefined],
    [
      "a name's last character",
      { "/w/a.q": "coun|t 1" },
      ["count x     count[x]"],
    ],
    ["a dictionary's key", { "/w/a.q": "([|k:1])" }, undefined],
    ["a global defined nowhere", { "/w/a.q": "|g 1" }, undefined],
    [
      "a global named as qSQL's by, defined nowhere",
      { "/w/a.q": "(1;|by)" },
      undefined,
    ],
    [
      "a global named as qSQL's by",
      { "/w/a.q": "by:3\n|by+1" },
      ["/w/a.q 1:1 by -"],
    ],
    ["a local", { "/w/a.q": "f:{a:1;|a}" }, undefined],
    [
      "a column, as the global it may be",
      { "/w/a.q": "a:1\nselect |a from t" },
      ["/w/a.q 1:1 a -"],
    ],
    [
      "a function in a query",
      { "/w/a.q": "/ scales\nf:{[a] 2*a}\nupdate c:|f[a] from t" },
      ["/w/a.q 2:1 f[a] / scales"],
    ],
    ["a column defined nowhere", { "/w/a.q": "select |a from t" }, undefined],
    ["a column assigned", { "/w/a.q": "c:1\nselect |c:1 from t" }, undefined],
    [
      "a column, as the parameter it may be",
      { "/w/a.q": "a:1\nf:{[a] select |a from t}" },
      undefined,
    ],
    [
      "a name in .z in a query",
      { "/w/a.q": "select from t where d=|.z.p" },
      [".z.p"],
    ],
    [
      "a name in .Q in a query",
      { "/w/a.q": "update s:|.Q.s c from t" },
      [".Q.s x"],
    ],
  ];
  for (const [name, files, expected] of cases) {
    test(name, () => assert.deepStrictEqual(opened(files).hovered(), expected));
  }
});

suite("signatures", () => {
  const cases: [string, Files, string[] | undefined][] = [
    [
      "a global's, the nearest first",
      {
        "/w/a.q": "/ adds\nf:{[a;b] a+b}",
        "/w/b/c.q": "f:{x}",
        "/w/b/d.q": "f[1;|]",
      },
      ["f[x] /w/b/c.q 1:1 f -", "f[a;«b»] /w/a.q 2:1 f / adds"],
    ],
    [
      "a global defined again in its file: each, the latest first",
      { "/w/a.q": "f:{[a;b] a+b}\n\nf:{[c;d] c-d}\n\nf[|]" },
      ["f[«c»;d] /w/a.q 3:1 f -", "f[«a»;b] /w/a.q 1:1 f -"],
    ],
    [
      "defined again, as a variable between",
      { "/w/a.q": "/ one\nf:{[a] a}\nf:1\nf:{[b] b}\nf[|]" },
      ["f[«b»] /w/a.q 4:1 f -", "f[«a»] /w/a.q 2:1 f / one"],
    ],
    [
      "defined again in several files, the nearest file first",
      {
        "/w/a.q": "f:{[a] a}\nf:{[b] b}",
        "/w/c/d.q": "f:{[c] c}\nf:{[d] d}",
        "/w/c/e.q": "f[|]",
      },
      [
        "f[«d»] /w/c/d.q 2:1 f -",
        "f[«c»] /w/c/d.q 1:1 f -",
        "f[«b»] /w/a.q 2:1 f -",
        "f[«a»] /w/a.q 1:1 f -",
      ],
    ],
    [
      "defined at top level: not as well in a lambda",
      { "/w/a.q": "f:{[a] a}\ng:{f::{[b] b}}\nf[|]" },
      ["f[«a»] /w/a.q 1:1 f -"],
    ],
    [
      "defined only in lambdas: each",
      { "/w/a.q": "g:{f::{[a] a}}\nh:{f::{[b] b}}\nf[|]" },
      ["f[«b»] /w/a.q 2:4 f -", "f[«a»] /w/a.q 1:4 f -"],
    ],
    [
      "parameters as written",
      { "/w/a.q": ".foo.f:{[a:`j;(b;c)] a}\n.foo.f[1;|]" },
      [".foo.f[a:`j;«(b;c)»] /w/a.q 1:1 .foo.f -"],
    ],
    [
      "a parameter written twice",
      { "/w/a.q": "f:{[a;a] a}\nf[1;|]" },
      ["f[a;«a»] /w/a.q 1:1 f -"],
    ],
    [
      "an empty parameter",
      { "/w/a.q": "f:{[;b] b}\nf[|]" },
      ["f[«»;b] /w/a.q 1:1 f -"],
    ],
    [
      "past the last parameter",
      { "/w/a.q": "f:{[a;b] a}\nf[1;2;|]" },
      ["f[a;b] /w/a.q 1:1 f -"],
    ],
    [
      "a global in a namespace by \\d",
      { "/w/a.q": "\\d .u\nupd:{[t;x] t}\n\\d .\n.u.upd[|]" },
      [".u.upd[«t»;x] /w/a.q 2:1 upd -"],
    ],
    [
      "an export",
      {
        "/w/m.q": "/ middle\nmid:{[a;b] a}\nexport:([mid:mid])",
        "/w/a.q": "s:use`m\ns.mid[1;|]",
      },
      ["mid[a;«b»] /w/m.q 2:1 mid / middle"],
    ],
    [
      "an export written out, beside a global of its name",
      {
        "/w/m.q": "mid:{[z] z}\nexport:([mid:{[a;b] a}])",
        "/w/a.q": "s:use`m\ns.mid[|]",
      },
      ["mid[«a»;b] /w/m.q 2:10 mid -"],
    ],
    [
      "an export written out in its module's export",
      {
        "/w/m.q": "export:([mid:{[a;b] a}])",
        "/w/a.q": "s:use`m\ns.mid[|]",
      },
      ["mid[«a»;b] /w/m.q 1:10 mid -"],
    ],
    ["a keyword", { "/w/a.q": "ssr[s;|]" }, ["ssr[x;«y»;z]"]],
    [
      "a keyword with a space",
      { "/w/a.q": "aj [`s;|]" },
      ["aj  [c; «t1»; t2]"],
    ],
    [
      "a keyword's forms",
      { "/w/a.q": "set[|" },
      [
        "set[«nam»;y]",
        "set[«file»;y]",
        "set[«dir»;t]",
        "set[«(file;lbs;alg;lvl)»;y]",
        "set[«(dir;lbs;alg;lvl)»;t]",
        "set[«(dir;dic)»;t]",
      ],
    ],
    [
      "a form KX writes in prefix notation",
      { "/w/a.q": ".Q.s1[|]" },
      [".Q.s1[«x»]"],
    ],
    [
      "forms in prefix notation",
      { "/w/a.q": "hopen[|]" },
      [
        "hopen[«filehandle»]",
        "hopen[«processhandle»]",
        "hopen[«(communicationhandle;timeout)»]",
        "hopen[«port»]",
      ],
    ],
    [
      "a callback q has, and the file's definition",
      { "/w/a.q": "/ logs\n.z.pg:{[q] value q}\n.z.pg[|]" },
      [".z.pg[«q»] /w/a.q 2:1 .z.pg / logs"],
    ],
    [
      "a name in .Q the file defines too",
      { "/w/a.q": ".Q.s1:{[a;b] a}\n.Q.s1[|]" },
      [".Q.s1[«x»]", ".Q.s1[«a»;b] /w/a.q 1:1 .Q.s1 -"],
    ],
    [
      "a function in a query",
      { "/w/a.q": "f:{[a] 2*a}\nupdate c:f[|a] from t" },
      ["f[«a»] /w/a.q 1:1 f -"],
    ],
    [
      "an index in a call's arguments: the call's",
      { "/w/a.q": "f:{[a;b] a}\nf[a; t[`c|]]" },
      ["f[a;«b»] /w/a.q 1:1 f -"],
    ],
    [
      "a variable indexed: the call's",
      { "/w/a.q": "f:{[a;b] a}\nd:1 2\nf[a; d[|]]" },
      ["f[a;«b»] /w/a.q 1:1 f -"],
    ],
    [
      "a local: the call's",
      { "/w/a.q": "f:{[a;b] a}\ng:{loc:{x};f[a; loc[|]]}" },
      ["f[a;«b»] /w/a.q 1:1 f -"],
    ],
    [
      "a function in a call's arguments: its own",
      { "/w/a.q": "f:{[a;b] a}\ng:{[c] c}\nf[a; g[|]]" },
      ["g[«c»] /w/a.q 2:1 g -"],
    ],
    [
      "a keyword in a call's arguments",
      { "/w/a.q": "f:{[a;b] a}\nf[a; count[|]]" },
      ["count[«x»]"],
    ],
    ["a variable alone", { "/w/a.q": "d:1 2\nd[|]" }, undefined],
    ["a global defined nowhere", { "/w/a.q": "g[|]" }, undefined],
    ["a value q has", { "/w/a.q": ".z.p[|]" }, undefined],
    ["a glyph applied", { "/w/a.q": "f:{x}\n$[f;|]" }, undefined],
    ["qSQL", { "/w/a.q": "select[|2] from t" }, undefined],
    ["infix", { "/w/a.q": "x bin |" }, undefined],
    ["prefix", { "/w/a.q": "f:{x}\nf |" }, undefined],
    ["outside the brackets", { "/w/a.q": "f:{x}\nf[1]|" }, undefined],
  ];
  // q's line breaks; a lone \r isn't one (see the scanner's tests)
  const endings = { LF: "\n", CRLF: "\r\n" };
  for (const [name, files, expected] of cases) {
    test(name, () => {
      for (const [ending, eol] of Object.entries(endings)) {
        const at = Object.fromEntries(
          Object.entries(files).map(([f, t]) => [f, t.replaceAll("\n", eol)]),
        );
        assert.deepStrictEqual(opened(at).signed(), expected, ending);
      }
    });
  }
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

// Each file's text, written with \n, with the given line ending
const ended = (files: Files, eol: string): Files =>
  Object.fromEntries(
    Object.entries(files).map(([f, t]) => [f, t.replaceAll("\n", eol)]),
  );
const endings = { LF: "\n", CRLF: "\r\n" };
// Where each definition the hover shows is, without its signature or doc
const where = (hovered: string[] | undefined) =>
  hovered?.map((h) => h.split(/\[| /).slice(0, 3).join(" "));

suite("highlights of a global's reads by a dot and by a key", () => {
  // s`f and s[`f] together, s.f apart, as q reads them alike only through
  // a module, not a dictionary or a view (q 5.0), however s is bound: each
  // form at the cursor, each binding, each line ending
  const reads = ["s.f 1", "s`f", "s[`f]"];
  const bindings = [
    "s:use`m\n",
    "s::use`m\n",
    "init:{s::use`m}\n",
    "s:`f!1\n",
    "",
  ];
  for (const bound of bindings) {
    for (let n = 0; n < reads.length; n++) {
      for (const [ending, eol] of Object.entries(endings)) {
        test(`${reads[n]}, ${bound.trim() || "bound elsewhere"} (${ending})`, () => {
          const lines = reads.map((r, i) => `x${i}:${r}`);
          const text = (bound + lines.join("\n")).replaceAll("\n", eol);
          const line = (i: number) => text.indexOf(`x${i}:`) + 3;
          const at = line(n) + (n === 0 ? 2 : n === 1 ? 2 : 3);
          const found = occurrences(annotate(text), at).map((o) =>
            text.slice(o.start, o.end),
          );
          assert.deepStrictEqual(found, n ? ["f", "f"] : ["s.f"], ending);
        });
      }
    }
  }
});

suite("a module bound in another file", () => {
  const mod = { "/w/lib/mod.q": "impl:{x}\nexport:([f:impl])" };
  const other = { "/w/lib/other.q": "g:{y}\nexport:([f:g])" };
  const impl = "/w/lib/mod.q 1:1 impl";
  const g = "/w/lib/other.q 1:1 g";
  // Each way to bind s, and the namespace a read of it is in
  const forms: [string, (m: string) => string, string][] = [
    ["at top level", (m) => `s:use\`${m}`, ""],
    ["in a lambda", (m) => `init:{s::use\`${m}}`, ""],
    ["under \\d", (m) => `\\d .ns\ns:use\`${m}`, "\\d .ns\n"],
  ];
  // Each way to read s's export f, with the cursor, and what's at it
  const reads: [string, string, string][] = [
    ["s.f", "s.|f 1", "1 s.f"],
    ["s`f", "s`|f", "3 f"],
    ["s[`f]", "s[`|f]", "4 f"],
  ];
  // Each case's files, given the form, with b.q's last line the read, and
  // where f is defined
  const own = "export:([z:1])\n";
  const cases: [
    string,
    (bind: (m: string) => string, ns: string) => Files,
    (form: string, reading: string) => string[],
  ][] = [
    [
      "bound only in another file",
      (bind, ns) => ({ "/w/a.q": bind("mod"), "/w/b.q": `${ns}READ` }),
      () => [impl],
    ],
    [
      "bound in the file too, the file's",
      (bind) => ({
        "/w/a.q": bind("mod"),
        "/w/b.q": `${bind("other")}\nREAD`,
      }),
      () => [g],
    ],
    [
      "defined in the file as something else, none",
      (bind, ns) => ({ "/w/a.q": bind("mod"), "/w/b.q": `${ns}s:1\nREAD` }),
      () => [],
    ],
    [
      "bound in two other files, the nearest first",
      (bind, ns) => ({
        "/w/x/c.q": bind("other"),
        "/w/a.q": bind("mod"),
        "/w/b.q": `${ns}READ`,
      }),
      () => [impl, g],
    ],
    [
      "bound in a module's own namespace, none; after \\d, as any global",
      (bind, ns) => ({ "/w/a.q": own + bind("mod"), "/w/b.q": `${ns}READ` }),
      (form) => (form === "under \\d" ? [impl] : []),
    ],
    [
      "read in a module's own namespace, none; after \\d, as any global",
      (bind, ns) => ({ "/w/a.q": bind("mod"), "/w/b.q": `${own}${ns}READ` }),
      (form) => (form === "under \\d" ? [impl] : []),
    ],
    [
      "read after \\d . in a module binding its own, the root's",
      (bind, ns) => ({
        "/w/a.q": bind("mod"),
        "/w/b.q": `s:use\`other\n${own}\\d .\n${ns}READ`,
      }),
      () => [impl],
    ],
    [
      "a view at top level in another file, a key only, as q 5.0 reads it",
      (_, ns) => ({ "/w/a.q": `${ns}s::use\`mod`, "/w/b.q": `${ns}READ` }),
      (_, reading) => (reading === "s.f" ? [] : [impl]),
    ],
    [
      "a view at top level in the file too, the file's, a key only",
      (bind, ns) => ({
        "/w/a.q": bind("mod"),
        "/w/b.q": `${ns}s::use\`other\nREAD`,
      }),
      (_, reading) => (reading === "s.f" ? [] : [g]),
    ],
  ];
  for (const [reading, cursor, shown] of reads) {
    for (const [form, bind, ns] of forms) {
      for (const [name, files, expected] of cases) {
        test(`${reading}, ${form}, ${name}`, () => {
          const written: Files = Object.fromEntries(
            Object.entries({ ...mod, ...other, ...files(bind, ns) }).map(
              ([f, t]) => [f, t.replace("READ", cursor)],
            ),
          );
          const read = written["/w/b.q"].split("\n").length;
          for (const [ending, eol] of Object.entries(endings)) {
            const o = opened(ended(written, eol));
            const found = expected(form, reading);
            assert.deepStrictEqual(o.defined(), found, ending);
            assert.deepStrictEqual(
              where(o.hovered()),
              found.length ? found : undefined,
              ending,
            );
            // Find All References: from the read, mod's key, and from mod's
            // key, the read, as the read reaches mod
            const at = `/w/b.q ${read}:${shown}`;
            const reaches = found.includes(impl);
            const key = "/w/lib/mod.q 2:10 f";
            assert.strictEqual(o.referenced().includes(key), reaches, ending);
            // The key with its value, or alone, as ([f]) is ([f:f])
            for (const source of [
              "impl:{x}\nexport:([|f:impl])",
              "f:{x}\nexport:([|f])",
            ]) {
              const fromKey = opened(
                ended(
                  {
                    ...written,
                    "/w/b.q": written["/w/b.q"].replace("|", ""),
                    "/w/lib/mod.q": source,
                  },
                  eol,
                ),
              ).referenced();
              assert.strictEqual(fromKey.includes(at), reaches, source);
            }
          }
        });
      }
    }
  }

  test("a key written alone: the global's references and the export's", () => {
    const files = {
      "/w/lib/mod.q": "f:{x}\ng:{f x}\nexport:([|f])",
      "/w/a.q": "s:use`mod\ns.f 1",
      "/w/b.q": "s.f 2",
    };
    for (const [ending, eol] of Object.entries(endings)) {
      assert.deepStrictEqual(
        opened(ended(files, eol)).referenced(),
        [
          "/w/lib/mod.q 1:1 f",
          "/w/lib/mod.q 2:4 f",
          "/w/lib/mod.q 3:10 f",
          "/w/a.q 2:1 s.f",
          "/w/b.q 1:1 s.f",
        ],
        ending,
      );
    }
  });

  test("a module not in the workspace, none", () => {
    const o = opened({ "/w/a.q": "s:use`nope", "/w/b.q": "s.|f 1" });
    assert.deepStrictEqual(o.defined(), []);
  });
});

suite("a module's own globals", () => {
  // Each way the file ends, and whether it's a module, as q finds an
  // export only in the module's own namespace, and whether its export
  // can be followed, as a dictionary written at top level
  const forms: [string, string, boolean, boolean][] = [
    ["an export", "export:([mean])", true, true],
    [
      "an export assigned in a lambda",
      "init:{export::([mean])}\ninit[]",
      true,
      false,
    ],
    ["no export", "", false, false],
    ["an export after \\d", "\\d .x\nexport:([mean])", false, false],
  ];
  const stats = (tail: string) =>
    `helper:{x}\nmean:{helper x}\n.abs.g:1\n${tail}`;
  const helper = "/w/stats.q 1:1 helper";
  const read = "/w/stats.q 2:7 helper";
  for (const [form, tail, module, followed] of forms) {
    // Where the cursor is, given the module's text, and, for a module and
    // for any other file, where the name there is defined, and its
    // references
    const places: [string, (m: string) => Files, Expected, Expected][] = [
      [
        "a module's own, from another file",
        (m) => ({ "/w/stats.q": m, "/w/a.q": "|helper 1" }),
        { defined: [], referenced: ["/w/a.q 1:1 helper"] },
        {
          defined: [helper],
          referenced: ["/w/a.q 1:1 helper", helper, read],
        },
      ],
      [
        "a module's own, in the module, beside a global of another file's",
        (m) => ({
          "/w/stats.q": m.replace("{helper", "{|helper"),
          "/w/b.q": "helper:2",
        }),
        { defined: [helper], referenced: [helper, read] },
        {
          defined: [helper, "/w/b.q 1:1 helper"],
          referenced: [helper, read, "/w/b.q 1:1 helper"],
        },
      ],
      [
        "an absolute name, from another file",
        (m) => ({ "/w/stats.q": m, "/w/a.q": "|.abs.g" }),
        {
          defined: ["/w/stats.q 3:1 .abs.g"],
          referenced: ["/w/a.q 1:1 .abs.g", "/w/stats.q 3:1 .abs.g"],
        },
        {
          defined: ["/w/stats.q 3:1 .abs.g"],
          referenced: ["/w/a.q 1:1 .abs.g", "/w/stats.q 3:1 .abs.g"],
        },
      ],
    ];
    for (const [place, files, inModule, otherwise] of places) {
      test(`${form}, ${place}`, () => {
        const want = module ? inModule : otherwise;
        for (const [ending, eol] of Object.entries(endings)) {
          const o = opened(ended(files(stats(tail)), eol));
          assert.deepStrictEqual(o.defined(), want.defined, ending);
          assert.deepStrictEqual(
            where(o.hovered()),
            want.defined.length ? want.defined : undefined,
            ending,
          );
          assert.deepStrictEqual(o.referenced(), want.referenced, ending);
        }
      });
    }

    test(`${form}, an export, through to the module`, () => {
      for (const [ending, eol] of Object.entries(endings)) {
        const o = opened(
          ended(
            { "/w/stats.q": stats(tail), "/w/a.q": "s:use`stats\ns.|mean 1" },
            eol,
          ),
        );
        assert.deepStrictEqual(
          o.defined(),
          followed ? ["/w/stats.q 2:1 mean"] : [],
          ending,
        );
      }
    });
  }

  test("after \\d . or \\d .other in a module, globals as any file's", () => {
    const files = {
      "/w/stats.q":
        'a:1\nexport:([a])\n\\d .other\nb:2\n\\d .\nc:3\nsystem "d .zz"\nd:4',
      "/w/x.q": "a+.other.b+c+|.zz.d",
    };
    assert.deepStrictEqual(opened(files).defined(), ["/w/stats.q 8:1 d"]);
    for (const [name, line] of [
      ["a", undefined],
      [".other.b", "/w/stats.q 4:1 b"],
      ["c", "/w/stats.q 6:1 c"],
    ] as const) {
      const at = files["/w/x.q"].replace("|", "").replace(name, `|${name}`);
      assert.deepStrictEqual(
        opened({ ...files, "/w/x.q": at }).defined(),
        line ? [line] : [],
        name,
      );
    }
  });
});

type Expected = { defined: string[]; referenced: string[] };

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

  test("a module's own globals too, as written in it", () => {
    const text = "helper:{x}\nexport:([helper])";
    const modules: Index = new Map([
      ["/w/stats.q", entry(text, annotate(text))],
    ]);
    assert.deepStrictEqual(
      symbols(modules, "help").map((s) => `${s.file} ${s.full}`),
      ["/w/stats.q helper"],
    );
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

suite("files a \\l may load", () => {
  // The workspace's files, each a q file; what they hold doesn't matter
  const workspace = [
    "/w/util.q",
    "/w/code/util.q",
    "/w/code/common/util.q",
    "/w/code/notcommon/util.q",
    "/w/lib/util.q",
    "/w/lib/log.q",
    "/w/main.q",
  ];
  const index: Index = new Map(
    workspace.map((f) => [f, entry("", annotate(""))]),
  );
  // The path and files for the cursor, at |, in the lines after a first
  // line, joined by the line ending
  const load = (source: string, eol: string, keys: Index = index) => {
    const text = `a:1${eol}${source.replace(/\n/g, eol)}`;
    const offset = text.indexOf("|");
    const plain = text.slice(0, offset) + text.slice(offset + 1);
    const l = loaded(keys, annotate(plain), offset);
    return l && { path: plain.slice(l.path.start, l.path.end), files: l.files };
  };
  const found = (source: string, eol: string, keys: Index = index) =>
    load(source, eol, keys)?.files ?? [];
  const all = [
    "/w/code/common/util.q",
    "/w/code/notcommon/util.q",
    "/w/code/util.q",
    "/w/lib/util.q",
    "/w/util.q",
  ];

  for (const [ending, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ]) {
    suite(ending, () => {
      // Input forms by how many files they match
      const grid: [string, string[]][] = [
        // A bare name: every file of that name, the loader too
        ["\\l util|.q", all],
        ["\\l log|.q", ["/w/lib/log.q"]],
        ["\\l nothere|.q", []],
        ["\\l main|.q", ["/w/main.q"]],
        // A nested path: whole segments only
        ["\\l common/util|.q", ["/w/code/common/util.q"]],
        ["\\l code/util|.q", ["/w/code/util.q"]],
        ["\\l mon/util|.q", []],
        ["\\l til|.q", []],
        ["\\l w/code/common/util|.q", ["/w/code/common/util.q"]],
        ["\\l lib/util|.q", ["/w/lib/util.q"]],
        ["\\l lib/log.q|", ["/w/lib/log.q"]],
        ["\\l notcommon/log|.q", []],
        // ./ and leading ../ dropped, and empty segments
        ["\\l ./util|.q", all],
        ["\\l ../lib/util|.q", ["/w/lib/util.q"]],
        ["\\l ./../../lib/util|.q", ["/w/lib/util.q"]],
        ["\\l lib/./util|.q", ["/w/lib/util.q"]],
        ["\\l lib//util|.q", ["/w/lib/util.q"]],
        // .. takes back the segment before it, and none at the start
        ["\\l lib/../util|.q", all],
        ["\\l a/b/../../util|.q", all],
        ["\\l a/../../util|.q", all],
        ["\\l code/x/../common/util|.q", ["/w/code/common/util.q"]],
        ["\\l ../code/../lib/util|.q", ["/w/lib/util.q"]],
        ["\\l /w/lib/util|.q", ["/w/lib/util.q"]],
        ["\\l ..|", []],
        ["\\l .|", []],
        // Backslashes, quotes: q reads them as part of the name
        ["\\l ..\\lib\\util|.q", []],
        ['\\l "lib/util|.q"', []],
        // Spaces, tabs and comments after it, and more than one space or a
        // tab before it
        ["\\l lib/util|.q   ", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\t", ["/w/lib/util.q"]],
        ["\\l lib/util|.q / the logger", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\t/x", ["/w/lib/util.q"]],
        ["\\l   lib/util|.q", ["/w/lib/util.q"]],
        ["\\l\tlib/util|.q", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\nb:2", ["/w/lib/util.q"]],
        // q loads nothing for more than a comment after it, as a space in it
        ["\\l lib/util|.q x", []],
        ["\\l lib/sub dir/util|.q", []],
        ["\\l util|.q;b:2", []],
        // Not a \l line
        ["\\lutil|.q", []],
        ["\\L util|.q", []],
        [" \\l util|.q", []],
        ['b:"\n\\l util|.q"', []],
        ["/\n\\l util|.q\n\\", []],
        ["\\d util|.q", []],
        // After q), a command as at column 0; after q) and a space, q, and
        // a line joined on as at column 0 (q 5.0)
        ["q)\\l lib/util|.q", ["/w/lib/util.q"]],
        ["q)q)\\l lib/util|.q", ["/w/lib/util.q"]],
        ["q)\\l lib/util|.q / c", ["/w/lib/util.q"]],
        ["q) \\l util|.q", []],
        ["q)\\l lib/util|.q\n  show 1", []],
        // q joins an indented line on, after blank lines too, and then
        // loads nothing (q 5.0)
        ["\\l lib/util|.q\n  show 1", []],
        ["\\l lib/util|.q\n  / c", []],
        ["\\l lib/util|.q\n\n  show 1", []],
        ["\\l lib/util|.q\n\n  / c", []],
        ["\\l lib/util|.q\n/ c\n  show 1", []],
        // A line of only spaces, or a comment at column 0, isn't joined on
        ["\\l lib/util|.q\n  \nb:2", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\n/ c\nb:2", ["/w/lib/util.q"]],
        // q reads the command up to its first comment, so one on the \l line
        // drops the lines joined on (q 5.0)
        ["\\l lib/util|.q /x\n  show 1", ["/w/lib/util.q"]],
        ["\\l lib/util|.q /x\n\t/ c", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\t/x\n  / c", ["/w/lib/util.q"]],
        ["\\l lib/util|.q /x\n\n  / c", ["/w/lib/util.q"]],
        ["\\l lib/util|.q /x\n  show 1\n  show 2", ["/w/lib/util.q"]],
        ["\\l lib/util|.q\n  show 1 /x", []],
        ["\\l lib/util|.q\n\t/ c", []],
        ["\\l lib/util|.q  \n  / c", []],
        ["\\l lib/util|.q x /y\n  show 1", []],
        ["\\l /w/lib/util|.q /x\n  show 1", ["/w/lib/util.q"]],
        ["\\l /w/lib/util|.q\n  show 1", []],
      ];
      for (const [source, files] of grid) {
        test(JSON.stringify(source), () => {
          assert.deepStrictEqual(found(source, eol), files);
        });
      }

      // Each place on the line, from where the path starts to where it ends
      test("only on the path", () => {
        const line = "\\l ../lib/util.q / x";
        const at = (n: number) =>
          found(`${line.slice(0, n)}|${line.slice(n)}`, eol);
        const on = [...line].map((_, n) => at(n).length > 0);
        on.push(at(line.length).length > 0);
        assert.deepStrictEqual(
          on.map((x) => (x ? "y" : "-")).join(""),
          "---yyyyyyyyyyyyyy----",
        );
      });

      test("the whole path, wherever the cursor is on it", () => {
        for (const source of [
          "\\l |../lib/util.q",
          "\\l ../lib|/util.q / x",
          "\\l ../lib/util.q|",
        ]) {
          assert.deepStrictEqual(load(source, eol), {
            path: "../lib/util.q",
            files: ["/w/lib/util.q"],
          });
        }
        assert.deepStrictEqual(load("\\l nothere|.q", eol), {
          path: "nothere.q",
          files: [],
        });
      });
    });
  }

  test("a URI's escapes, as the path is written", () => {
    const keys: Index = new Map(
      ["file:///w/a%2Bb.q", "file:///w/c%23/d.q"].map((f) => [
        f,
        entry("", annotate("")),
      ]),
    );
    assert.deepStrictEqual(found("\\l a+|b.q", "\n", keys), [
      "file:///w/a%2Bb.q",
    ]);
    assert.deepStrictEqual(found("\\l c#/|d.q", "\n", keys), [
      "file:///w/c%23/d.q",
    ]);
  });
});
