// q language features in the editor, from the annotation pass: the outline
// (and breadcrumbs) and occurrence highlighting

import * as vscode from "vscode";
import { type Annotated, annotate } from "./annotate";
import { type Outlined, occurrences, outline } from "./navigation";

// The latest annotations of each open document, as both features read them
const annotated = new WeakMap<
  vscode.TextDocument,
  { version: number; a: Annotated }
>();

function annotations(document: vscode.TextDocument): Annotated {
  const cached = annotated.get(document);
  if (cached?.version === document.version) return cached.a;
  const a = annotate(document.getText());
  annotated.set(document, { version: document.version, a });
  return a;
}

const kinds: Record<Outlined["kind"], vscode.SymbolKind> = {
  namespace: vscode.SymbolKind.Namespace,
  function: vscode.SymbolKind.Function,
  variable: vscode.SymbolKind.Variable,
  module: vscode.SymbolKind.Module,
};

const highlights: Record<
  ReturnType<typeof occurrences>[number]["kind"],
  vscode.DocumentHighlightKind
> = {
  read: vscode.DocumentHighlightKind.Read,
  write: vscode.DocumentHighlightKind.Write,
  text: vscode.DocumentHighlightKind.Text,
};

export function registerLanguage(): vscode.Disposable {
  const selector: vscode.DocumentSelector = { language: "q" };
  const range = (d: vscode.TextDocument, start: number, end: number) =>
    new vscode.Range(d.positionAt(start), d.positionAt(end));
  const symbol = (d: vscode.TextDocument, o: Outlined) => {
    const s = new vscode.DocumentSymbol(
      o.name,
      o.detail ?? "",
      kinds[o.kind],
      range(d, o.start, o.end),
      range(d, o.nameStart, o.nameEnd),
    );
    s.children = (o.children ?? []).map((c) => symbol(d, c));
    return s;
  };
  return vscode.Disposable.from(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (d) =>
        outline(d.getText(), annotations(d)).map((o) => symbol(d, o)),
    }),
    vscode.languages.registerDocumentHighlightProvider(selector, {
      provideDocumentHighlights: (d, position) =>
        occurrences(annotations(d), d.offsetAt(position)).map(
          (o) =>
            new vscode.DocumentHighlight(
              range(d, o.start, o.end),
              highlights[o.kind],
            ),
        ),
    }),
  );
}
