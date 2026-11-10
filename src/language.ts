// q language features in the editor, from the annotation pass: the outline
// (and breadcrumbs) and occurrence highlighting within a file, and
// definition, references, hover and symbol search across the workspace's q
// files, references in the References view grouped by how they're passed

import * as vscode from "vscode";
import { type Annotated, annotate } from "./annotate";
import {
  type Occurrence,
  type Outlined,
  occurrences,
  outline,
} from "./navigation";
import { type Found, ReferencesView } from "./referencesView";
import {
  definitions,
  type Entry,
  entry,
  hover,
  type Index,
  type Listed,
  type Location,
  position,
  references,
  symbols,
} from "./workspaceIndex";

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

const entries = new WeakMap<
  vscode.TextDocument,
  { version: number; e: Entry }
>();

function entryOf(document: vscode.TextDocument): Entry {
  const cached = entries.get(document);
  if (cached?.version === document.version) return cached.e;
  const e = entry(document.getText(), annotations(document));
  entries.set(document, { version: document.version, e });
  return e;
}

// Whether findFiles finds the file, as it applies files.exclude
async function included(uri: vscode.Uri): Promise<boolean> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return false;
  // Each character literal, as a glob would read [, {, * or ? in a name
  const glob = vscode.workspace
    .asRelativePath(uri, false)
    .replace(/[[{}*?]/g, "[$&]");
  const found = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, glob),
    undefined,
    1,
  );
  return found.length > 0;
}

// The workspace's q files, each as its open document has it, else as it's
// saved; files.exclude leaves some out, as Explorer does. Built in the
// background, as is each change on disk, in turn; each request waits for
// them, and reads an open document's latest text when it's asked
class Workspace implements vscode.Disposable {
  private readonly files = new Map<string, Entry>();
  private readonly edited = new Set<vscode.TextDocument>();
  private done: Promise<void> = Promise.resolve();
  private readonly disposables: vscode.Disposable[];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.q");
    // A file new to the index only if findFiles would find it, as
    // files.exclude may leave it out
    const read = (uri: vscode.Uri) =>
      this.queue(async () => {
        if (this.files.has(uri.toString()) || (await included(uri))) {
          await this.read(uri);
        }
      });
    this.disposables = [
      watcher,
      watcher.onDidCreate(read),
      watcher.onDidChange(read),
      watcher.onDidDelete((uri) =>
        this.queue(async () => {
          this.files.delete(uri.toString());
        }),
      ),
      // Its text, rather than the file's, as it may differ, as when a
      // document left unsaved is opened as VS Code starts
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (this.files.has(document.uri.toString())) {
          this.edited.add(document);
        }
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (this.files.has(document.uri.toString())) {
          this.edited.add(document);
        }
      }),
      // Back to the file as it's saved, even if the document wasn't
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.edited.delete(document);
        const key = document.uri.toString();
        if (this.files.has(key)) {
          this.queue(() => this.read(document.uri, false));
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.queue(() => this.build()),
      ),
    ];
    this.queue(() => this.build());
  }

  private queue(f: () => Promise<void>) {
    this.done = this.done.then(f).catch(() => undefined);
  }

  private async build() {
    this.files.clear();
    const uris = await vscode.workspace.findFiles("**/*.q");
    // A few at a time, so a large workspace doesn't open every file at once
    for (let i = 0; i < uris.length; i += 64) {
      await Promise.all(uris.slice(i, i + 64).map((u) => this.read(u)));
    }
  }

  private async read(uri: vscode.Uri, open = true) {
    const key = uri.toString();
    const document =
      open &&
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (document) {
      this.files.set(key, entryOf(document));
      return;
    }
    try {
      const text = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(uri),
      );
      this.files.set(key, entry(text, annotate(text)));
    } catch {
      this.files.delete(key);
    }
  }

  // Every file, with the document asked from, if any, even if it's not one
  // of them
  async index(document?: vscode.TextDocument): Promise<Index> {
    await this.done;
    for (const d of this.edited) this.files.set(d.uri.toString(), entryOf(d));
    this.edited.clear();
    if (!document) return this.files;
    const key = document.uri.toString();
    if (this.files.has(key)) {
      this.files.set(key, entryOf(document));
      return this.files;
    }
    return new Map(this.files).set(key, entryOf(document));
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}

const kinds: Record<Outlined["kind"], vscode.SymbolKind> = {
  namespace: vscode.SymbolKind.Namespace,
  function: vscode.SymbolKind.Function,
  variable: vscode.SymbolKind.Variable,
  module: vscode.SymbolKind.Module,
};

const highlights: Record<Occurrence["kind"], vscode.DocumentHighlightKind> = {
  read: vscode.DocumentHighlightKind.Read,
  write: vscode.DocumentHighlightKind.Write,
  text: vscode.DocumentHighlightKind.Text,
};

// Runs from a hover's link: the definitions of the name at the position,
// in the peek, given back for tests
const peekDefinitions = "kdb-q-ext-vscode.peekDefinitions";

