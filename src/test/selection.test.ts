import * as assert from "node:assert";
import { contains, moved, spans, step } from "../webview/selection";

suite("the Grid's selection", () => {
  test("covers the rows and columns from where it started to where it reaches, either way", () => {
    const selection = {
      anchor: { row: 5, column: 2 },
      end: { row: 1, column: 3 },
    };
    assert.deepStrictEqual(spans(selection), { rows: [1, 5], columns: [2, 3] });
    assert.ok(contains(selection, { row: 1, column: 2 }));
    assert.ok(contains(selection, { row: 5, column: 3 }));
    assert.ok(!contains(selection, { row: 0, column: 2 }));
    assert.ok(!contains(selection, { row: 3, column: 1 }));
    // The index, column -1, is never in it
    assert.ok(!contains(selection, { row: 3, column: -1 }));
  });

  test("an arrow moves a cell's place, within the cells shown", () => {
    const last = { row: 9, column: 2 };
    const at = { row: 0, column: 2 };
    assert.deepStrictEqual(moved(at, "ArrowDown", last), { row: 1, column: 2 });
    assert.deepStrictEqual(moved(at, "ArrowLeft", last), { row: 0, column: 1 });
    assert.deepStrictEqual(moved(at, "ArrowUp", last), at);
    assert.deepStrictEqual(moved(at, "ArrowRight", last), at);
    assert.strictEqual(moved(at, "Home", last), undefined);
  });

  test("a drag beyond the edge scrolls a step at a time, more the further out", () => {
    assert.deepStrictEqual([0, 1, 19, 20, 100].map(step), [1, 1, 1, 2, 6]);
  });
});
