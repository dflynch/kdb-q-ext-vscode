import * as assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { type Annotated, annotate } from "../annotate";
import { scan } from "../scanner";

const fixtures = path.join(__dirname, "../../test/fixtures");
const read = (file: string) => readFileSync(path.join(fixtures, file));
const md5 = (data: Buffer) => createHash("md5").update(data).digest("hex");

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

suite("annotate against q's value", () => {
  const modules = ["foo/init.q", "foo/sub.q", "dyn.q"];
  const fixture: {
    scoping: string;
    script: string;
    modules: { module: string; export: string[] | string }[];
    spaces: { space: string; names: string[] }[];
    digests: string;
    cases: {
      line: string;
      scope: { params: string[]; locals: string[]; globals: string[] } | string;
    }[];
  } = JSON.parse(read("scoping.json").toString());

  test("fixture is up to date (npm run fixtures)", () => {
    assert.strictEqual(fixture.scoping, md5(read("scoping.q")));
    assert.strictEqual(fixture.script, md5(read("scope.q")));
    assert.strictEqual(
      fixture.digests,
      modules.map((m) => md5(read(`modules/${m}`))).join(""),
    );
  });

  // The outermost lambda's parameters, locals and the globals its own body
  // reads or writes, as written: q leaves out columns, keywords, handles and
  // nested lambdas' names
  for (const { line, scope } of fixture.cases) {
    test(line, () => {
      assert.ok(typeof scope !== "string", `q rejects it: ${scope}`);
      const a = annotate(line);
      const l = a.lambdas[0];
      const globals = a.names
        .filter((n) => n.lambda === l && n.role === "global")
        .map((n) => line.slice(n.token.start, n.token.end));
      assert.deepStrictEqual(
        {
          params: l.params,
          locals: sorted(l.locals),
          globals: sorted(globals),
        },
        {
          params: scope.params,
          locals: sorted(scope.locals),
          globals: sorted(scope.globals),
        },
      );
    });
  }

  const files: [string, string, string][] = [
    ["foo", "foo/init.q", ".m.foo"],
    ["foo.sub", "foo/sub.q", ".m.foo.0sub"],
    ["dyn", "dyn.q", ".m.dyn"],
  ];
  for (const [module, file, space] of files) {
    test(`module ${module}`, () => {
      const a = annotate(read(`modules/${file}`).toString(), {
        namespace: space,
      });
      const exported = fixture.modules.find((m) => m.module === module)?.export;
      assert.ok(Array.isArray(exported), `q fails to load it: ${exported}`);
      if (a.export?.keys) {
        assert.deepStrictEqual(
          sorted(a.export.keys.map((k) => k.key)),
          sorted(exported),
        );
      } else {
        assert.ok(a.export, "a module assigns export");
      }
      // Its top-level globals land in its namespace, as q puts them
      const names = fixture.spaces.find((s) => s.space === space)?.names ?? [];
      for (const n of a.names) {
        if (n.role !== "global" || !n.defines || n.lambda) continue;
        if (!n.full.startsWith(`${space}.`)) {
          assert.ok(n.full.startsWith(".") && !n.full.startsWith(".m."));
          continue;
        }
        assert.ok(names.includes(n.full.slice(space.length + 1)), n.full);
      }
    });
  }
});

// Names as "role written", with the resolved name after = when it differs,
// " :" when it defines, and a column's variable after ?
function shown(a: Annotated, text: string): string[] {
  return a.names.map((n) => {
    const written = text.slice(n.token.start, n.token.end);
    const full = n.full !== written ? `=${n.full}` : "";
    const module = n.module !== undefined ? ` from ${n.module}` : "";
    const variable = n.variable
      ? ` ?${n.variable.role} ${n.variable.full}`
      : "";
    return `${n.role} ${written}${full}${module}${n.defines ? " :" : ""}${variable}`;
  });
}
const names = (text: string, namespace?: string) =>
  shown(annotate(text, namespace ? { namespace } : {}), text);

