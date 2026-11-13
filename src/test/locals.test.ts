import * as assert from "node:assert";
import * as vscode from "vscode";
import { annotate } from "../annotate";
import { locals, rename } from "../locals";

const endings = { LF: "\n", CRLF: "\r\n", CR: "\r" };

// Each parameter and local as "name kind", in order
function shown(text: string): string[] {
  return locals(annotate(text)).map(
    (o) =>
      `${text.slice(o.start, o.end)} ${o.param ? "parameter" : "variable"}`,
  );
}

// The text with | at the cursor renamed to the name, or why it can't be
function renamed(marked: string, to: string): string {
  const offset = marked.indexOf("|");
  const text = marked.replace("|", "");
  const found = rename(text, annotate(text), offset, to);
  if ("refused" in found) return `refused: ${found.refused}`;
  let out = text;
  for (const e of [...found.edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

suite("parameters and locals", () => {
  // Every way a lambda owns a name, and names it doesn't
  const cases: [string, string, string[]][] = [
    [
      "parameters, in the signature and the body",
      "f:{[t;n] n#t}",
      ["t parameter", "n parameter", "n parameter", "t parameter"],
    ],
    [
      "a parameter assigned is still a parameter",
      "f:{[a] a:a+1; a}",
      ["a parameter", "a parameter", "a parameter", "a parameter"],
    ],
    [
      "typed parameters, the type not a name",
      "f:{[a:`j;b] a+b}",
      ["a parameter", "b parameter", "a parameter", "b parameter"],
    ],
    [
      "a pattern's names are locals",
      "f:{[(a;b);c] a+b+c}",
      [
        "a variable",
        "b variable",
        "c parameter",
        "a variable",
        "b variable",
        "c parameter",
      ],
    ],
    ["implicit parameters", "f:{x*y}", ["x parameter", "y parameter"]],
    [
      "x in a lambda with a parameter list is a global",
      "f:{[a] a+x}",
      ["a parameter", "a parameter"],
    ],
    [
      "locals, assigned, amended and indexed",
      "f:{r:1 2; r+:1; r[0]:3; r}",
      ["r variable", "r variable", "r variable", "r variable"],
    ],
    [
      "globals: assigned with ::, dotted, read, at top level",
      "g:1; f:{a::1; a.b:2; g+x}",
      ["x parameter"],
    ],
    [
      "a query's name that may be the parameter, not a column",
      "f:{[t;p] select from t where price>p}",
      ["t parameter", "p parameter", "t parameter", "p parameter"],
    ],
    [
      "a column defined in a query, not the local it reads",
      "f:{p:1; update q:p from t}",
      ["p variable", "p variable"],
    ],
    [
      "a lambda inside owns its own names, reading the outer's as globals",
      "f:{[a] {[b] a+b}}",
      ["a parameter", "b parameter", "b parameter"],
    ],
    [
      "builtins, strings and symbols",
      'f:{[a] count a,"a",`a}',
      ["a parameter", "a parameter"],
    ],
  ];
  for (const [name, text, expected] of cases) {
    for (const [ending, eol] of Object.entries(endings)) {
      test(`${name}: ${ending}`, () =>
        assert.deepStrictEqual(shown(text.replaceAll("\n", eol)), expected));
    }
  }

  // q reads a lone CR as a space, so with CR the line is all \d's
  for (const [ending, eol] of Object.entries(endings)) {
    test(`under \\d: ${ending}`, () =>
      assert.deepStrictEqual(
        shown(`\\d .u${eol}f:{[a] r:a; r}${eol}\\d .`),
        eol === "\r"
          ? []
          : ["a parameter", "r variable", "a parameter", "r variable"],
      ));
  }

  test("a lambda over several lines", () =>
    assert.deepStrictEqual(shown("f:{[a]\n  r:a;\n  r}"), [
      "a parameter",
      "r variable",
      "a parameter",
      "r variable",
    ]));

  for (const [ending, eol] of Object.entries(endings)) {
    test(`a large file, in linear time: ${ending}`, () => {
      const text = `f:{[t;n] r:n#t;${eol} r,count r}${eol}`.repeat(20000);
      const start = Date.now();
      assert.strictEqual(shown(text).length, 140000);
      assert.ok(Date.now() - start < 2000, `${Date.now() - start} ms`);
    });
  }
});

suite("rename", () => {
  // Text with | at the cursor, the new name, then the text renamed or why
  // it can't be
  const cases: [string, string, string, string][] = [
    [
      "a parameter, from its declaration",
      "f:{[|t;n] n#t}",
      "tab",
      "f:{[tab;n] n#tab}",
    ],
    ["a parameter, from a use", "f:{[t;n] n#|t}", "tab", "f:{[tab;n] n#tab}"],
    [
      "a parameter assigned in the body",
      "f:{[a] a:a+1; |a}",
      "b",
      "f:{[b] b:b+1; b}",
    ],
    ["a typed parameter", "f:{[|a:`j] a}", "b", "f:{[b:`j] b}"],
    ["a pattern's name", "f:{[(|a;b)] a+b}", "c", "f:{[(c;b)] c+b}"],
    [
      "a local, assigned, amended and indexed",
      "f:{|r:1 2; r+:1; r[0]:3; r}",
      "s",
      "f:{s:1 2; s+:1; s[0]:3; s}",
    ],
    [
      "with the cursor just after the name",
      "f:{[t] t|}",
      "tab",
      "f:{[tab] tab}",
    ],
    [
      "a query's name that may be the parameter",
      "f:{[t;p] select from t where price>|p}",
      "lim",
      "f:{[t;lim] select from t where price>lim}",
    ],
    [
      "only in its own lambda",
      "f:{[|a] a}; g:{[a] a}; a:1",
      "b",
      "f:{[b] b}; g:{[a] a}; a:1",
    ],
    [
      "not the outer's name in a lambda inside, which is a global",
      "f:{[|a] a+{[b] a+b}[1]}",
      "c",
      "f:{[c] c+{[b] a+b}[1]}",
    ],
    [
      "a local of a lambda inside",
      "f:{[a] {[|a] a}[a]}",
      "b",
      "f:{[a] {[b] b}[a]}",
    ],
    [
      "not a dotted global with the same root",
      "f:{|s:1; s.f}",
      "t",
      "f:{t:1; s.f}",
    ],
    ["the same name: nothing changes", "f:{[|a] a}", "a", "f:{[a] a}"],
    // Implicit parameters get a list, as q reads them
    ["implicit x", "f:{|x*y}", "price", "f:{[price;y] price*y}"],
    ["implicit y", "f:{x*|y}", "qty", "f:{[x;qty] x*qty}"],
    ["implicit z, x and y listed too", "f:{|z}", "c", "f:{[x;y;c] c}"],
    ["implicit x to a name in use", "f:{|x*y}", "y", "refused: name in use: y"],
    ["implicit x to z", "f:{|x*y}", "z", "f:{[z;y] z*y}"],
    // Refused
    [
      "a global",
      "f:{|g+1}",
      "h",
      "refused: only locals and parameters can be renamed",
    ],
    [
      "a global at top level",
      "|g:1",
      "h",
      "refused: only locals and parameters can be renamed",
    ],
    [
      "a column",
      "f:{[t] select |price from t}",
      "p",
      "refused: only locals and parameters can be renamed",
    ],
    [
      "a builtin",
      "f:{[a] |count a}",
      "n",
      "refused: only locals and parameters can be renamed",
    ],
    [
      "a string",
      'f:{[a] "|a"}',
      "b",
      "refused: only locals and parameters can be renamed",
    ],
    [
      "outside any name",
      "f:{[a] a |+ 1}",
      "b",
      "refused: only locals and parameters can be renamed",
    ],
    ["a dotted name", "f:{[|a] a}", "a.b", "refused: invalid name: a.b"],
    ["not a name", "f:{[|a] a}", "1a", "refused: invalid name: 1a"],
    ["empty", "f:{[|a] a}", "", "refused: invalid name: "],
    ["a keyword", "f:{[|a] a}", "count", "refused: assign: count"],
    ["a parameter's name", "f:{[|a;b] a+b}", "b", "refused: name in use: b"],
    ["a local's name", "f:{[|a] r:a; r}", "r", "refused: name in use: r"],
    [
      "a global the lambda reads",
      "f:{[|a] a+g}",
      "g",
      "refused: name in use: g",
    ],
    [
      "a column the lambda's query reads",
      "f:{[t;|p] select from t where price>p}",
      "price",
      "refused: name in use: price",
    ],
    [
      "x in a lambda without a list",
      "f:{|r:1; r+y}",
      "x",
      "refused: implicit parameter: x",
    ],
    [
      "z in a lambda without a list",
      "f:{|r:1; r}",
      "z",
      "refused: implicit parameter: z",
    ],
    ["x in a lambda with a list", "f:{[a] |r:1; r+a}", "x", "f:{[a] x:1; x+a}"],
  ];
  for (const [name, marked, to, expected] of cases) {
    test(name, () => assert.strictEqual(renamed(marked, to), expected));
  }

  for (const [ending, eol] of Object.entries(endings)) {
    test(`over several lines: ${ending}`, () =>
      assert.strictEqual(
        renamed(`f:{[t;n]${eol}  r:n#|t;${eol}  r,count t}`, "tab"),
        `f:{[tab;n]${eol}  r:n#tab;${eol}  r,count tab}`,
      ));
    test(`implicit, over several lines: ${ending}`, () =>
      assert.strictEqual(
        renamed(`f:{${eol}  |x*y}`, "a"),
        `f:{[a;y]${eol}  a*y}`,
      ));
  }
});

suite("parameters and locals in the editor", () => {
  let document: vscode.TextDocument;
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
    document = await vscode.workspace.openTextDocument({
      language: "q",
      content: "f:{[t;n] r:n#t; r,count r}\ng:{x*y}",
    });
  });

  test("semantic tokens", async () => {
    const legend =
      await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
        "vscode.provideDocumentSemanticTokensLegend",
        document.uri,
      );
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      document.uri,
    );
    // Five numbers a token: line and column from the last, length, type
    // and modifiers
    const out: string[] = [];
    let line = 0;
    let column = 0;
    for (let i = 0; i < tokens.data.length; i += 5) {
      const [dl, dc, length, type] = tokens.data.slice(i, i + 4);
      line += dl;
      column = dl ? dc : column + dc;
      const name = document.getText(
        new vscode.Range(line, column, line, column + length),
      );
      out.push(`${line}:${name} ${legend.tokenTypes[type]}`);
    }
    assert.deepStrictEqual(out, [
      "0:t parameter",
      "0:n parameter",
      "0:r variable",
      "0:n parameter",
      "0:t parameter",
      "0:r variable",
      "0:r variable",
      "1:x parameter",
      "1:y parameter",
    ]);
  });

  test("rename", async () => {
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      "vscode.executeDocumentRenameProvider",
      document.uri,
      new vscode.Position(0, 9),
      "rows",
    );
    assert.deepStrictEqual(
      edit.get(document.uri).map((e) => [e.range.start.character, e.newText]),
      [
        [9, "rows"],
        [16, "rows"],
        [24, "rows"],
      ],
    );
  });

  test("rename an implicit parameter", async () => {
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      "vscode.executeDocumentRenameProvider",
      document.uri,
      new vscode.Position(1, 3),
      "price",
    );
    const text = document.getText();
    let out = text;
    for (const e of [...edit.get(document.uri)].reverse()) {
      const start = document.offsetAt(e.range.start);
      const end = document.offsetAt(e.range.end);
      out = out.slice(0, start) + e.newText + out.slice(end);
    }
    assert.strictEqual(out.split("\n")[1], "g:{[price;y] price*y}");
  });

  test("rename refused", async () => {
    await assert.rejects(
      async () =>
        vscode.commands.executeCommand(
          "vscode.executeDocumentRenameProvider",
          document.uri,
          new vscode.Position(0, 0),
          "h",
        ),
      /only locals and parameters can be renamed/,
    );
  });
});
