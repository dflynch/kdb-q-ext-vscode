import * as assert from "node:assert";
import { annotate } from "../annotate";
import { type Completion, completions } from "../completion";
import { entry } from "../workspaceIndex";

// Files by path, written with \n, one with a | at the cursor, taken out:
// what's offered there, by label; the text typed up to the cursor, which
// inserting replaces; and the whole name, which replacing does
function complete(files: Record<string, string>, newline: string) {
  const index = new Map<string, ReturnType<typeof entry>>();
  let cursor: { file: string; text: string; offset: number } | undefined;
  for (const [file, written] of Object.entries(files)) {
    const source = written.replaceAll("\n", newline);
    const offset = source.indexOf("|");
    const text =
      offset < 0 ? source : source.slice(0, offset) + source.slice(offset + 1);
    if (offset >= 0) cursor = { file, text, offset };
    index.set(file, entry(text, annotate(text)));
  }
  assert.ok(cursor, "no |");
  const found = completions(
    index,
    cursor.file,
    cursor.text,
    annotate(cursor.text),
    cursor.offset,
  );
  if (!found) return undefined;
  return {
    inserting: cursor.text.slice(found.inserting.start, found.inserting.end),
    replacing: cursor.text.slice(found.replacing.start, found.replacing.end),
    items: new Map(found.items.map((c) => [c.label, c])),
  };
}

// Each label offered as "kind group", or "-" if it isn't
function offered(
  found: ReturnType<typeof complete>,
  labels: string[],
): Record<string, string> {
  assert.ok(found, "nothing offered");
  return Object.fromEntries(
    labels.map((l) => {
      const c: Completion | undefined = found.items.get(l);
      return [l, c ? `${c.kind} ${c.group}` : "-"];
    }),
  );
}

