import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { annotate } from "../annotate";
import {
  globals,
  type Outlined,
  occurrences,
  outline,
  references,
} from "../navigation";
import { definitions, entry } from "../workspaceIndex";

const fixtures = path.join(__dirname, "../../test/fixtures");

// The outline as "kind name detail: range", children indented
function shown(text: string): string[] {
  const lines: string[] = [];
  const add = (o: Outlined, indent: string) => {
    const name = text.slice(o.nameSpan.start, o.nameSpan.end);
    lines.push(
      `${indent}${o.kind} ${o.name}${o.detail ? ` ${o.detail}` : ""}` +
        (o.kind === "namespace"
          ? ""
          : `: ${text.slice(o.span.start, o.span.end)}`) +
        (name !== o.name && o.kind !== "namespace" ? ` @${name}` : ""),
    );
    for (const c of o.children ?? []) add(c, `${indent}  `);
  };
  for (const o of outline(text, annotate(text))) add(o, "");
  return lines;
}

suite("outline", () => {
  const cases: [string, string, string[]][] = [
    [
      "functions and variables",
      "f:{[a;b] a+b}\ng:{x*2}\nn:42",
      [
        "function f [a;b]: f:{[a;b] a+b}",
        "function g [x]: g:{x*2}",
        "variable n: n:42",
      ],
    ],
    [
      "each global once, where it's first assigned",
      "n:0\nn+:1\nf:{n::2}",
      ["variable n: n:0", "function f [x]: f:{n::2}"],
    ],
    [
      "namespaces, dotted and by \\d",
      ".u.init:{x}\n\\d .u\nsub:{[t;s] t}\n\\d .\ntop:1",
      [
        "namespace .u",
        "  function init [x]: .u.init:{x} @.u.init",
        "  function sub [t;s]: sub:{[t;s] t}",
        "variable top: top:1",
      ],
    ],
    [
      "a lambda applied is a value, not a function",
      "a:{x}[1]\nb:{x}",
      ["variable a: a:{x}[1]", "function b [x]: b:{x}"],
    ],
    [
      "several on a line, and inside a call",
      "a:1;b:2\nif[c;d:3]",
      ["variable a: a:1", "variable b: b:2", "variable d: d:3"],
    ],
    [
      "set and upsert by reference",
      "`t set ([] a:1 2)\n`.u.q upsert x",
      [
        "variable t: `t set ([] a:1 2)",
        "namespace .u",
        "  variable q: `.u.q upsert x @.u.q",
      ],
    ],
    [
      "a lambda set by handle is a function",
      "`f set {[a;b] a}\nset[`g;{x}]\n`h set {x} 1",
      [
        "function f [a;b]: `f set {[a;b] a}",
        "function g [x]: set[`g;{x}]",
        "variable h: `h set {x} 1",
      ],
    ],
    [
      "modules",
      "m:use`foo\nn:(use`bar)`f",
      ["module m use`foo: m:use`foo", "variable n: n:(use`bar)`f"],
    ],
    [
      "not locals, or globals assigned in a lambda",
      "f:{a:1; .x.y:2; b::3}",
      ["function f [x]: f:{a:1; .x.y:2; b::3}"],
    ],
    ["a lambda left open", "f:{x", ["variable f: f:{x"]],
    [
      "not an amend, as q can't create a global by one",
      "d[`a]:1\n@[`t;0;:;1]\nd[]:2",
      ["variable d: d[]:2"],
    ],
    [
      "a lambda assigned to several",
      "f:g:{x}",
      ["function f [x]: f:g:{x}", "function g [x]: g:{x}"],
    ],
    [
      "a dictionary amended by its name and a dot",
      "\\d .pm\nerr.:(::)\nerr[`f]:1",
      ["namespace .pm", "  variable err: err.:(::) @err."],
    ],
    [
      "a namespace in runs, around others",
      ".u.a:1\nb:2\n.u.c:3\n.u.d:4",
      [
        "namespace .u",
        "  variable a: .u.a:1 @.u.a",
        "variable b: b:2",
        "namespace .u",
        "  variable c: .u.c:3 @.u.c",
        "  variable d: .u.d:4 @.u.d",
      ],
    ],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(shown(text), expected);
    });
  }

  test("a namespace spans its globals", () => {
    const text = ".a.b:1\n.a.d:{x}";
    const [space] = outline(text, annotate(text));
    assert.strictEqual(text.slice(space.span.start, space.span.end), text);
  });

  test("never throws on a half-typed file", () => {
    const corpus = readFileSync(path.join(fixtures, "corpus.q"), "utf8");
    for (let i = 0; i < corpus.length; i += 7) {
      const text = corpus.slice(0, i);
      const items = outline(text, annotate(text));
      for (const o of items.flatMap((o) => [o, ...(o.children ?? [])])) {
        assert.ok(o.name, "VS Code refuses an empty name");
        assert.ok(
          o.span.start <= o.nameSpan.start && o.nameSpan.end <= o.span.end,
        );
      }
      // Siblings don't overlap, so the cursor is in one at most
      items.forEach((o, n) => {
        assert.ok(n === 0 || items[n - 1].span.end <= o.span.start);
      });
    }
  })
    // Every prefix of the corpus, not a measure of speed: CI's machines are
    // slower
    .timeout(20000);
});

