// q language features in the editor, from the annotation pass: the outline
// (and breadcrumbs) and occurrence highlighting within a file, and
// definition, references, hover, parameter hints, completion and symbol
// search across the workspace's q files, parameters, locals and where as
// the function highlighted, the files a \l may load, references in the
// References view grouped by how they're passed

import * as vscode from "vscode";
import { type Annotated, annotate } from "./annotate";
import { type Completion, completions } from "./completion";
import { lineOf, lineStarts } from "./lines";
import {
  type Occurrence,
  type Outlined,
  occurrences,
  outline,
  type Span,
} from "./navigation";
import { type Found, ReferencesView } from "./referencesView";
import { semanticTokens } from "./semantic";
import { syntaxErrors } from "./syntax";
import {
  definitions,
  type Entry,
  entry,
  hover,
  type Index,
  type Listed,
  type Location,
  loaded,
  position,
  references,
  signatures,
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

const diagnosticMode = "kdb-q-ext-vscode.diagnosticMode";

const workspaceWide = () =>
  vscode.workspace.getConfiguration().get(diagnosticMode) === "workspace";

// Files and untitled documents, not a diff's original, as git: has it
const checked = new Set(["file", "untitled"]);

// The documents in the editor's tabs, by URI; a diff's, the side edited
function tabbed(): Map<string, vscode.Uri> {
  const out = new Map<string, vscode.Uri>();
  for (const group of vscode.window.tabGroups.all) {
    for (const { input } of group.tabs) {
      const uri =
        input instanceof vscode.TabInputText
          ? input.uri
          : input instanceof vscode.TabInputTextDiff
            ? input.modified
            : undefined;
      if (uri) out.set(uri.toString(), uri);
    }
  }
  return out;
}

// Positions in a file's saved text, by VS Code's lines
function positions(text: string): (offset: number) => vscode.Position {
  const starts = lineStarts(text);
  return (offset) => {
    const line = lineOf(starts, offset);
    return new vscode.Position(line, offset - starts[line]);
  };
}

// Syntax errors in VS Code's Problems: each q document open in a tab as it's
// typed, and, in workspace mode, each workspace file's as the index reads it.
// A document opened without a tab, as for a preview of references, is the
// index's, not open to the user. A tab VS Code hasn't loaded yet, as those
// behind the active one as VS Code starts, shows its q file as saved
class Problems implements vscode.Disposable {
  private readonly collection =
    vscode.languages.createDiagnosticCollection("q");
  // q documents open in tabs, by URI, which show their own text as typed
  private readonly open = new Map<string, vscode.TextDocument>();
  // Tabs of q files not loaded yet, by URI
  private readonly unloaded = new Set<string>();
  // Checks waiting for typing to pause, by URI
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[];
  // A document no longer open in a tab, for the index to show as it has it
  left: (uri: vscode.Uri) => void = () => undefined;

  constructor() {
    const refresh = () => this.refresh();
    this.disposables = [
      this.collection,
      vscode.window.tabGroups.onDidChangeTabs(refresh),
      vscode.workspace.onDidOpenTextDocument(refresh),
      vscode.workspace.onDidCloseTextDocument(refresh),
      vscode.workspace.onDidChangeTextDocument(({ document: d }) => {
        const key = d.uri.toString();
        if (!this.open.has(key)) return;
        clearTimeout(this.waiting.get(key));
        this.waiting.set(
          key,
          setTimeout(() => {
            this.waiting.delete(key);
            this.check(d);
          }, 250),
        );
      }),
    ];
    this.refresh();
  }

  // Checks each q document newly in a tab, and lets go of each that left
  private refresh() {
    const tabs = tabbed();
    const now = new Map<string, vscode.TextDocument>();
    const loaded = new Set<string>();
    for (const d of vscode.workspace.textDocuments) {
      const key = d.uri.toString();
      if (d.isClosed || !tabs.has(key)) continue;
      loaded.add(key);
      if (d.languageId === "q" && checked.has(d.uri.scheme)) now.set(key, d);
    }
    for (const [key, d] of this.open) {
      if (now.get(key) === d) continue;
      this.open.delete(key);
      clearTimeout(this.waiting.get(key));
      this.waiting.delete(key);
      // A document closed, the index reads again itself
      this.release(d.uri, !d.isClosed);
    }
    for (const key of [...this.unloaded]) {
      if (tabs.has(key) && !loaded.has(key)) continue;
      this.unloaded.delete(key);
      if (!now.has(key)) this.release(vscode.Uri.parse(key), true);
    }
    for (const [key, d] of now) {
      if (this.open.has(key)) continue;
      this.open.set(key, d);
      this.check(d);
    }
    for (const [key, uri] of tabs) {
      if (loaded.has(key) || this.unloaded.has(key)) continue;
      if (uri.scheme !== "file" || !uri.path.endsWith(".q")) continue;
      this.unloaded.add(key);
      vscode.workspace.fs.readFile(uri).then(
        (bytes) => this.file(uri, new TextDecoder().decode(bytes)),
        () => undefined,
      );
    }
  }

  // A tab let go of: its problems go, and the index may show its file's
  private release(uri: vscode.Uri, reread: boolean) {
    this.collection.delete(uri);
    if (reread) this.left(uri);
  }

  private check(d: vscode.TextDocument) {
    if (d.isClosed) return;
    this.show(d.uri, d.getText(), (offset) => d.positionAt(offset));
  }

  private show(
    uri: vscode.Uri,
    text: string,
    at: (offset: number) => vscode.Position,
  ) {
    const range = (s: { start: number; end: number }) =>
      new vscode.Range(at(s.start), at(s.end));
    this.collection.set(
      uri,
      syntaxErrors(text).map((p) => {
        const d = new vscode.Diagnostic(
          range(p),
          p.message,
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "q";
        if (p.related) {
          d.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(uri, range(p.related)),
              p.related.message,
            ),
          ];
        }
        return d;
      }),
    );
  }

  // A file as saved, or as a document not in a tab has it, or without its
  // text when it's gone. A document in a tab shows its own; a tab not
  // loaded yet, its file's, in either mode
  file(uri: vscode.Uri, text?: string) {
    const key = uri.toString();
    if (this.open.has(key)) return;
    if (text === undefined || !(workspaceWide() || this.unloaded.has(key))) {
      this.collection.delete(uri);
      return;
    }
    this.show(uri, text, positions(text));
  }

  // Back to open files only
  narrow() {
    const shut: vscode.Uri[] = [];
    this.collection.forEach((uri) => {
      const key = uri.toString();
      if (!this.open.has(key) && !this.unloaded.has(key)) shut.push(uri);
    });
    for (const uri of shut) this.collection.delete(uri);
  }

  dispose() {
    for (const t of this.waiting.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
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
// them, and reads an open document's latest text when it's asked. Each file
// it reads, and each it drops, goes to the problems, for workspace mode
class Workspace implements vscode.Disposable {
  private readonly files = new Map<string, Entry>();
  private readonly edited = new Set<vscode.TextDocument>();
  private done: Promise<void> = Promise.resolve();
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly problems: Problems) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.q");
    // Folders too, as a folder deleted or moved may be reported without
    // the files in it
    const anything = vscode.workspace.createFileSystemWatcher(
      "**",
      false,
      true,
    );
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
      anything,
      // A folder moved here may come without its q files: once creating
      // pauses, if any was a folder, every q file the index hasn't got, as
      // a checkout or a build may create many
      anything.onDidCreate((uri) => {
        if (uri.path.endsWith(".q")) return;
        this.created.push(uri);
        clearTimeout(this.creating);
        this.creating = setTimeout(() => this.folders(), 250);
      }),
      // The file, or every file in the folder, after the reads before it
      anything.onDidDelete((uri) => {
        const key = uri.toString();
        this.queue(async () => {
          for (const file of [...this.files.keys()]) {
            if (file === key || file.startsWith(`${key}/`)) {
              this.files.delete(file);
              this.problems.file(vscode.Uri.parse(file));
            }
          }
        });
      }),
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
      // Files excluded or included, or every file's problems wanted
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("files.exclude") ||
          (e.affectsConfiguration(diagnosticMode) && workspaceWide())
        ) {
          this.queue(() => this.build());
        } else if (e.affectsConfiguration(diagnosticMode)) {
          this.problems.narrow();
        }
      }),
    ];
    // A document out of its tab, as the index now has it
    problems.left = (uri) => {
      if (this.files.has(uri.toString())) this.queue(() => this.read(uri));
    };
    this.queue(() => this.build());
  }

  // Paths created since creating last paused, and the timer for the pause
  private created: vscode.Uri[] = [];
  private creating: ReturnType<typeof setTimeout> | undefined;

  private async folders() {
    const created = this.created;
    this.created = [];
    const types = await Promise.all(
      created.map((uri) =>
        vscode.workspace.fs.stat(uri).then(
          (s) => s.type,
          () => vscode.FileType.Unknown,
        ),
      ),
    );
    if (!types.some((t) => t & vscode.FileType.Directory)) return;
    this.queue(async () => {
      const uris = await vscode.workspace.findFiles("**/*.q");
      for (const u of uris) {
        if (!this.files.has(u.toString())) await this.read(u);
      }
    });
  }

  private queue(f: () => Promise<void>) {
    this.done = this.done.then(f).catch(() => undefined);
  }

  private async build() {
    const before = [...this.files.keys()];
    this.files.clear();
    const uris = await vscode.workspace.findFiles("**/*.q");
    // A few at a time, so a large workspace doesn't open every file at once
    for (let i = 0; i < uris.length; i += 64) {
      await Promise.all(uris.slice(i, i + 64).map((u) => this.read(u)));
    }
    for (const key of before) {
      if (!this.files.has(key)) this.problems.file(vscode.Uri.parse(key));
    }
  }

  private async read(uri: vscode.Uri, open = true) {
    const key = uri.toString();
    const document =
      open &&
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (document) {
      this.files.set(key, entryOf(document));
      this.problems.file(uri, document.getText());
      return;
    }
    try {
      const text = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(uri),
      );
      this.files.set(key, entry(text, annotate(text)));
      this.problems.file(uri, text);
    } catch {
      this.files.delete(key);
      this.problems.file(uri);
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
    clearTimeout(this.creating);
    for (const d of this.disposables) d.dispose();
  }
}

