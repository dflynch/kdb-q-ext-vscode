import * as assert from "node:assert";
import * as vscode from "vscode";
import { annotate } from "../annotate";
import { semanticTokens } from "../semantic";

const endings = { LF: "\n", CRLF: "\r\n", CR: "\r" };

// Each where q reads as a name, as "function" or "clause", in order
function wheres(text: string): string[] {
  const a = annotate(text);
  const fns = new Set(
    semanticTokens(a)
      .filter((t) => t.kind === "function")
      .map((t) => t.start),
  );
  return a.names
    .filter((n) => n.full === "where")
    .map((n) => (fns.has(n.token.start) ? "function" : "clause"));
}

suite("where, the function or a query's clause", () => {
  // As q reads each, checked on q 5
  const cases: [string, string, string[]][] = [
    ["outside a query", "a:where 1 0 1b", ["function"]],
    ["a query's clause", "select from t where b", ["clause"]],
    [
      "in its own clause, after the clause's where",
      "select from t where a in where b",
      ["clause", "function"],
    ],
    ["before from", "select c:where b from t", ["function"]],
    ["exec, before from", "exec where b from t", ["function"]],
    [
      "in brackets in the clause",
      "select from t where a in (where b)",
      ["clause", "function"],
    ],
    [
      "a query in the clause, with its own",
      "select from t where a in exec a from t where b",
      ["clause", "clause"],
    ],
    [
      "a query in brackets, with its own",
      "f[(select from t where b);where c]",
      ["clause", "function"],
    ],
    ["update", "update c:1 from t where b", ["clause"]],
    ["delete", "delete from t where b", ["clause"]],
    [
      "after a query, in the next statement",
      "select from t where b; where c",
      ["clause", "function"],
    ],
    ["in a lambda", "f:{[t] select from t where b}", ["clause"]],
    ["in a lambda, outside its query", "f:{[t] t where x}", ["function"]],
    ["on a continuation line", "f:{select from t\n where b}", ["clause"]],
    ["a string and a comment", 'a:"where" / where', []],
  ];
  for (const [name, text, expected] of cases) {
    for (const [ending, eol] of Object.entries(endings)) {
      test(`${name}: ${ending}`, () =>
        assert.deepStrictEqual(wheres(text.replaceAll("\n", eol)), expected));
    }
  }

  test("with parameters and locals, in order", () =>
    assert.deepStrictEqual(
      semanticTokens(annotate("f:{[t] r:where t; r}")).map((t) => t.kind),
      ["parameter", "variable", "function", "parameter", "variable"],
    ));
});

suite("where in the editor", () => {
  test("the function, as q's own", async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
    const d = await vscode.workspace.openTextDocument({
      language: "q",
      content: "a:where 1 0 1b\nselect from t where b",
    });
    const legend =
      await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
        "vscode.provideDocumentSemanticTokensLegend",
        d.uri,
      );
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      d.uri,
    );
    // One token: line, column, length, type and modifiers
    const [line, column, length, type, modifiers] = tokens.data;
    assert.strictEqual(tokens.data.length, 5);
    assert.deepStrictEqual(
      [
        line,
        column,
        length,
        legend.tokenTypes[type],
        legend.tokenModifiers.filter((_, i) => modifiers & (1 << i)),
      ],
      [0, 2, 5, "function", ["defaultLibrary"]],
    );
  });
});
