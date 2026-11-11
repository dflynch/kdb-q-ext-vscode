// Parameter hints over the q files copied into the test folder, as VS Code
// asks for them: each form, its parameters, its documentation, and the
// parameter the cursor is at
import * as assert from "node:assert";
import * as vscode from "vscode";

const file = (path: string) => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return vscode.Uri.joinPath(f.uri, "index", path);
};

// The hint at a line and column from 1: each signature as its label with
// its parameters in «», then its documentation; and the active ones
async function hinted(d: vscode.TextDocument, line: number, column: number) {
  const help = await vscode.commands.executeCommand<
    vscode.SignatureHelp | undefined
  >(
    "vscode.executeSignatureHelpProvider",
    d.uri,
    new vscode.Position(line - 1, column - 1),
    "[",
  );
  if (!help) return undefined;
  return {
    signatures: help.signatures.map((s) => {
      let label = "";
      let at = 0;
      for (const p of s.parameters) {
        const [start, end] = p.label as [number, number];
        label += `${s.label.slice(at, start)}«${s.label.slice(start, end)}»`;
        at = end;
      }
      label += s.label.slice(at);
      const doc =
        typeof s.documentation === "string"
          ? s.documentation
          : (s.documentation?.value ?? "");
      // Without the folder's own path, which differs from run to run
      return `${label} ${doc.replaceAll(file("").toString(), "…/")}`.trim();
    }),
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
  };
}

const untitled = (content: string) =>
  vscode.workspace.openTextDocument({ language: "q", content });

suite("parameter hints", () => {
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("dflynch3.kdb-q-ext-vscode")
      ?.activate();
  });

  test("a function in another file: its parameters and file", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/main.q"));
    assert.deepStrictEqual(await hinted(d, 3, 11), {
      signatures: [
        ".u.upd[«t»;«x»] \n\n[index/code/wdb.q](<…//code/wdb.q#L3%2C1>)",
      ],
      activeSignature: 0,
      activeParameter: 1,
    });
  });

  test("a function in the file itself", async () => {
    const d = await vscode.workspace.openTextDocument(file("code/wdb.q"));
    assert.deepStrictEqual(await hinted(d, 5, 17), {
      signatures: [".u.upd[«t»;«x»]"],
      activeSignature: 0,
      activeParameter: 0,
    });
  });

  test("the comment above, as written", async () => {
    const d = await untitled("/ adds\n/ two\nf:{[a;b] a+b}\nf[1;]");
    assert.deepStrictEqual(await hinted(d, 4, 5), {
      signatures: ["f[«a»;«b»] \n```q\n/ adds\n/ two\n```"],
      activeSignature: 0,
      activeParameter: 1,
    });
  });

  test("q's own forms, with KX's line", async () => {
    const d = await untitled("hopen[]");
    const kx =
      "open&nbsp;a&nbsp;file\n\n" +
      "[code.kx.com](<https://code.kx.com/q/ref/hopen/>)";
    const shown = await hinted(d, 1, 7);
    assert.deepStrictEqual(shown?.signatures.length, 4);
    assert.deepStrictEqual(shown?.signatures[0], `hopen[«filehandle»] ${kx}`);
  });

  test("an index in a call's arguments: the call's", async () => {
    const d = await untitled("f:{[a;b] a}\nf[1;t[`c]]");
    assert.deepStrictEqual((await hinted(d, 2, 9))?.activeParameter, 1);
  });

  test("nothing outside a call", async () => {
    const d = await untitled("f:{[a;b] a}\nf[1;2] ");
    assert.strictEqual(await hinted(d, 2, 8), undefined);
  });
});