for (const [ending, newline] of [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
]) {
  const at = (files: Record<string, string>) => complete(files, newline);

  suite(`completion: a bare name (${ending})`, () => {
    test("the lambda's parameters and locals, globals, keywords", () => {
      const found = at({
        "/w/a.q": "g:1\n.ns.h:2\nf:{[price;qty] a:1; p|}",
        "/w/b.q": "k:{x}",
      });
      assert.deepStrictEqual(
        offered(found, ["price", "qty", "a", "f", "g", "k", "count", ".ns.h"]),
        {
          price: "param 0",
          qty: "param 0",
          a: "local 0",
          f: "function 1",
          g: "variable 1",
          k: "function 1",
          count: "keyword 2",
          ".ns.h": "-",
        },
      );
      assert.strictEqual(found?.inserting, "p");
    });

    test("only the innermost lambda's, as q has no closures", () => {
      const found = at({ "/w/a.q": "f:{[a] b:1; {[c] |}[1]}" });
      assert.deepStrictEqual(offered(found, ["a", "b", "c"]), {
        a: "-",
        b: "-",
        c: "param 0",
      });
    });

    test("x, y and z up to the highest used", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{y+|}" }), ["x", "y", "z"]),
        { x: "param 0", y: "param 0", z: "-" },
      );
    });

    test("a lambda left open, till a line at column 0", () => {
      assert.deepStrictEqual(offered(at({ "/w/a.q": "f:{[a] |" }), ["a"]), {
        a: "param 0",
      });
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a] 1\ng:|" }), ["a"]),
        { a: "-" },
      );
    });

    test("at top level, none of a lambda's", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a] b:1}\n|" }), ["a", "b", "f"]),
        { a: "-", b: "-", f: "function 1" },
      );
    });

    test("after \\d, only the namespace's, by their names in it", () => {
      const files = {
        "/w/a.q": "\\d .ns\nf:1\n|",
        "/w/b.q": ".ns.g:{x}\n.ns.sub.k:1\n.other.h:1\nr:1",
      };
      // q reads r there as .ns.r: the root's isn't seen (q 5)
      assert.deepStrictEqual(
        offered(at(files), ["f", "g", "sub", "sub.k", "h", "r", "count"]),
        {
          f: "variable 1",
          g: "function 1",
          sub: "namespace 1",
          "sub.k": "-",
          h: "-",
          r: "-",
          count: "keyword 2",
        },
      );
      const back = { ...files, "/w/a.q": "\\d .ns\nf:1\n\\d .\n|" };
      assert.deepStrictEqual(offered(at(back), ["f", "g", "r"]), {
        f: "-",
        g: "-",
        r: "variable 1",
      });
    });

    test("after q)\\d, only the namespace's", () => {
      const files = { "/w/b.q": ".ns.g:{x}\nr:1" };
      for (const source of ["q)\\d .ns\n|", "q)q)\\d .ns\nx:|"]) {
        const found = at({ ...files, "/w/a.q": source });
        assert.deepStrictEqual(offered(found, ["g", "r"]), {
          g: "function 1",
          r: "-",
        });
      }
    });

    test('after system "d .ns" too', () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": 'system "d .ns"\nf:1\n|' }), ["f"]),
        { f: "variable 1" },
      );
    });

    test("after a glyph, with nothing typed", () => {
      const found = at({ "/w/a.q": "g:1\nx:|" });
      assert.strictEqual(found?.inserting, "");
      assert.deepStrictEqual(offered(found, ["g"]), { g: "variable 1" });
    });

    test("a parameter over a global of its name", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "g:1\nh:{[g] |}" }), ["g"]),
        { g: "param 0" },
      );
    });

    test("in a file broken mid-edit", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "x:(1;2\ng:1]\nh:{[p] |}" }), ["p", "g"]),
        { p: "param 0", g: "variable 1" },
      );
    });

    test("a lambda left open, on an indented line after it", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a]\n  b:1;\n  |" }), ["a", "b"]),
        { a: "param 0", b: "local 0" },
      );
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a]\n  b:1;\n\n  |" }), ["a"]),
        { a: "param 0" },
      );
      // At column 0, a new statement starts
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a]\n  b:1;\n|" }), ["a", "b"]),
        { a: "-", b: "-" },
      );
    });

    test("inside a name, replacing the whole of it", () => {
      const found = at({ "/w/a.q": "f:{[abc] a|b}" });
      assert.strictEqual(found?.inserting, "a");
      assert.strictEqual(found?.replacing, "ab");
      const dotted = at({ "/w/a.q": ".ns.f:1\nx:.n|s.f" });
      assert.strictEqual(dotted?.inserting, ".n");
      assert.strictEqual(dotted?.replacing, ".ns.f");
      const symbol = at({ "/w/a.q": ".ns.f:1\nx:`.n|s.f`b" });
      assert.strictEqual(symbol?.replacing, ".ns.f");
    });

    test("just after a string's close", () => {
      assert.deepStrictEqual(offered(at({ "/w/a.q": 'g:1\nx:"a"|' }), ["g"]), {
        g: "variable 1",
      });
    });

    test("after q)", () => {
      for (const source of ["g:1\nq)|", "g:1\nq)x:|"]) {
        assert.deepStrictEqual(offered(at({ "/w/a.q": source }), ["g"]), {
          g: "variable 1",
        });
      }
    });

    test("with the cursor before a name, replacing all of it", () => {
      for (const [source, name] of [
        ["g:1\nx:|abc", "abc"],
        ["g:1\n|abc:1", "abc"],
        ["g:1\nx:|.ns.f", ".ns.f"],
      ]) {
        const found = at({ "/w/a.q": source });
        assert.strictEqual(found?.inserting, "");
        assert.strictEqual(found?.replacing, name);
      }
    });

    test("after \\d .z, your own, not q's values", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "\\d .z\npg:{x}\nx:|" }), ["pg", "K", "P"]),
        { pg: "hook 1", K: "-", P: "-" },
      );
      // Written in full, they are, as everywhere
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "\\d .z\nx:.z.|" }), [".z.K", ".z.P"]),
        { ".z.K": "hook 2", ".z.P": "hook 2" },
      );
    });

    test("after a number and a space", () => {
      assert.deepStrictEqual(offered(at({ "/w/a.q": "g:1\nx:1 |" }), ["g"]), {
        g: "variable 1",
      });
    });

    test("on a line joined on after a trailing comment", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "f:{[a] 1 / c\n  |" }), ["a"]),
        { a: "param 0" },
      );
    });

    test("after \\d .Q, q's own by their names in it", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "\\d .Q\nx:|" }), ["s1", "a", "count"]),
        { s1: "function 2", a: "variable 2", count: "keyword 2" },
      );
    });

    test("after \\d, in a lambda: its own first, then the namespace's", () => {
      const files = {
        "/w/a.q": "\\d .ns\nf:{[a;g] b:1; |}",
        "/w/b.q": ".ns.g:1\n.ns.h:1",
      };
      assert.deepStrictEqual(offered(at(files), ["a", "b", "g", "h"]), {
        a: "param 0",
        b: "local 0",
        g: "param 0",
        h: "variable 1",
      });
      const open = { ...files, "/w/a.q": "\\d .ns\nf:{[a]\n  |" };
      assert.deepStrictEqual(offered(at(open), ["a", "h"]), {
        a: "param 0",
        h: "variable 1",
      });
    });
  });

  suite(`completion: after a dot (${ending})`, () => {
    test("a dot alone: q's namespaces and the workspace's", () => {
      const found = at({ "/w/a.q": ".ns.f:1\n.top:2\nx:.|" });
      assert.deepStrictEqual(
        offered(found, [".Q", ".z", ".h", ".j", ".q", ".ns", ".top", ".ns.f"]),
        {
          ".Q": "namespace 1",
          ".z": "namespace 1",
          ".h": "namespace 1",
          ".j": "namespace 1",
          ".q": "-",
          ".ns": "namespace 1",
          ".top": "variable 1",
          ".ns.f": "-",
        },
      );
      assert.strictEqual(found?.inserting, ".");
    });

    test("q's own members, with KX's line", () => {
      const found = at({ "/w/a.q": "x:.Q.|" });
      assert.deepStrictEqual(offered(found, [".Q.s1", ".Q.a", ".z.pg"]), {
        ".Q.s1": "function 2",
        ".Q.a": "variable 2",
        ".z.pg": "-",
      });
      assert.strictEqual(
        found?.items.get(".Q.a")?.builtin?.summary,
        "lower-case alphabet",
      );
      assert.strictEqual(found?.inserting, ".Q.");
    });

    test("your namespace's members and namespaces, not deeper", () => {
      const found = at({
        "/w/a.q": ".ns.f:{[a;b] a}\n.ns.v:1\n.ns.sub.g:1",
        "/w/b.q": "x:.ns.|",
      });
      assert.deepStrictEqual(
        offered(found, [".ns.f", ".ns.v", ".ns.sub", ".ns.sub.g"]),
        {
          ".ns.f": "function 1",
          ".ns.v": "variable 1",
          ".ns.sub": "namespace 1",
          ".ns.sub.g": "-",
        },
      );
      assert.strictEqual(found?.items.get(".ns.f")?.defined?.detail, "[a;b]");
    });

    test("the name typed so far, dots and all", () => {
      const found = at({ "/w/a.q": ".ns.sub.g:1\nx:.ns.su|" });
      assert.strictEqual(found?.inserting, ".ns.su");
      assert.deepStrictEqual(offered(found, [".ns.sub"]), {
        ".ns.sub": "namespace 1",
      });
    });

    test("all of .z's as hooks, values and callbacks alike", () => {
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": "x:.z.|" }), [
          ".z.pg",
          ".z.ts",
          ".z.exit",
          ".z.K",
          ".z.p",
        ]),
        {
          ".z.pg": "hook 2",
          ".z.ts": "hook 2",
          ".z.exit": "hook 2",
          ".z.K": "hook 2",
          ".z.p": "hook 2",
        },
      );
    });

    test("your own .z.pg beside q's entry", () => {
      const found = at({ "/w/a.q": ".z.pg:{[q] value q}\nx:.z.|" });
      const pg = found?.items.get(".z.pg");
      assert.ok(pg?.builtin);
      assert.strictEqual(pg?.defined?.detail, "[q]");
    });

    test("after \\d, a name without a dot is in the namespace", () => {
      const found = at({ "/w/a.q": "\\d .ns\nsub.g:1\nx:sub.|" });
      assert.deepStrictEqual(offered(found, ["sub.g"]), {
        "sub.g": "variable 1",
      });
    });

    test("a module's exports, for a global bound to it", () => {
      const files = {
        "/w/mod.q": "v:1\nexport:([f:{[a;b] a}; v])",
        "/w/a.q": "s:use`mod\nx:s.|",
      };
      const found = at(files);
      assert.deepStrictEqual(offered(found, ["s.f", "s.v"]), {
        "s.f": "function 1",
        "s.v": "variable 1",
      });
      assert.strictEqual(found?.items.get("s.f")?.defined?.detail, "[a;b]");
    });

    test("a module's export of a dotted name alone, by its last part", () => {
      const found = at({
        "/w/mod.q": ".ns.k:5\nexport:([.ns.k])",
        "/w/a.q": "s:use`mod\nx:s.|",
      });
      assert.deepStrictEqual(offered(found, ["s.k", "s..ns.k"]), {
        "s.k": "variable 1",
        "s..ns.k": "-",
      });
    });

    test("inside lambdas, open or nested, and a broken file", () => {
      for (const source of [
        ".ns.f:1\ng:{[a] .ns.|",
        ".ns.f:1\ng:{[a] {[b] .ns.|}}",
        "x:(1;2\n.ns.f:1]\ng:{.ns.|}",
      ]) {
        assert.deepStrictEqual(offered(at({ "/w/a.q": source }), [".ns.f"]), {
          ".ns.f": "variable 1",
        });
      }
    });

    test("a module's exports: partly typed, under \\d, or bound as Go to Definition binds", () => {
      const mod = { "/w/mod.q": "f:{x}\nfa:1\nexport:([f;fa])" };
      const found = at({ ...mod, "/w/a.q": "s:use`mod\nx:s.f|" });
      assert.strictEqual(found?.inserting, "s.f");
      assert.deepStrictEqual(offered(found, ["s.f", "s.fa"]), {
        "s.f": "function 1",
        "s.fa": "variable 1",
      });
      assert.deepStrictEqual(
        offered(at({ ...mod, "/w/a.q": "\\d .ns\ns:use`mod\nx:s.|" }), ["s.f"]),
        { "s.f": "function 1" },
      );
      // :: at top level is a view; a local is never read through a dot
      for (const source of ["s::use`mod\nx:s.|", "f:{s:use`mod; s.|}"]) {
        assert.deepStrictEqual(
          offered(at({ ...mod, "/w/a.q": source }), ["s.f"]),
          {
            "s.f": "-",
          },
        );
      }
    });

    test("a module that isn't found, nothing", () => {
      assert.strictEqual(at({ "/w/a.q": "s:use`nope\nx:s.|" })?.items.size, 0);
    });

    test("a namespace with nothing in it, nothing", () => {
      assert.strictEqual(at({ "/w/a.q": "x:.nope.|" })?.items.size, 0);
    });
  });

  suite(`completion: a module bound in another file (${ending})`, () => {
    const mod = { "/w/lib/mod.q": "impl:{x}\nexport:([f:impl])" };
    const other = { "/w/lib/other.q": "g:{y}\nexport:([h:g])" };
    // Each way to bind s, and the namespace a read of it is in
    const forms: [string, (m: string) => string, string][] = [
      ["at top level", (m) => `s:use\`${m}`, ""],
      ["in a lambda", (m) => `init:{s::use\`${m}}`, ""],
      ["under \\d", (m) => `\\d .ns\ns:use\`${m}`, "\\d .ns\n"],
    ];
    // Each case's files, given the form, and how s.f and s.h are offered
    const cases: [
      string,
      (bind: (m: string) => string, ns: string) => Record<string, string>,
      string,
      string,
    ][] = [
      [
        "bound only in another file",
        (bind, ns) => ({ "/w/a.q": bind("mod"), "/w/b.q": `${ns}x:s.|` }),
        "function 1",
        "-",
      ],
      [
        "bound in the file too, the file's",
        (bind) => ({
          "/w/a.q": bind("mod"),
          "/w/b.q": `${bind("other")}\nx:s.|`,
        }),
        "-",
        "function 1",
      ],
      [
        "defined in the file as something else, none",
        (bind, ns) => ({ "/w/a.q": bind("mod"), "/w/b.q": `${ns}s:1\nx:s.|` }),
        "-",
        "-",
      ],
      [
        "bound in two other files, both",
        (bind, ns) => ({
          "/w/a.q": bind("mod"),
          "/w/x/c.q": bind("other"),
          "/w/b.q": `${ns}x:s.|`,
        }),
        "function 1",
        "function 1",
      ],
    ];
    for (const [form, bind, ns] of forms) {
      for (const [name, files, f, h] of cases) {
        test(`${form}, ${name}`, () => {
          const found = at({ ...mod, ...other, ...files(bind, ns) });
          assert.deepStrictEqual(offered(found, ["s.f", "s.h"]), {
            "s.f": f,
            "s.h": h,
          });
        });
      }
    }

    test("bound in a module's own namespace, or read in one, none", () => {
      const own = "export:([z:1])\n";
      for (const files of [
        { "/w/a.q": `${own}s:use\`mod`, "/w/b.q": "x:s.|" },
        { "/w/a.q": "s:use`mod", "/w/b.q": `${own}x:s.|` },
      ]) {
        assert.deepStrictEqual(offered(at({ ...mod, ...files }), ["s.f"]), {
          "s.f": "-",
        });
      }
      // After a \d, the root's, as any global
      for (const files of [
        { "/w/a.q": `${own}\\d .\ns:use\`mod`, "/w/b.q": "x:s.|" },
        { "/w/a.q": "s:use`mod", "/w/b.q": `${own}\\d .\nx:s.|` },
      ]) {
        assert.deepStrictEqual(offered(at({ ...mod, ...files }), ["s.f"]), {
          "s.f": "function 1",
        });
      }
    });

    test("a view at top level, none, as q 5.0 reads no s.f through it", () => {
      const found = at({ ...mod, "/w/a.q": "s::use`mod", "/w/b.q": "x:s.|" });
      assert.deepStrictEqual(offered(found, ["s.f"]), { "s.f": "-" });
      // In the file, it's the file's s, so none from another file's binding
      const here = at({
        ...mod,
        ...other,
        "/w/a.q": "s:use`mod",
        "/w/b.q": "s::use`other\nx:s.|",
      });
      assert.deepStrictEqual(offered(here, ["s.f", "s.h"]), {
        "s.f": "-",
        "s.h": "-",
      });
    });

    test("after \\d . in a module binding its own s, the root's", () => {
      const found = at({
        ...mod,
        ...other,
        "/w/a.q": "s:use`mod",
        "/w/b.q": "s:use`other\nexport:([z:1])\n\\d .\nx:s.|",
      });
      assert.deepStrictEqual(offered(found, ["s.f", "s.h"]), {
        "s.f": "function 1",
        "s.h": "-",
      });
    });
  });

  suite(`completion: a module's own globals (${ending})`, () => {
    // Each way the file ends, and whether it's a module, as q finds an
    // export only in the module's own namespace
    const forms: [string, string, boolean][] = [
      ["an export", "export:([mean])", true],
      [
        "an export assigned in a lambda",
        "init:{export::([mean])}\ninit[]",
        true,
      ],
      ["no export", "", false],
      ["an export after \\d", "\\d .x\nexport:([mean])", false],
    ];
    const stats = (tail: string) =>
      `helper:{x}\nmean:{helper x}\n.abs.g:1\n${tail}`;
    for (const [form, tail, module] of forms) {
      test(`${form}: in another file, ${module ? "none" : "as globals"}`, () => {
        const found = at({ "/w/stats.q": stats(tail), "/w/a.q": "x:|" });
        assert.deepStrictEqual(offered(found, ["helper", "mean"]), {
          helper: module ? "-" : "function 1",
          mean: module ? "-" : "function 1",
        });
        const dotted = at({ "/w/stats.q": stats(tail), "/w/a.q": "x:.abs.|" });
        assert.deepStrictEqual(offered(dotted, [".abs.g"]), {
          ".abs.g": "variable 1",
        });
      });

      test(`${form}: in the file, ${module ? "its own only" : "every file's"}`, () => {
        const found = at({
          "/w/stats.q": `x:|\n${stats(tail)}`,
          "/w/b.q": "root:1",
        });
        assert.deepStrictEqual(offered(found, ["helper", "mean", "root"]), {
          helper: "function 1",
          mean: "function 1",
          root: module ? "-" : "variable 1",
        });
      });
    }

    test("after \\d . in a module, the root's", () => {
      const found = at({
        "/w/stats.q": "helper:{x}\nexport:([helper])\n\\d .\nx:|",
        "/w/b.q": "root:1",
      });
      assert.deepStrictEqual(offered(found, ["helper", "root"]), {
        helper: "-",
        root: "variable 1",
      });
    });
  });

  suite(`completion: a symbol (${ending})`, () => {
    test("naming a namespace, its members", () => {
      const found = at({ "/w/a.q": ".ns.f:1\nx:`.ns.|" });
      assert.strictEqual(found?.inserting, ".ns.");
      assert.deepStrictEqual(offered(found, [".ns.f"]), {
        ".ns.f": "variable 1",
      });
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": ".ns.f:1\nx:`a`.ns.|" }), [".ns.f"]),
        { ".ns.f": "variable 1" },
      );
      assert.deepStrictEqual(
        offered(at({ "/w/a.q": ".ns.f:1\nx:`.|" }), [".ns"]),
        { ".ns": "namespace 1" },
      );
    });

    test("under \\d, and in a broken file", () => {
      for (const source of [
        "\\d .other\n.ns.f:1\nx:`.ns.|",
        "x:(1;2\n.ns.f:1]\nx:`.ns.|",
      ]) {
        assert.deepStrictEqual(offered(at({ "/w/a.q": source }), [".ns.f"]), {
          ".ns.f": "variable 1",
        });
      }
    });

    test("any other, nothing: it's data", () => {
      assert.strictEqual(at({ "/w/a.q": "g:1\nx:`g|" }), undefined);
      assert.strictEqual(at({ "/w/a.q": "x:`:fi|" }), undefined);
    });
  });

  suite(`completion: quiet (${ending})`, () => {
    for (const [what, source] of [
      ["in a string", 'g:1\nx:"g|"'],
      ["in a string left open", 'g:1\nx:"g|'],
      ["in a trailing comment", "g:1\nx:1 / g|"],
      ["in a comment line", "g:1\n/ g|"],
      ["in a block comment", "g:1\n/\ng|\n\\\n"],
      ["in a number", "x:1|"],
      ["in a number with a dot", "x:1.|"],
      ["in a system command", "\\d .n|"],
      ["in another language's line", "p)g|"],
      ["in a k line", "k)g|"],
      ["after the script's end", "g:1\n\\\ng|"],
      ["after spaces in a string left open", 'g:1\nx:"a |'],
      ["after spaces in a trailing comment", "g:1\nx:1 / note |"],
      ["after spaces in another language's line", "g:1\np)x = |"],
      ["after spaces in a system command", "g:1\n\\l |"],
      ["on a system command's line joined on", "g:1\n\\l a.q\n  g|"],
      ["in a system command after q)", "g:1\nq)\\l a|"],
      ["after spaces in a system command after q)", "g:1\nq)\\l |"],
      ["in \\d after q)", "q)\\d .n|"],
      ["on a line joined on to q)\\l", "g:1\nq)\\l a.q\n  g|"],
      ["in a comment after q)", "g:1\nq)/ g|"],
      ["in a comment after q) and a space", "g:1\nq) / g|"],
      ["in a k line after q)", "g:1\nq)k)g|"],
      ["in another language's line after q)", "g:1\nq)p)g|"],
      ["on another language's line joined on", "g:1\np)x = 1\n  |"],
      ["on a blank line in a string left open", 'g:1\nx:"abc\n  |'],
      ["after #!", "#!/usr/bin/q|\ng:1"],
      ["in a lambda's parameters", "g:1\nf:{[a|] a}"],
      ["in a lambda's parameters, left open", "g:1\nf:{[a;|"],
    ]) {
      test(what, () => {
        assert.strictEqual(at({ "/w/a.q": source }), undefined);
      });
    }
  });
}
