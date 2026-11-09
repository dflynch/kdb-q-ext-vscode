// Find All References for q in VS Code's References view, with the results
// that pass a global by reference in a group of their own. Every way into the
// view runs VS Code's own search, which asks our reference provider; the
// provider offers its results here, and if any is passed by reference, its
// input takes the search's place before that draws, as the view drops a
// search another has replaced. The peek, which has no groups, keeps VS Code's
// list

import * as vscode from "vscode";
import {
  type File,
  groupLabel,
  type Item,
  type Node,
  type Result,
  Tree,
} from "./referencesTree";

// The References view's API, as VS Code's references-view extension gives it
type SymbolTree = {
  setInput(input: Input): void;
  getInput(): Input | undefined;
};
type Input = {
  readonly contextValue: string;
  readonly title: string;
  readonly location: vscode.Location;
  resolve(): Promise<Model | undefined>;
  with(location: vscode.Location): Input;
};
type Model = {
  provider: vscode.TreeDataProvider<Node<Found>>;
  readonly message: string | undefined;
  navigation: {
    nearest(
      uri: vscode.Uri,
      position: vscode.Position,
    ): Node<Found> | undefined;
    next(from: Node<Found>): Node<Found>;
    previous(from: Node<Found>): Node<Found>;
    location(item: Node<Found>): vscode.Location | undefined;
  };
  highlights: {
    getEditorHighlights(
      item: Node<Found>,
      uri: vscode.Uri,
    ): vscode.Range[] | undefined;
  };
  dnd: { getDragUri(item: Node<Found>): vscode.Uri | undefined };
  dispose(): void;
};

// The input of VS Code's own Find All References
const search = "vscode.executeReferenceProvider";
const source = "kdb-q-ext-vscode.references";

export type Found = Result & { location: vscode.Location };

type Find = (
  document: vscode.TextDocument,
  position: vscode.Position,
) => Promise<Found[]>;

// The text around a result, as VS Code's list shows it: from the word a few
// characters before, to the end of the line
function preview(
  document: vscode.TextDocument,
  range: vscode.Range,
  before: number,
  trim: boolean,
) {
  const from = range.start.with({
    character: Math.max(0, range.start.character - before),
  });
  const word = document.getWordRangeAtPosition(from);
  let head = document.getText(
    new vscode.Range(word ? word.start : from, range.start),
  );
  const inside = document.getText(range);
  let tail = document.getText(
    new vscode.Range(range.end, range.end.translate(0, 331)),
  );
  if (trim) {
    head = head.replace(/^\s*/, "");
    tail = tail.replace(/\s*$/, "");
  }
  return { head, inside, tail };
}

class Shown {
  private readonly changed = new vscode.EventEmitter<Node<Found> | undefined>();

  constructor(readonly tree: Tree<Found>) {}

  uri(node: Node<Found>): vscode.Uri | undefined {
    return this.tree.items(node)[0]?.result.location.uri;
  }

