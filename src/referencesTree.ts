// The References view's tree for q's results, as VS Code's own has them:
// each file and its results, by path and then by place, then the results
// that pass a global by reference, as their own group, last. Pure: no
// VS Code imports, never throws.

export type Result = {
  file: string;
  start: number;
  end: number;
  passed: boolean;
};

export type Group<T> = { kind: "group"; files: File<T>[] };
export type File<T> = {
  kind: "file";
  file: string;
  results: Item<T>[];
  parent?: Group<T>;
};
export type Item<T> = { kind: "result"; result: T; parent: File<T> };
export type Node<T> = Group<T> | File<T> | Item<T>;

export const groupLabel = "Passed by reference";

export class Tree<T extends Result> {
  readonly roots: (File<T> | Group<T>)[];

  constructor(results: T[]) {
    const sorted = [...results].sort(
      (x, y) =>
        (x.file < y.file ? -1 : x.file > y.file ? 1 : 0) || x.start - y.start,
    );
    const byFile = (rs: T[], parent?: Group<T>) => {
      const files: File<T>[] = [];
      for (const result of rs) {
        let f = files[files.length - 1];
        if (f?.file !== result.file) {
          f = { kind: "file", file: result.file, results: [], parent };
          files.push(f);
        }
        f.results.push({ kind: "result", result, parent: f });
      }
      return files;
    };
    this.roots = byFile(sorted.filter((r) => !r.passed));
    const passed = sorted.filter((r) => r.passed);
    if (passed.length) {
      const group: Group<T> = { kind: "group", files: [] };
      group.files = byFile(passed, group);
      this.roots.push(group);
    }
  }

  children(node?: Node<T>): Node<T>[] {
    if (!node) return this.roots;
    if (node.kind === "group") return node.files;
    if (node.kind === "file") return node.results;
    return [];
  }

  parent(node: Node<T>): Node<T> | undefined {
    return node.kind === "group" ? undefined : node.parent;
  }

  // Every result, in the tree's order
  items(node?: Node<T>): Item<T>[] {
    if (node?.kind === "result") return [node];
    return this.children(node).flatMap((n) => this.items(n));
  }

  // As VS Code counts them: results, and the files they're in
  get message(): string {
    const items = this.items();
    if (!items.length) return "No results.";
    const files = new Set(items.map((i) => i.result.file)).size;
    const n = (count: number, word: string) =>
      `${count} ${word}${count === 1 ? "" : "s"}`;
    return `${n(items.length, "result")} in ${n(files, "file")}`;
  }

  // The result at the offset in the file, else the first after it, else the
  // last before it, else the first
  nearest(file: string, offset: number): Item<T> | undefined {
    const all = this.items();
    const here = all
      .filter((i) => i.result.file === file)
      .sort((x, y) => x.result.start - y.result.start);
    return (
      here.find((i) => i.result.start <= offset && offset <= i.result.end) ??
      here.find((i) => i.result.end > offset) ??
      here[here.length - 1] ??
      all[0]
    );
  }

  // The next result, or previous, round to the start, as F4 steps; from a
  // file or group, its first, or the one before it
  next(node: Node<T>): Node<T> {
    const all = this.items();
    const inside = this.items(node);
    if (node.kind !== "result") return inside[0] ?? node;
    return all[(all.indexOf(node) + 1) % all.length] ?? node;
  }

  previous(node: Node<T>): Node<T> {
    const all = this.items();
    const first = this.items(node)[0];
    if (!first) return node;
    return all[(all.indexOf(first) - 1 + all.length) % all.length] ?? node;
  }

  // Dismisses the node, and any file or group it leaves empty
  remove(node: Node<T>) {
    const without = <N>(list: N[], n: N) => {
      const i = list.indexOf(n);
      if (i >= 0) list.splice(i, 1);
    };
    if (node.kind === "result") {
      without(node.parent.results, node);
      if (!node.parent.results.length) this.remove(node.parent);
    } else if (node.kind === "file") {
      if (node.parent) {
        without(node.parent.files, node);
        if (!node.parent.files.length) this.remove(node.parent);
      } else {
        without(this.roots, node);
      }
    } else {
      without(this.roots, node);
    }
  }
}
