import * as assert from "node:assert";
import { type Node, type Result, Tree } from "../referencesTree";

// Results as "file start", passed by reference if starred
const results = (...rs: string[]): Result[] =>
  rs.map((r) => {
    const [file, at] = r.replace("*", "").split(" ");
    const start = Number(at);
    return { file, start, end: start + 1, passed: r.endsWith("*") };
  });

// The tree as lines, indented by depth
function drawn(tree: Tree<Result>): string[] {
  const draw = (n: Node<Result>, depth: number): string[] => {
    const pad = "  ".repeat(depth);
    if (n.kind === "result") return [`${pad}${n.result.start}`];
    const head = n.kind === "group" ? "Passed by reference" : n.file;
    return [
      `${pad}${head}`,
      ...tree.children(n).flatMap((c) => draw(c, depth + 1)),
    ];
  };
  return tree.roots.flatMap((n) => draw(n, 0));
}

const shown = (n: Node<Result> | undefined) =>
  n?.kind === "result" ? `${n.result.file} ${n.result.start}` : n?.kind;

suite("references tree", () => {
  const sample = () =>
    new Tree(
      results("/b.q 9", "/a.q 5*", "/b.q 2", "/a.q 1", "/c.q 3*", "/b.q 4*"),
    );

  test("each file by path, its results in order, then the group", () => {
    assert.deepStrictEqual(drawn(sample()), [
      "/a.q",
      "  1",
      "/b.q",
      "  2",
      "  9",
      "Passed by reference",
      "  /a.q",
      "    5",
      "  /b.q",
      "    4",
      "  /c.q",
      "    3",
    ]);
  });

  test("no group when nothing is passed by reference", () => {
    assert.deepStrictEqual(drawn(new Tree(results("/a.q 1", "/a.q 4"))), [
      "/a.q",
      "  1",
      "  4",
    ]);
  });

  test("results and files counted as VS Code counts them", () => {
    assert.strictEqual(sample().message, "6 results in 3 files");
    assert.strictEqual(
      new Tree(results("/a.q 1")).message,
      "1 result in 1 file",
    );
    assert.strictEqual(
      new Tree(results("/a.q 1", "/b.q 1")).message,
      "2 results in 2 files",
    );
    assert.strictEqual(
      new Tree(results("/a.q 1", "/a.q 3")).message,
      "2 results in 1 file",
    );
    assert.strictEqual(new Tree([]).message, "No results.");
  });

  test("the nearest result, in either group", () => {
    const tree = sample();
    assert.strictEqual(shown(tree.nearest("/b.q", 4)), "/b.q 4");
    // Just after one, as the cursor is when typing
    assert.strictEqual(shown(tree.nearest("/b.q", 3)), "/b.q 2");
    assert.strictEqual(shown(tree.nearest("/b.q", 6)), "/b.q 9");
    assert.strictEqual(shown(tree.nearest("/b.q", 20)), "/b.q 9");
    assert.strictEqual(shown(tree.nearest("/d.q", 0)), "/a.q 1");
  });

  test("next and previous through the group, round to the start", () => {
    const tree = sample();
    const order: (string | undefined)[] = [];
    let n: Node<Result> = tree.items()[0];
    for (let i = 0; i < 7; i++) {
      order.push(shown(n));
      n = tree.next(n);
    }
    assert.deepStrictEqual(order, [
      "/a.q 1",
      "/b.q 2",
      "/b.q 9",
      "/a.q 5",
      "/b.q 4",
      "/c.q 3",
      "/a.q 1",
    ]);
    assert.strictEqual(shown(tree.previous(tree.items()[0])), "/c.q 3");
    // From the group, its first; before it, the last outside it
    const group = tree.roots[2];
    assert.strictEqual(shown(tree.next(group)), "/a.q 5");
    assert.strictEqual(shown(tree.previous(group)), "/b.q 9");
  });

  test("dismissed, with what it leaves empty", () => {
    const tree = sample();
    const [a, , group] = tree.roots;
    tree.remove(tree.items(a)[0]);
    assert.deepStrictEqual(drawn(tree).slice(0, 4), [
      "/b.q",
      "  2",
      "  9",
      "Passed by reference",
    ]);
    for (const f of [...tree.children(group)]) tree.remove(f);
    assert.deepStrictEqual(drawn(tree), ["/b.q", "  2", "  9"]);
    assert.strictEqual(tree.message, "2 results in 1 file");
  });
});