// Handles as "written=full", " :" when it defines, and the module if any
const handles = (text: string) =>
  annotate(text).handles.map(
    (h) =>
      `${text.slice(h.start, h.end)}=${h.full}${h.defines ? " :" : ""}${h.module ? ` from ${h.module}` : ""}`,
  );

suite("annotate names", () => {
  const cases: [string, string, string[]][] = [
    [
      "parameters, locals and globals",
      "f:{[a] b:1; c::2; a+b+d}",
      [
        "global f :",
        "param a :",
        "local b :",
        "global c :",
        "param a",
        "local b",
        "global d",
      ],
    ],
    ["implicit parameters", "{x+y}", ["param x", "param y"]],
    ["assigning a parameter", "{x:1; y}", ["param x :", "param y"]],
    [
      "amending a local",
      "{a:1; a+:1; a::2}",
      ["local a :", "local a :", "local a :"],
    ],
    ["amending a global", "{a+:1; b[0]:2}", ["global a :", "global b :"]],
    ["a dotted name is global", "{e.f:1}", ["global e.f :"]],
    ["no closures", "{a:1; {a}}", ["local a :", "global a"]],
    [
      "namespaces",
      "\\d .foo\nf:1\ng:{f+.bar.h}\n\\d .\nk:2",
      [
        "global f=.foo.f :",
        "global g=.foo.g :",
        "global f=.foo.f",
        "global .bar.h",
        "global k :",
      ],
    ],
    ["relative dotted names", "\\d .foo\nk.m:7", ["global k.m=.foo.k.m :"]],
    [
      "system d",
      'system "d .foo"\nf:1',
      ["builtin system", "global f=.foo.f :"],
    ],
    [
      "qSQL",
      "{[t;u] select a:b by c from t where d>u}",
      [
        "param t :",
        "param u :",
        "builtin select",
        "column a : ?global a",
        "column b ?global b",
        "builtin by",
        "column c ?global c",
        "builtin from",
        "param t",
        "builtin where",
        "column d ?global d",
        "column u ?param u",
      ],
    ],
    [
      "a query nested in a clause",
      "select from t where a in exec b from u",
      [
        "builtin select",
        "builtin from",
        "global t",
        "builtin where",
        "column a ?global a",
        "builtin in",
        "builtin exec",
        "column b ?global b",
        "builtin from",
        "column u ?global u",
      ],
    ],
    [
      "a lambda in a query",
      "select {x+y} each a from t",
      [
        "builtin select",
        "param x",
        "param y",
        "builtin each",
        "column a ?global a",
        "builtin from",
        "global t",
      ],
    ],
    [
      "literals",
      "([] a:1 2; b:c); ([k:1] v:2); ([d:e])",
      [
        "column a :",
        "column b :",
        "global c",
        "column k :",
        "column v :",
        "key d :",
        "global e",
      ],
    ],
    ["multiple assignment", "{(a;b):1 2}", ["local a :", "local b :"]],
    [
      "a module's exports",
      "m:use`foo\nm.f 1\n{n:use`bar; n.g}",
      [
        "global m :",
        "builtin use",
        "export m.f=f from foo",
        "local n :",
        "builtin use",
        "export n.g=g from bar",
      ],
    ],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(names(text), expected);
    });
  }

  test("a module's namespace", () => {
    assert.deepStrictEqual(names("g:1\n.abs.v:2", ".m.foo"), [
      "global g=.m.foo.g :",
      "global .abs.v :",
    ]);
  });

  test("a lambda left open", () => {
    const [l] = annotate("f:{[a] b:1").lambdas;
    assert.strictEqual(l.close, undefined);
    assert.deepStrictEqual([...l.locals], ["b"]);
  });
});