// The occurrences of the name at the first | as "text kind", with the |
// taken out
function marked(source: string): string[] {
  const offset = source.indexOf("|");
  const text = source.slice(0, offset) + source.slice(offset + 1);
  return occurrences(annotate(text), offset).map(
    (o) => `${text.slice(o.start, o.end)} ${o.kind}`,
  );
}

suite("documentation", () => {
  // Each global's comment, by name
  const docs = (text: string) =>
    Object.fromEntries(
      globals(text, annotate(text)).map((d) => [d.full, d.doc]),
    );
  const endings = { LF: "\n", CRLF: "\r\n", CR: "\r" };

  // Every way to define a global, each with every placement of a comment,
  // at every line ending: the global's name, its line, and whether it's in
  // a lambda, where no comment documents it
  const forms: [string, string, string, boolean][] = [
    ["a name", "f", "f:{x}", false],
    ["a name assigned along with another", "f", "f:g:{x}", false],
    ["a handle", "f", "`f set {x}", false],
    ["set", "f", "set[`f;{x}]", false],
    ["a name in a lambda", ".c.f", ".c.f::1", true],
    ["a handle in a lambda", ".c.f", "`.c.f set 1", true],
  ];
  // Lines, D for the definition's, and the comment it gets: the lines
  // above, as written
  const placements: [string, string[], string | undefined][] = [
    ["a comment line above", ["/ about", "D"], "/ about"],
    ["comment lines above", ["// one", "/  two", "D"], "// one\n/  two"],
    [
      "TorQ's dashes above",
      ["/- about", "/ -p port", "D"],
      "/- about\n/ -p port",
    ],
    ["a block comment above", ["/", "  about", "\\", "D"], "/\n  about\n\\"],
    ["none", ["D"], undefined],
    ["not across a blank line", ["/ about", "", "D"], undefined],
    ["not a comment trailing", ["D / about"], undefined],
    ["not the line above's trailing comment", ["z:0 / about", "D"], undefined],
    ["not when not first on its line", ["/ about", "z:0; D"], undefined],
    ["not a comment indented", ["z:0", " / about", "D"], undefined],
  ];
  for (const [form, name, line, inLambda] of forms) {
    for (const [placement, lines, expected] of placements) {
      test(`${form}: ${placement}`, () => {
        for (const [ending, eol] of Object.entries(endings)) {
          const body = lines.map((l) => l.replace("D", line));
          const text = inLambda
            ? ["h:{[]", ...body.map((l) => `  ${l}`), " }"].join(eol)
            : body.join(eol);
          const found = docs(text);
          // Defined, so no comment means no comment
          assert.ok(name in found, ending);
          assert.strictEqual(
            found[name],
            inLambda ? undefined : expected,
            ending,
          );
        }
      });
    }
  }

  test("a comment's trailing spaces, as written", () =>
    assert.deepStrictEqual(docs("/ about  \r\nf:1"), { f: "/ about  " }));
  test("a comment's own indent, as written", () =>
    assert.deepStrictEqual(docs("/ one\n/    two\nf:1"), {
      f: "/ one\n/    two",
    }));
  test("not a comment in a statement indented", () =>
    assert.deepStrictEqual(docs("if[1b;\n  /\n  / more\n  g:{[a] a}]"), {
      g: undefined,
    }));
  test("from the first line, after a line break", () =>
    assert.deepStrictEqual(docs("\n/ c\nf:1;/ d\n/\n \n["), { f: "/ c" }));

  // Every form, each with a comment above, many times over
  for (const [ending, eol] of Object.entries(endings)) {
    test(`a large file, in linear time: ${ending}`, () => {
      const one = forms
        .filter(([, , , inLambda]) => !inLambda)
        .map(([, , line]) => `/ about${eol}${line} / trailing`)
        .join(eol);
      const text = `${one}${eol}`.repeat(15000);
      const start = Date.now();
      assert.strictEqual(globals(text, annotate(text))[0].doc, "/ about");
      assert.ok(Date.now() - start < 2000, `${Date.now() - start} ms`);
    });
    test(`a long run of comment lines, in linear time: ${ending}`, () => {
      const text = `${`/ c${eol}`.repeat(80000)}f:1`;
      const start = Date.now();
      assert.strictEqual(
        globals(text, annotate(text))[0].doc?.length,
        80000 * 4 - 1,
      );
      assert.ok(Date.now() - start < 2000, `${Date.now() - start} ms`);
    });
  }
  test("a long block comment, without running out of stack", () => {
    const text = `/\n${" c\n".repeat(300000)}\\\nf:1`;
    assert.strictEqual(globals(text, annotate(text))[0].doc?.length, 900003);
  });
  test("a long run of comment lines, without running out of stack", () => {
    const text = `${"/ c\n".repeat(300000)}f:1`;
    assert.strictEqual(globals(text, annotate(text))[0].doc?.length, 1199999);
  });
  test("a long statement, in linear time", () => {
    const text = Array.from({ length: 100000 }, (_, n) => `a${n}:${n}`).join(
      ";",
    );
    const start = Date.now();
    assert.strictEqual(globals(text, annotate(text)).length, 100000);
    assert.ok(Date.now() - start < 2000, `${Date.now() - start} ms`);
  });
});

