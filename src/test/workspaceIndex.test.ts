import * as assert from "node:assert";
import { annotate } from "../annotate";
import {
  definitions,
  entry,
  hover,
  type Index,
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
  const endings = { LF: "\n", CRLF: "\r\n", CR: "\r" };
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