// Text in markdown as written: its punctuation escaped, each line its own.
// A URL as a link, without the punctuation that ends a sentence after it
const escaped = (text: string) =>
  text.replace(/[\\`*_{}[\]()<>#+\-=.!|~&]/g, "\\$&");
export const plain = (text: string) =>
  text
    .split("\n")
    .map((l) =>
      l
        .split(/(\b(?:https?|ftp):\/\/[^\s<>]+)/)
        .map((part, i) => {
          if (i % 2 === 0) return escaped(part);
          const url = part.replace(/[.,;:!?'")\]]+$/, "");
          return `<${url}>${escaped(part.slice(url.length))}`;
        })
        .join(""),
    )
    .join("  \n");

// Code in a q block: neither a signature nor q's syntax has a line of
// backticks to end it early
const code = (text: string) => `\`\`\`q\n${text}\n\`\`\``;

// How a definition reads in a hover: its signature, or its name, then its
// comment as written, and the file it's in if it's another
function described(d: Listed, from: vscode.Uri, index: Index): string[] {
  const signature =
    d.kind === "function"
      ? `${d.full}${d.detail}`
      : d.kind === "module"
        ? `${d.full}:${d.detail}`
        : d.full;
  const out = [code(signature)];
  if (d.doc !== undefined) out.push(plain(d.doc));
  if (d.file !== from.toString()) {
    const uri = vscode.Uri.parse(d.file);
    const { line, character } = position(
      index.get(d.file) as Entry,
      d.nameStart,
    );
    const at = uri.with({ fragment: `L${line + 1},${character + 1}` });
    out.push(`[${plain(vscode.workspace.asRelativePath(uri))}](${at})`);
  }
  return out;
}

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
  const workspace = new Workspace();
  const location = (index: Index, l: Location) => {
    const e = index.get(l.file) as Entry;
    const { line, character } = position(e, l.start);
    const end = position(e, l.end);
    return new vscode.Location(
      vscode.Uri.parse(l.file),
      new vscode.Range(line, character, end.line, end.character),
    );
  };
  const found = async (
    d: vscode.TextDocument,
    at: vscode.Position,
    withDefinition: boolean,
  ): Promise<Found[]> => {
    const index = await workspace.index(d);
    return references(
      index,
      d.uri.toString(),
      annotations(d),
      d.offsetAt(at),
      withDefinition,
    ).map((r) => ({ ...r, location: location(index, r) }));
  };
  // As VS Code's Find All References asks, with each definition
  const view = new ReferencesView((d, at) => found(d, at, true));
  return vscode.Disposable.from(
    workspace,
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
      provideDefinition: async (d, position) => {
        const index = await workspace.index(d);
        return definitions(
          index,
          d.uri.toString(),
          annotations(d),
          d.offsetAt(position),
        ).map((l) => location(index, l));
      },
    }),
    view,
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences: async (d, position, context) => {
        const out = await found(d, position, context.includeDeclaration);
        view.offer(d.uri, position, out);
        return out.map((r) => r.location);
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover: async (d, at) => {
        const index = await workspace.index(d);
        const offset = d.offsetAt(at);
        const found = hover(index, d.uri.toString(), annotations(d), offset);
        if (!found) return undefined;
        const { builtin, defined } = found;
        const parts: string[] = [];
        if (builtin) {
          parts.push(
            code(builtin.syntax),
            plain(builtin.summary),
            `[code.kx.com](${builtin.url})`,
          );
        }
        if (builtin && defined.length) parts.push("---");
        if (defined.length) parts.push(...described(defined[0], d.uri, index));
        const out = new vscode.MarkdownString();
        // As many as the peek lists, as an export's may differ
        const more =
          defined.length &&
          definitions(index, d.uri.toString(), annotations(d), offset).length -
            1;
        if (more > 0) {
          const args = encodeURIComponent(
            JSON.stringify([d.uri.toString(), at.line, at.character]),
          );
          parts.push(
            `[${more} more definition${more === 1 ? "" : "s"}](command:${peekDefinitions}?${args})`,
          );
          out.isTrusted = { enabledCommands: [peekDefinitions] };
        }
        out.appendMarkdown(parts.join("\n\n"));
        return new vscode.Hover(out);
      },
    }),
    vscode.commands.registerCommand(
      peekDefinitions,
      async (uri: string, line: number, character: number) => {
        const d = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uri),
        );
        const at = new vscode.Position(line, character);
        const index = await workspace.index(d);
        const all = definitions(
          index,
          d.uri.toString(),
          annotations(d),
          d.offsetAt(at),
        ).map((l) => location(index, l));
        await vscode.commands.executeCommand(
          "editor.action.peekLocations",
          d.uri,
          at,
          all,
          "peek",
        );
        return all;
      },
    ),
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async (query) => {
        const active = vscode.window.activeTextEditor?.document;
        const index = await workspace.index(
          active?.languageId === "q" ? active : undefined,
        );
        return symbols(index, query).map(
          (s) =>
            new vscode.SymbolInformation(
              s.full,
              kinds[s.kind],
              s.detail ?? "",
              location(index, {
                file: s.file,
                start: s.nameStart,
                end: s.nameEnd,
              }),
            ),
        );
      },
    }),
  );
}
