import * as assert from "node:assert";
import * as vscode from "vscode";
import { annotate } from "../annotate";
import { locals } from "../locals";

const endings = { LF: "\n", CRLF: "\r\n", CR: "\r" };

// Each parameter and local as "name kind", in order
function shown(text: string): string[] {
  return locals(annotate(text)).map(
    (o) =>
      `${text.slice(o.start, o.end)} ${o.param ? "parameter" : "variable"}`,
  );
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
      "not the column delete names, as q reads that as a name",
      "f:{[t;p] delete p from t where c>p}",
      ["t parameter", "p parameter", "t parameter", "p parameter"],
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
});