const kinds: Record<Outlined["kind"], vscode.SymbolKind> = {
  namespace: vscode.SymbolKind.Namespace,
  function: vscode.SymbolKind.Function,
  variable: vscode.SymbolKind.Variable,
  module: vscode.SymbolKind.Module,
};

const completionKinds: Record<Completion["kind"], vscode.CompletionItemKind> = {
  param: vscode.CompletionItemKind.Variable,
  local: vscode.CompletionItemKind.Variable,
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  module: vscode.CompletionItemKind.Module,
  namespace: vscode.CompletionItemKind.Module,
  keyword: vscode.CompletionItemKind.Keyword,
  hook: vscode.CompletionItemKind.Event,
};

const highlights: Record<Occurrence["kind"], vscode.DocumentHighlightKind> = {
  read: vscode.DocumentHighlightKind.Read,
  write: vscode.DocumentHighlightKind.Write,
  text: vscode.DocumentHighlightKind.Text,
};

// Parameters and locals, each a token of its own type; a local is drawn
// in the parameter's colour by the scope package.json maps it to, so a
// lambda's own names stand apart from globals. where as the function is
// q's own, drawn as a built-in by its scope there
const legend = new vscode.SemanticTokensLegend(
  ["parameter", "variable", "function"],
  ["defaultLibrary"],
);

