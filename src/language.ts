// q language features in the editor, from the annotation pass: the outline
// (and breadcrumbs), occurrence highlighting, and definition and references
// within a file

import * as vscode from "vscode";
import { type Annotated, annotate } from "./annotate";
import { definition, type Outlined, occurrences, outline } from "./navigation";

// The latest annotations of each open document, as each feature reads them
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
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: (d, position) => {
        const found = definition(annotations(d), d.offsetAt(position));
        return (
          found && new vscode.Location(d.uri, range(d, found.start, found.end))
        );
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences: (d, position, context) => {
        const a = annotations(d);
        const offset = d.offsetAt(position);
        const defined = definition(a, offset);
        return occurrences(a, offset)
          .filter(
            (o) => context.includeDeclaration || o.start !== defined?.start,
          )
          .map((o) => new vscode.Location(d.uri, range(d, o.start, o.end)));
      },
    }),
  );
}