suite("occurrences", () => {
  const cases: [string, string, string[]][] = [
    [
      "a global, read and written, by name and by reference",
      "|n:0\nf:{n+x}\n`n set 1\ng:{n:1}",
      ["n write", "n read", "n write"],
    ],
    ["a local only in its lambda", "f:{a:1; a+x}\ng:{|a+x}", ["a read"]],
    [
      "a parameter, from just after it",
      "f:{[a|] a+1}\ng:{[a] a}",
      ["a write", "a read"],
    ],
    ["an implicit parameter, not a nested lambda's", "f:{|x+{x}1}", ["x read"]],
    [
      "a global under \\d, by its absolute name",
      "\\d .u\nf:1\n\\d .\n.u.|f+1",
      ["f write", ".u.f read"],
    ],
    [
      "a column and the parameter it may be",
      "f:{[t;n] select from t where i<|n}",
      ["n text", "n read"],
    ],
    [
      "a parameter and the column it may be",
      "f:{[t;|n] select from t where i<n}",
      ["n write", "n text"],
    ],
    [
      "an export, by any binding",
      "m:use`foo\nk:use`foo\nm.|f 1\nk`f",
      ["m.f read", "f read"],
    ],
    [
      "a dictionary by its name with a dot",
      "\\d .pm\n|err.:(::)\nerr[`f]:1\n.pm.err",
      ["err. write", "err write", ".pm.err read"],
    ],
    ["a keyword", "|count x\ncount y", ["count read", "count read"]],
    ["nothing in a string", 'a:"|a"', []],
  ];
  for (const [name, source, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(marked(source), expected);
    });
  }
});

// The definition of the name at the first | as "line:column name", from 1,
// with the | taken out, in a workspace of the one file
function defined(source: string): string {
  const offset = source.indexOf("|");
  const text = source.slice(0, offset) + source.slice(offset + 1);
  const a = annotate(text);
  const found = definitions(
    new Map([["/a.q", entry(text, a)]]),
    "/a.q",
    a,
    offset,
  );
  assert.ok(found.length <= 1);
  const [d] = found;
  if (!d) return "none";
  const before = text.slice(0, d.start).split("\n");
  return `${before.length}:${before[before.length - 1].length + 1} ${text.slice(d.start, d.end)}`;
}

