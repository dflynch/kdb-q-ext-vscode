import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import type { Value, Vector } from "../codec/types";
import { type Sheet, sheet } from "../webview/table";

const { values: fixtures } = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
    "utf8",
  ),
) as { values: { name: string; bytes: string }[] };

function value(name: string): Value {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture, `no fixture .corpus.${name}`);
  return decode(Buffer.from(fixture.bytes, "hex"));
}

function sheetOf(name: string): Sheet {
  const s = sheet(value(name));
  assert.ok(s, `no sheet for .corpus.${name}`);
  return s;
}

// The sheet's names and every cell, a row to an array
function cells(s: Sheet): string[][] {
  return [
    s.columns.map((c) => c.name),
    ...Array.from({ length: s.rows }, (_, i) =>
      s.columns.map((c) => c.text(i)),
    ),
  ];
}

// The rows in the order a column sorts them, ascending
function sorted(s: Sheet, column: number): number[] {
  const { compare } = s.columns[column];
  return Array.from({ length: s.rows }, (_, i) => i).sort(compare);
}

const vector = (v: Omit<Vector, "attribute">): Value =>
  ({ ...v, attribute: 0 }) as Vector;

suite("the Grid view's sheet", () => {
  test("a table's columns and cells, as the console shows them", () => {
    const s = sheetOf("table.trades");
    assert.deepStrictEqual(cells(s), [
      ["sym", "price", "size"],
      ["a", "1.5", "100"],
      ["b", "2.5", "200"],
      ["a", "3.5", "300"],
    ]);
    assert.deepStrictEqual(
      s.columns.map((c) => c.type),
      [11, 9, 7],
    );
    assert.strictEqual(s.keys, 0);
  });

  test("an empty table has its columns and no rows", () => {
    assert.deepStrictEqual(cells(sheetOf("table.empty")), [["sym", "price"]]);
  });

  test("a keyed table's keys come first, and are counted", () => {
    const s = sheetOf("table.multiKeyed");
    assert.deepStrictEqual(cells(s), [
      ["sym", "ex", "price"],
      ["a", "n", "1.5"],
      ["b", "l", "2.5"],
    ]);
    assert.strictEqual(s.keys, 2);
  });

  test("a dictionary is a key column and a value column", () => {
    assert.deepStrictEqual(cells(sheetOf("dict.mixed")), [
      ["key", "value"],
      ["a", "1"],
      ["b", '"two"'],
    ]);
  });

  test("strings and nested items are in q's form", () => {
    assert.deepStrictEqual(cells(sheetOf("table.stringColumn")), [
      ["s", "n"],
      ['"ab"', "1"],
      [',"c"', "2"],
      ['""', "3"],
    ]);
    assert.deepStrictEqual(cells(sheetOf("table.nestedColumn")), [
      ["v"],
      ["1 2"],
      ["3 4 5"],
    ]);
  });

  test("a table in a cell is what it is and its size", () => {
    const s = sheet({
      type: 98,
      attribute: 0,
      columns: ["t"],
      data: [
        {
          type: 0,
          attribute: 0,
          items: [
            value("table.trades"),
            value("table.keyed"),
            value("dict.simple"),
          ],
        },
      ],
    });
    assert.ok(s);
    assert.deepStrictEqual(cells(s), [
      ["t"],
      ["table, 3 rows"],
      ["keyed table, 2 rows"],
      ["`a`b`c!1 2 3"],
    ]);
  });

  test("what isn't a table, a keyed table or a dictionary has none", () => {
    for (const name of ["list.mixed", "display.matrix"]) {
      assert.strictEqual(sheet(value(name)), undefined, name);
    }
    assert.strictEqual(sheet({ type: -7, value: 42n }), undefined);
    assert.strictEqual(
      sheet({ type: 98, attribute: 0, columns: ["a"], reference: ":db/t" }),
      undefined,
    );
  });

  test("nulls sort first, then -0W, as q's asc", () => {
    const longs = vector({
      type: 7,
      data: BigInt64Array.of(
        5n,
        -0x8000000000000000n,
        -0x7fffffffffffffffn,
        0x7fffffffffffffffn,
        -1n,
      ),
    });
    const floats = vector({
      type: 9,
      data: Float64Array.of(5, Number.NaN, -Infinity, Infinity, -1),
    });
    const s = sheet({
      type: 98,
      attribute: 0,
      columns: ["j", "f"],
      data: [longs as Vector, floats as Vector],
    });
    assert.ok(s);
    assert.deepStrictEqual(sorted(s, 0), [1, 2, 4, 0, 3]);
    assert.deepStrictEqual(sorted(s, 1), [1, 2, 4, 0, 3]);
    assert.deepStrictEqual(
      [s.columns[0].text(1), s.columns[0].text(2), s.columns[1].text(1)],
      ["", "-0W", ""],
    );
  });

  test("symbols and strings sort by their bytes", () => {
    const s = sheetOf("table.trades");
    assert.deepStrictEqual(sorted(s, 0), [0, 2, 1]);
    const strings = sheetOf("table.stringColumn");
    // "" < "ab" < ,"c"
    assert.deepStrictEqual(sorted(strings, 0), [2, 0, 1]);
  });
});