  model(): Model {
    const tree = this.tree;
    const provider: vscode.TreeDataProvider<Node<Found>> = {
      onDidChangeTreeData: this.changed.event,
      getChildren: (node) => tree.children(node),
      getParent: (node) => tree.parent(node),
      getTreeItem: async (node) => {
        if (node.kind === "group") {
          const item = new vscode.TreeItem(
            groupLabel,
            vscode.TreeItemCollapsibleState.Expanded,
          );
          item.description = `${tree.items(node).length}`;
          item.contextValue = `${source}.group`;
          return item;
        }
        if (node.kind === "file") {
          const item = new vscode.TreeItem(
            this.uri(node) as vscode.Uri,
            vscode.TreeItemCollapsibleState.Collapsed,
          );
          item.description = true;
          item.iconPath = vscode.ThemeIcon.File;
          item.contextValue = `${source}.file`;
          return item;
        }
        const { uri, range } = node.result.location;
        const document = await vscode.workspace.openTextDocument(uri);
        const { head, inside, tail } = preview(document, range, 8, true);
        const item = new vscode.TreeItem({
          label: head + inside + tail,
          highlights: [[head.length, head.length + inside.length]],
        });
        item.contextValue = `${source}.result`;
        item.command = {
          command: "vscode.open",
          title: "Open Reference",
          arguments: [uri, { selection: range.with({ end: range.start }) }],
        };
        return item;
      },
    };
    return {
      provider,
      get message() {
        return tree.message;
      },
      navigation: {
        nearest: (uri, position) => {
          const document = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === uri.toString(),
          );
          return document
            ? tree.nearest(uri.toString(), document.offsetAt(position))
            : tree.items()[0];
        },
        next: (node) => tree.next(node),
        previous: (node) => tree.previous(node),
        location: (node) => tree.items(node)[0]?.result.location,
      },
      highlights: {
        getEditorHighlights: (_, uri) =>
          tree
            .items()
            .filter((i) => i.result.file === uri.toString())
            .map((i) => i.result.location.range),
      },
      dnd: {
        getDragUri: (node) => {
          if (node.kind === "group") return undefined;
          if (node.kind === "file") return this.uri(node);
          const { uri, range } = node.result.location;
          const { start, end } = range;
          return uri.with({
            fragment: `L${start.line + 1},${start.character + 1}-${end.line + 1},${end.character + 1}`,
          });
        },
      },
      dispose: () => this.changed.dispose(),
    };
  }

  remove(node: Node<Found>) {
    this.tree.remove(node);
    this.changed.fire(undefined);
  }

  // As VS Code copies its list: each file's path, then each result's line,
  // column and text, the group's indented under its label
  async text(node?: Node<Found>): Promise<string> {
    const result = async (i: Item<Found>) => {
      const { uri, range } = i.result.location;
      const document = await vscode.workspace.openTextDocument(uri);
      const { head, inside, tail } = preview(document, range, 21, false);
      return `${range.start.line + 1}, ${range.start.character + 1}: ${head}${inside}${tail}`;
    };
    const file = async (f: File<Found>) => {
      let out = `${vscode.workspace.asRelativePath(this.uri(f) as vscode.Uri)}\n`;
      for (const i of f.results) out += `  ${await result(i)}\n`;
      return out;
    };
    if (node?.kind === "result") return result(node);
    if (node?.kind === "file") return file(node);
    const group = async (files: File<Found>[]) => {
      let out = `${groupLabel}\n`;
      for (const f of files) {
        out += `${(await file(f)).replace(/^(?=.)/gm, "  ")}\n`;
      }
      return out;
    };
    if (node?.kind === "group") return group(node.files);
    let out = "";
    for (const n of this.tree.roots) {
      out += n.kind === "group" ? await group(n.files) : `${await file(n)}\n`;
    }
    return out;
  }
}

export class ReferencesView implements vscode.Disposable {
  // The tree the view shows, if it's ours
  private shown?: Shown;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly find: Find) {
    const on =
      (f: (shown: Shown, node: Node<Found>) => unknown) =>
      (node?: Node<Found>) =>
        this.shown && node ? f(this.shown, node) : undefined;
    const copy = (text: string) => vscode.env.clipboard.writeText(text);
    this.disposables = [
      vscode.commands.registerCommand(
        `${source}.dismiss`,
        on((shown, node) => shown.remove(node)),
      ),
      vscode.commands.registerCommand(
        `${source}.copy`,
        on(async (shown, node) => copy(await shown.text(node))),
      ),
      vscode.commands.registerCommand(
        `${source}.copyAll`,
        on(async (shown) => copy(await shown.text())),
      ),
      vscode.commands.registerCommand(
        `${source}.copyPath`,
        on((shown, node) => {
          const uri = shown.uri(node);
          if (uri) {
            copy(uri.scheme === "file" ? uri.fsPath : uri.toString(true));
          }
        }),
      ),
    ];
  }

  // Takes the place of VS Code's search at the same place, if the view is
  // running it and some result is passed by reference
  offer(uri: vscode.Uri, position: vscode.Position, found: Found[]) {
    if (!found.some((f) => f.passed)) return;
    const view = vscode.extensions.getExtension<SymbolTree>(
      "vscode.references-view",
    );
    if (!view?.isActive) return;
    const input = view.exports.getInput();
    if (
      input?.contextValue === search &&
      input.location.uri.toString() === uri.toString() &&
      input.location.range.start.isEqual(position)
    ) {
      view.exports.setInput(this.input(input.title, input.location));
    }
  }

  private input(title: string, location: vscode.Location): Input {
    return {
      contextValue: source,
      title,
      location,
      resolve: async () => {
        const document = await vscode.workspace.openTextDocument(location.uri);
        const found = await this.find(document, location.range.start);
        if (!found.length) return undefined;
        // Shown first, as the view reveals the search's own result only if
        // it's visible, and ours is ready sooner than VS Code's
        await vscode.commands.executeCommand("references-view.tree.focus");
        this.shown = new Shown(new Tree(found));
        return this.shown.model();
      },
      with: (l) => this.input(title, l),
    };
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