// Runs from a hover's link: the definitions of the name at the position,
// in the peek, given back for tests
const peekDefinitions = "kdb-q-ext-vscode.peekDefinitions";

// q code in a block, as written: fenced by more backticks than any run in
// it, wherever the run is, as a fence indented up to three spaces closes a
// block too, and VS Code's appendCodeblock looks only at a line's start
function codeblock(out: vscode.MarkdownString, code: string): void {
  let longest = 2;
  for (const [run] of code.matchAll(/`+/g)) {
    longest = Math.max(longest, run.length);
  }
  const fence = "`".repeat(longest + 1);
  out.appendMarkdown(`\n${fence}q\n${code}\n${fence}\n`);
}

// How a definition reads in a hover, as the hint has it: its signature, or
// its name, then the comment above it as written, each in a q block; then
// the file it's in, if it's another, its path as text
function described(
  out: vscode.MarkdownString,
  d: Listed,
  from: vscode.Uri,
  index: Index,
): void {
  const signature =
    d.kind === "function"
      ? `${d.full}${d.detail}`
      : d.kind === "module"
        ? `${d.full}:${d.detail}`
        : d.full;
  codeblock(out, signature);
  if (d.doc !== undefined) codeblock(out, d.doc);
  linked(out, d, from, index);
}

// The file a definition is in, if it's another, its path as text linking
// to the definition
function linked(
  out: vscode.MarkdownString,
  d: Listed,
  from: vscode.Uri,
  index: Index,
): void {
  if (d.file !== from.toString()) {
    const uri = vscode.Uri.parse(d.file);
    const { line, character } = position(
      index.get(d.file) as Entry,
      d.nameSpan.start,
    );
    const at = uri.with({ fragment: `L${line + 1},${character + 1}` });
    out.appendMarkdown("\n\n[");
    out.appendText(vscode.workspace.asRelativePath(uri));
    out.appendMarkdown(`](<${at}>)`);
  }
}

// A completion, with what its documentation is made from when it's shown
class Suggested extends vscode.CompletionItem {
  constructor(
    readonly completion: Completion,
    readonly from: vscode.Uri,
    readonly index: Index,
  ) {
    super(completion.label);
  }
}

export function registerLanguage(): vscode.Disposable {
  const selector: vscode.DocumentSelector = { language: "q" };
  const range = (d: vscode.TextDocument, { start, end }: Span) =>
    new vscode.Range(d.positionAt(start), d.positionAt(end));
  const symbol = (d: vscode.TextDocument, o: Outlined) => {
    const s = new vscode.DocumentSymbol(
      o.name,
      o.detail ?? "",
      kinds[o.kind],
      range(d, o.span),
      range(d, o.nameSpan),
    );
    s.children = (o.children ?? []).map((c) => symbol(d, c));
    return s;
  };
  const problems = new Problems();
  const workspace = new Workspace(problems);
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
    problems,
    workspace,
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (d) =>
        outline(d.getText(), annotations(d)).map((o) => symbol(d, o)),
    }),
    vscode.languages.registerDocumentHighlightProvider(selector, {
      provideDocumentHighlights: (d, position) =>
        occurrences(annotations(d), d.offsetAt(position)).map(
          (o) => new vscode.DocumentHighlight(range(d, o), highlights[o.kind]),
        ),
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      {
        provideDocumentSemanticTokens: (d) => {
          const tokens = new vscode.SemanticTokensBuilder(legend);
          for (const t of semanticTokens(annotations(d))) {
            tokens.push(
              range(d, t),
              t.kind,
              t.kind === "function" ? ["defaultLibrary"] : [],
            );
          }
          return tokens.build();
        },
      },
      legend,
    ),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: async (d, position) => {
        const index = await workspace.index(d);
        const offset = d.offsetAt(position);
        const a = annotations(d);
        // A \l's files, as links from its whole path, as Cmd+hover underlines
        const load = loaded(index, a, offset);
        if (load) {
          return load.files.map(
            (f): vscode.LocationLink => ({
              originSelectionRange: range(d, load.path),
              targetUri: vscode.Uri.parse(f),
              targetRange: new vscode.Range(0, 0, 0, 0),
            }),
          );
        }
        return definitions(index, d.uri.toString(), a, offset).map((l) =>
          location(index, l),
        );
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
        const shown = hover(index, d.uri.toString(), annotations(d), offset);
        if (!shown) return undefined;
        const { name, builtin, defined } = shown;
        // q in code blocks, KX's line and a path as text, escaped by VS Code
        const out = new vscode.MarkdownString();
        if (builtin) {
          codeblock(out, builtin.syntax);
          out.appendText(builtin.summary);
          out.appendMarkdown(`\n\n[code.kx.com](<${builtin.url}>)`);
        }
        if (builtin && defined.length) out.appendMarkdown("\n\n---\n");
        if (defined.length) described(out, defined[0], d.uri, index);
        // The peek lists the same
        const more = defined.length - 1;
        if (more > 0) {
          const args = encodeURIComponent(
            JSON.stringify([d.uri.toString(), at.line, at.character]),
          );
          out.appendMarkdown(
            `\n\n[${more} more definition${more === 1 ? "" : "s"}](command:${peekDefinitions}?${args})`,
          );
          out.isTrusted = { enabledCommands: [peekDefinitions] };
        }
        return new vscode.Hover(out, range(d, name));
      },
    }),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      {
        provideSignatureHelp: async (d, at, _token, context) => {
          const index = await workspace.index(d);
          const found = signatures(
            index,
            d.uri.toString(),
            annotations(d),
            d.offsetAt(at),
          );
          if (!found) return undefined;
          const help = new vscode.SignatureHelp();
          help.signatures = found.signatures.map((s) => {
            // As the hover has them: KX's line and link, or the comment
            // above the definition, as written, and its file if another
            const doc = new vscode.MarkdownString();
            if ("builtin" in s) {
              doc.appendText(s.builtin.summary);
              doc.appendMarkdown(`\n\n[code.kx.com](<${s.builtin.url}>)`);
            } else {
              if (s.defined.doc !== undefined) codeblock(doc, s.defined.doc);
              linked(doc, s.defined, d.uri, index);
            }
            const info = new vscode.SignatureInformation(
              s.label,
              doc.value ? doc : undefined,
            );
            info.parameters = s.params.map(
              (p) => new vscode.ParameterInformation(p),
            );
            return info;
          });
          help.activeParameter = found.active;
          // The form the user moved to, if it's still there
          const before = context.activeSignatureHelp;
          const kept = before?.activeSignature ?? 0;
          help.activeSignature =
            context.isRetrigger &&
            before?.signatures[kept]?.label === help.signatures[kept]?.label
              ? kept
              : 0;
          return help;
        },
      },
      { triggerCharacters: ["[", ";"], retriggerCharacters: [] },
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: async (d, at) => {
          const index = await workspace.index(d);
          const found = completions(
            index,
            d.uri.toString(),
            d.getText(),
            annotations(d),
            d.offsetAt(at),
          );
          if (!found) return undefined;
          const inserting = range(d, found.inserting);
          const replacing = range(d, found.replacing);
          return found.items.map((c) => {
            const item = new Suggested(c, d.uri, index);
            item.kind = completionKinds[c.kind];
            item.range = { inserting, replacing };
            item.sortText = `${c.group}${c.label}`;
            item.detail = c.builtin?.summary ?? c.defined?.detail;
            return item;
          });
        },
        // As the hover has it: q's syntax, KX's line and link, then your
        // own definition, its comment and file; only for the item shown
        resolveCompletionItem: (item) => {
          if (!(item instanceof Suggested)) return item;
          const { completion: c, from, index } = item;
          const doc = new vscode.MarkdownString();
          if (c.builtin) {
            codeblock(doc, c.builtin.syntax);
            doc.appendMarkdown(`\n\n[code.kx.com](<${c.builtin.url}>)`);
          }
          if (c.builtin && c.defined) doc.appendMarkdown("\n\n---\n");
          if (c.defined) described(doc, c.defined, from, index);
          if (doc.value) item.documentation = doc;
          return item;
        },
      },
      ".",
    ),
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
              location(index, { file: s.file, ...s.nameSpan }),
            ),
        );
      },
    }),
  );
}