suite("annotate handles", () => {
  const cases: [string, string, string[]][] = [
    [
      "value and get",
      "value `a; get `.b.c; @[value;`d;0]",
      ["a=a", ".b.c=.b.c", "d=d"],
    ],
    ["a path", "value `.`t; get `.foo`t", [".`t=t", ".foo`t=.foo.t"]],
    [
      "a namespace and a name",
      "`. `t; `.[`u]; @[`.foo;`v]",
      ["t=t", "u=u", "v=.foo.v"],
    ],
    [
      "amend",
      "@[`.;`upd;:;f]; @[`t;0;:;1]; .[`u;();:;1]",
      ["upd=upd :", "t=t :", "u=u :"],
    ],
    ["index", "@[`t;0]; `t 0; `t[1]; `t i", ["t=t", "t=t", "t=t", "t=t"]],
    [
      "set, upsert, insert",
      "`a set 1; `t upsert x; `u insert y",
      ["a=a :", "t=t :", "u=u :"],
    ],
    ["from", "delete from `t where a", ["t=t"]],
    ["a call by name", "(`f;1)", ["f=f"]],
    [
      "a leading dot anywhere",
      ".pm.grant[`.servers.disc;`user]",
      [".servers.disc=.servers.disc"],
    ],
    [
      "plain symbols elsewhere",
      '.lg.o[`init;"done"]; `a`b!1 2; `sym xasc t',
      [],
    ],
    ["file handles", "value `:data; `:a`.b set 1", [".b=.b :"]],
    ["at top level, the file's namespace", "\\d .foo\nvalue `a", ["a=.foo.a"]],
    ["in a lambda, the root", "\\d .foo\n{value `a}", ["a=a"]],
    ["a path is absolute", "\\d .foo\nvalue `.`t", [".`t=t"]],
    [
      "a module's exports",
      "m:use`foo\nm`f; m[`g]; (use`bar)`h",
      ["f=f from foo", "g=g from foo", "h=h from bar"],
    ],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(handles(text), expected);
    });
  }
});

suite("annotate modules", () => {
  test("use", () => {
    const text = "m:use`foo; (use`.sub)`s";
    assert.deepStrictEqual(
      annotate(text).uses.map((u) => u.module),
      ["foo", ".sub"],
    );
  });

  test("a literal export", () => {
    const text = "h:{x}\nexport:([f:h; k:{x*2}; n:1])";
    const keys = annotate(text, { namespace: ".m.foo" }).export?.keys ?? [];
    assert.deepStrictEqual(
      keys.map((k) => [k.key, text.slice(k.start, k.end)]),
      [
        ["f", "f"],
        ["k", "k"],
        ["n", "n"],
      ],
    );
    assert.deepStrictEqual(keys[0].target, { full: ".m.foo.h" });
    assert.ok(keys[1].target && "lambda" in keys[1].target);
    assert.strictEqual(keys[2].target, undefined);
  });

  test("an export from a symbol list", () => {
    const keys = annotate("export:`f`g!(h;i)").export?.keys ?? [];
    assert.deepStrictEqual(
      keys.map((k) => [k.key, k.target]),
      [
        ["f", { full: "h" }],
        ["g", { full: "i" }],
      ],
    );
  });

  test("an export built as it loads", () => {
    for (const text of [
      "export:f[]",
      "export:([f:h])\nexport,:([g:i])",
      "export:enlist[`f]!enlist h",
    ]) {
      const a = annotate(text);
      assert.ok(a.export, text);
      assert.strictEqual(a.export.keys, undefined, text);
    }
  });

  test("export used, not assigned", () => {
    assert.strictEqual(annotate("export[1]").export, undefined);
  });
});

suite("annotate over the corpus", () => {
  const corpus = readFileSync(path.join(fixtures, "corpus.q"), "utf8");

  // Every name token in a statement gets exactly one name
  function check(text: string) {
    const a = annotate(text);
    const tokens = scan(text)
      .statements.flatMap((s) => s.tokens)
      .filter((t) => t.kind === "name");
    const named = a.names.map((n) => n.token.start);
    assert.deepStrictEqual(
      named,
      tokens.map((t) => t.start),
    );
  }

  test("every name gets a role", () => {
    check(corpus);
  });

  test("never throws on a half-typed file", () => {
    for (let i = 0; i < corpus.length; i += 3) check(corpus.slice(0, i));
  });
});