suite("definition in a file", () => {
  const cases: [string, string, string][] = [
    ["a global, where it's first assigned", "n:0\nn:1\nf:{|n}", "1:1 n"],
    [
      "a global assigned as the file loads, not first in a lambda",
      "f:{n::1}\nn:0\n|n",
      "2:1 n",
    ],
    ["a global only a lambda assigns", "f:{n::1}\n|n", "1:4 n"],
    ["a global set by reference", "`t set 1\n|t", "1:2 t"],
    ["a global from a handle", "t:1\n`|t upsert 2", "1:1 t"],
    ["a parameter, where it's declared", "f:{[a;b] a:1; |a}", "1:5 a"],
    ["a local, not a global of its name", "a:0\nf:{a:1; |a}", "2:4 a"],
    [
      "a global under \\d, by its absolute name",
      "\\d .u\nf:1\n\\d .\n.u.|f",
      "2:1 f",
    ],
    [
      "a column, as the parameter it may be",
      "f:{[t;n] select from t where i<|n}",
      "1:7 n",
    ],
    [
      "not the virtual column i, as q reads it over any variable",
      "f:{[t;i] select from t where |i<1}",
      "none",
    ],
    [
      "not a column assigned, as q reads no variable there",
      "f:{[t;n] update |n:1 from t}",
      "none",
    ],
    ["the definition itself", "|n:0", "1:1 n"],
    [
      "not an amend, as q can't create a global by one",
      ".h.tx[`a]:1\n@[`t;0;:;1]\nupdate a:1 from `u\nf:{|.h.tx,t,u}",
      "none",
    ],
    ["an assignment, not a later amend", "f:{d[`a]:1}\nd:()!()\n|d", "2:1 d"],
    ["a replacement in full", "d[]:1\n@[`t;();:;1]\n|t,d", "2:4 t"],
    ["in the root, by key", "@[`.;`t;:;1]\n|t", "1:7 t"],
    ["an implicit parameter", "f:{|x}", "none"],
    ["an implicit parameter assigned", "f:{x:1; |x}", "1:4 x"],
    ["a global defined in another file", "f:{|g x}", "none"],
    ["a keyword", "|count 1", "none"],
    ["an export", "m:use`foo\nm.|f 1", "none"],
  ];
  for (const [name, source, expected] of cases) {
    test(name, () => {
      assert.strictEqual(defined(source), expected);
    });
  }
});

suite("references", () => {
  const text = "n:0\nf:{n+1}\n`n set 2";
  const at = text.indexOf("n+1");
  const shown = (withDefinition: boolean) =>
    references(annotate(text), at, withDefinition).map((r) => r.start);
  test("with the definition", () => {
    assert.deepStrictEqual(shown(true), [0, 7, 13]);
  });
  test("without it", () => {
    assert.deepStrictEqual(shown(false), [7, 13]);
  });
});

suite("navigation in the editor", () => {
  const text = "\\d .u\nf:{[a] a+1}\n\\d .\ng:.u.f 2";
  let uri: vscode.Uri;
  suiteSetup(async () => {
    // Opening a q document activates the extension, which finishes after
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
    const d = await vscode.workspace.openTextDocument({
      language: "q",
      content: text,
    });
    uri = d.uri;
  });

  test("outline", async () => {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", uri);
    assert.deepStrictEqual(
      symbols.map((s) => [s.name, s.children.map((c) => c.name)]),
      [
        [".u", ["f"]],
        ["g", []],
      ],
    );
    assert.strictEqual(symbols[0].children[0].kind, vscode.SymbolKind.Function);
  });

  test("occurrence highlighting", async () => {
    const highlights = await vscode.commands.executeCommand<
      vscode.DocumentHighlight[]
    >("vscode.executeDocumentHighlights", uri, new vscode.Position(1, 0));
    assert.deepStrictEqual(
      highlights.map((h) => [h.range.start.line, h.kind]),
      [
        [1, vscode.DocumentHighlightKind.Write],
        [3, vscode.DocumentHighlightKind.Read],
      ],
    );
  });

  test("definition", async () => {
    const [found] = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(3, 5),
    );
    assert.deepStrictEqual(
      [found.range.start.line, found.range.start.character],
      [1, 0],
    );
  });

  test("references", async () => {
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      new vscode.Position(3, 5),
    );
    assert.deepStrictEqual(
      found.map((l) => l.range.start.line),
      [1, 3],
    );
  });
});
