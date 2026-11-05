import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { annotate } from "../annotate";
import { type Outlined, occurrences, outline } from "../navigation";

const fixtures = path.join(__dirname, "../../test/fixtures");

// The outline as "kind name detail: range", children indented
function shown(text: string): string[] {
  const lines: string[] = [];
  const add = (o: Outlined, indent: string) => {
    const name = text.slice(o.nameStart, o.nameEnd);
    lines.push(
      `${indent}${o.kind} ${o.name}${o.detail ? ` ${o.detail}` : ""}` +
        (o.kind === "namespace" ? "" : `: ${text.slice(o.start, o.end)}`) +
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
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(shown(text), expected);
    });
  }

  test("a namespace spans its globals", () => {
    const text = ".a.b:1\nc:2\n.a.d:{x}";
    const [space] = outline(text, annotate(text));
    assert.strictEqual(text.slice(space.start, space.end), text);
  });

  test("never throws on a half-typed file", () => {
    const corpus = readFileSync(path.join(fixtures, "corpus.q"), "utf8");
    for (let i = 0; i < corpus.length; i += 7) {
      const text = corpus.slice(0, i);
      const items = outline(text, annotate(text));
      for (const o of items.flatMap((o) => [o, ...(o.children ?? [])])) {
        assert.ok(o.start <= o.nameStart && o.nameEnd <= o.end);
      }
    }
  });
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
    ["a keyword", "|count x\ncount y", ["count read", "count read"]],
    ["nothing in a string", 'a:"|a"', []],
  ];
  for (const [name, source, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(marked(source), expected);
    });
  }
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
});
