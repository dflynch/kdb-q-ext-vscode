import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { count, type Value, type Vector } from "../codec/types";
import { type Sheet, said, sheet } from "../webview/table";

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
  const s = sheet(value(name), 7);
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

  test("a dictionary is a key column, pinned, and a value column", () => {
    const s = sheetOf("dict.mixed");
    assert.deepStrictEqual(cells(s), [
      ["key", "value"],
      ["a", "1"],
      ["b", '"two"'],
    ]);
    assert.strictEqual(s.keys, 1);
  });

  test("a dictionary of a list and a table is laid out as q's console", () => {
    // -8!`a`b!([]x:1 2)
    const rows = sheet(
      decode(
        Buffer.from(
          "010000003a000000630b0002000000610062006200630b0001000000780000000100000007000200000001000000000000000200000000000000",
          "hex",
        ),
      ),
      7,
    );
    assert.ok(rows);
    assert.deepStrictEqual(cells(rows), [
      ["key", "x"],
      ["a", "1"],
      ["b", "2"],
    ]);
    assert.strictEqual(rows.keys, 1);
    // -8!([]x:1 2)!`a`b
    const keyed = sheet(
      decode(
        Buffer.from(
          "010000003a000000636200630b00010000007800000001000000070002000000010000000000000002000000000000000b000200000061006200",
          "hex",
        ),
      ),
      7,
    );
    assert.ok(keyed);
    assert.deepStrictEqual(cells(keyed), [
      ["x", "value"],
      ["1", "a"],
      ["2", "b"],
    ]);
    assert.strictEqual(keyed.keys, 1);
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

  test("a table in a cell is its shape, rows × columns, a keyed table's keys among them", () => {
    const s = sheet(
      {
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
              // ([]x:1 2)!`a`b: keyed by a table, but not a keyed table
              decode(
                Buffer.from(
                  "010000003a000000636200630b00010000007800000001000000070002000000010000000000000002000000000000000b000200000061006200",
                  "hex",
                ),
              ),
            ],
          },
        ],
      },
      7,
    );
    assert.ok(s);
    assert.deepStrictEqual(cells(s), [
      ["t"],
      ["3 × 3"],
      ["2 × 2"],
      ["`a`b`c!1 2 3"],
      ["(+(,`x)!,1 2)!`a`b"],
    ]);
    const { shape } = s.columns[0];
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((row) => shape?.(row)),
      [
        { keyed: false, rows: 3, columns: 3 },
        { keyed: true, rows: 2, columns: 2 },
        undefined,
        undefined,
      ],
    );
  });

  test("a table's shape in words", () => {
    assert.deepStrictEqual(
      [
        said({ keyed: false, rows: 1, columns: 1 }),
        said({ keyed: true, rows: 2, columns: 3 }),
      ],
      ["Table, 1 row and 1 column", "Keyed table, 2 rows and 3 columns"],
    );
  });

  test("tables in cells sort after the rest, keyed last, each by rows then columns", () => {
    const table = (rows: number, columns: number): Value => ({
      type: 98,
      attribute: 0,
      columns: Array.from({ length: columns }, (_, j) => `c${j}`),
      data: Array.from({ length: columns }, () => ({
        type: 7,
        attribute: 0,
        data: new BigInt64Array(rows),
      })),
    });
    const keyed = (rows: number, keys: number, values: number): Value => ({
      type: 99,
      keys: table(rows, keys),
      values: table(rows, values),
    });
    const s = sheet(
      {
        type: 0,
        attribute: 0,
        items: [
          table(10, 1),
          table(9, 2),
          { type: -7, value: 5n },
          keyed(9, 1, 1),
          table(9, 1),
          keyed(8, 2, 1),
        ],
      },
      7,
    );
    assert.ok(s);
    assert.deepStrictEqual(sorted(s, 0), [2, 4, 1, 0, 5, 3]);
  });

  test("a cell's value, to drill into, whatever its column holds", () => {
    const trades = sheetOf("table.trades");
    assert.deepStrictEqual(trades.columns[0].value(1), {
      type: -11,
      value: "b",
    });
    assert.deepStrictEqual(trades.columns[1].value(2), {
      type: -9,
      value: 3.5,
    });
    assert.deepStrictEqual(sheetOf("table.multiKeyed").columns[1].value(0), {
      type: -11,
      value: "n",
    });
    // A string column's string, as a char vector
    assert.deepStrictEqual(sheetOf("table.stringColumn").columns[0].value(1), {
      type: 10,
      attribute: 0,
      data: new TextEncoder().encode("c"),
    });
    // A dictionary's key and value
    const mixed = sheetOf("dict.mixed");
    assert.deepStrictEqual(mixed.columns[0].value(1), {
      type: -11,
      value: "b",
    });
    assert.deepStrictEqual(mixed.columns[1].value(1), {
      type: 10,
      attribute: 0,
      data: new TextEncoder().encode("two"),
    });
    // A nested item, or a table in a cell, as it is
    assert.deepStrictEqual(
      sheetOf("table.nestedColumn").columns[0].value(1),
      vector({ type: 7, data: BigInt64Array.of(3n, 4n, 5n) }),
    );
    const nested = value("table.trades");
    const s = sheet(
      {
        type: 98,
        attribute: 0,
        columns: ["t"],
        data: [{ type: 0, attribute: 0, items: [nested] }],
      },
      7,
    );
    assert.strictEqual(s?.columns[0].value(0), nested);
  });

  test("a list is a value column, an item to a row", () => {
    const mixed = sheetOf("list.mixed");
    assert.strictEqual(mixed.rows, count(value("list.mixed")));
    assert.deepStrictEqual(
      mixed.columns.map((c) => c.name),
      ["value"],
    );
    assert.strictEqual(mixed.keys, 0);
    const matrix = value("display.matrix");
    assert.ok(matrix.type === 0 && "items" in matrix);
    assert.deepStrictEqual(
      sheetOf("display.matrix").columns[0].value(1),
      matrix.items[1],
    );
    const longs = sheet(vector({ type: 7, data: BigInt64Array.of(3n, 4n) }), 7);
    assert.deepStrictEqual(longs && cells(longs), [["value"], ["3"], ["4"]]);
  });

  test("what has no rows to show has none: an atom, a string", () => {
    assert.strictEqual(sheet({ type: -7, value: 42n }, 7), undefined);
    assert.strictEqual(
      sheet(
        { type: 10, attribute: 0, data: new TextEncoder().encode("ab") },
        7,
      ),
      undefined,
    );
    assert.strictEqual(
      sheet({ type: 98, attribute: 0, columns: ["a"], reference: ":db/t" }, 7),
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
    const s = sheet(
      {
        type: 98,
        attribute: 0,
        columns: ["j", "f"],
        data: [longs as Vector, floats as Vector],
      },
      7,
    );
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

  test("writes floats and reals to the precision given, as q's \\P, for copying and CSV too", () => {
    const s = sheet(
      {
        type: 98,
        attribute: 0,
        columns: ["f", "r"],
        data: [
          { type: 9, attribute: 0, data: Float64Array.of(1 / 3) },
          { type: 8, attribute: 0, data: Float32Array.of(1 / 3) },
        ],
      },
      3,
    );
    assert.ok(s);
    assert.deepStrictEqual(
      s.columns.map((c) => [c.text(0), c.csv?.(0)]),
      [
        ["0.333", "0.333"],
        ["0.333", "0.333"],
      ],
    );
  });
});
