import * as assert from "node:assert";
import { Attribute, type Texts, type Value } from "../codec/types";
import { barred, lined, read, skipped } from "../webview/chart/data";
import { fitted, initial, type Spec } from "../webview/chart/spec";
import { stamp, ticks } from "../webview/chart/time";
import { type Sheet, sheet } from "../webview/table";

const none = Attribute.None;

function symbols(...names: string[]): Texts {
  const bytes = new TextEncoder().encode(names.join(""));
  const offsets = new Uint32Array(names.length + 1);
  names.forEach((name, i) => {
    offsets[i + 1] = offsets[i] + name.length;
  });
  return { bytes, offsets };
}

// A table of these columns, as the Grid's sheet
function table(columns: Record<string, Value>): Sheet {
  const s = sheet({
    type: 98,
    attribute: none,
    columns: Object.keys(columns),
    data: Object.values(columns) as never,
  });
  assert.ok(s);
  return s;
}

const floats = (...v: number[]): Value => ({
  type: 9,
  attribute: none,
  data: Float64Array.from(v),
});
const longs = (...v: bigint[]): Value => ({
  type: 7,
  attribute: none,
  data: BigInt64Array.from(v),
});
const ints = (type: 6 | 14 | 19, ...v: number[]): Value => ({
  type,
  attribute: none,
  data: Int32Array.from(v),
});
const syms = (...v: string[]): Value => ({
  type: 11,
  attribute: none,
  data: symbols(...v),
});

const trades = table({
  sym: syms("a", "b", "c"),
  time: ints(19, 3000, 1000, 2000),
  price: floats(1.5, 2.5, 3.5),
  size: longs(100n, 200n, 300n),
});

const spec = (to: Partial<Spec>): Spec => ({
  type: "line",
  x: null,
  y: [],
  hidden: [],
  steps: false,
  ...to,
});

suite("the Chart", () => {
  test("first draws a bar of the first numbers where the first column is a label", () => {
    assert.deepStrictEqual(
      initial(trades),
      spec({ type: "bar", x: "sym", y: ["price"] }),
    );
  });

  test("first draws a line of the first numbers by the first time, else the first number", () => {
    const timed = table({
      price: floats(1),
      time: ints(19, 1),
      size: longs(1n),
    });
    assert.deepStrictEqual(initial(timed), spec({ x: "time", y: ["price"] }));
    const numbered = table({ price: floats(1), size: longs(1n) });
    assert.deepStrictEqual(
      initial(numbered),
      spec({ x: "price", y: ["size"] }),
    );
  });

  test("draws a lone number by each row's index, and nothing where there are no numbers", () => {
    assert.deepStrictEqual(
      initial(table({ price: floats(1, 2) })),
      spec({ x: null, y: ["price"] }),
    );
    assert.strictEqual(initial(table({ sym: syms("a") })), undefined);
    assert.strictEqual(initial(table({ time: ints(14, 1) })), undefined);
  });

  test("fits a spec to a sheet, keeping what fits and choosing afresh what doesn't", () => {
    // A line can't take a label as its x
    assert.deepStrictEqual(
      fitted(
        spec({ x: "sym", y: ["size", "price"], hidden: ["size"] }),
        trades,
      ),
      spec({ x: "time", y: ["size", "price"], hidden: ["size"] }),
    );
    // A series that's become the x, or is no number, goes, and a series is
    // chosen where none is left
    assert.deepStrictEqual(
      fitted(
        spec({ x: "price", y: ["price", "sym"], hidden: ["price"] }),
        trades,
      ),
      spec({ x: "price", y: ["size"] }),
    );
    // A bar takes any column as its x, and a row's index stays
    assert.deepStrictEqual(
      fitted(spec({ type: "bar", x: "sym", y: ["size"] }), trades),
      spec({ type: "bar", x: "sym", y: ["size"] }),
    );
    assert.deepStrictEqual(
      fitted(spec({ x: null, y: ["size"] }), trades),
      spec({ x: null, y: ["size"] }),
    );
  });

  test("reads q's nulls and infinities as left out, and counts them", () => {
    const { values, nulls, infinities } = read({
      type: 6,
      attribute: none,
      data: Int32Array.from([1, -2147483648, 2147483647, -2147483647, 5]),
    });
    assert.deepStrictEqual(
      [...values].map((v) => (Number.isNaN(v) ? null : v)),
      [1, null, null, null, 5],
    );
    assert.deepStrictEqual([nulls, infinities], [1, 2]);
    const long = read({
      type: 7,
      attribute: none,
      data: BigInt64Array.from([-(2n ** 63n), 2n ** 63n - 1n, 7n]),
    });
    assert.deepStrictEqual(
      [long.nulls, long.infinities, long.values[2]],
      [1, 1, 7],
    );
    const float = read({
      type: 9,
      attribute: none,
      data: Float64Array.from([Number.NaN, Number.NEGATIVE_INFINITY, 0.5]),
    });
    assert.deepStrictEqual(
      [float.nulls, float.infinities, float.values[2]],
      [1, 1, 0.5],
    );
  });

  test("reads times as seconds since 1970 in UTC", () => {
    const at = (
      type: number,
      data: Int32Array | BigInt64Array | Float64Array,
    ) => read({ type, attribute: none, data } as never).values[0];
    // 2000.01.02, 2000.02m, 2000.01.01D00:00:01, 00:01, 00:00:01.500
    assert.strictEqual(at(14, Int32Array.of(1)), Date.UTC(2000, 0, 2) / 1000);
    assert.strictEqual(at(13, Int32Array.of(1)), Date.UTC(2000, 1, 1) / 1000);
    assert.strictEqual(
      at(12, BigInt64Array.of(1_000_000_000n)),
      Date.UTC(2000, 0, 1, 0, 0, 1) / 1000,
    );
    assert.strictEqual(
      at(15, Float64Array.of(0.5)),
      Date.UTC(2000, 0, 1, 12) / 1000,
    );
    assert.strictEqual(at(17, Int32Array.of(1)), 60);
    assert.strictEqual(at(19, Int32Array.of(1500)), 1.5);
  });

  test("draws a line's rows in order of its x, leaving out those with none", () => {
    const t = table({
      time: ints(19, 3000, -2147483648, 1000, 2000),
      price: floats(3, 9, 1, Number.NaN),
    });
    const plotted = lined(t, spec({ x: "time", y: ["price"] }));
    assert.deepStrictEqual([...plotted.x], [1, 2, 3]);
    assert.deepStrictEqual(plotted.ys, [[1, null, 3]]);
    assert.deepStrictEqual([plotted.nulls, plotted.infinities], [2, 0]);
    assert.strictEqual(skipped(plotted), "2 nulls not drawn");
  });

  test("draws a line in order as it came, and by each row's index", () => {
    const plotted = lined(trades, spec({ x: null, y: ["price", "size"] }));
    assert.deepStrictEqual([...plotted.x], [0, 1, 2]);
    assert.deepStrictEqual(
      plotted.ys.map((y) => [...y]),
      [
        [1.5, 2.5, 3.5],
        [100, 200, 300],
      ],
    );
    assert.strictEqual(skipped(plotted), "");
  });

  test("draws a bar for each row, labelled with its x as the grid shows it", () => {
    const plotted = barred(
      trades,
      spec({ type: "bar", x: "time", y: ["size"] }),
    );
    assert.deepStrictEqual([...plotted.x], [0, 1, 2]);
    assert.deepStrictEqual(
      [0, 1, 2].map((row) => plotted.label?.(row)),
      ["00:00:03.000", "00:00:01.000", "00:00:02.000"],
    );
    assert.deepStrictEqual(
      plotted.ys.map((y) => [...y]),
      [[100, 200, 300]],
    );
  });

  test("says what it left out", () => {
    const plotted = { x: new Float64Array(), ys: [] };
    assert.strictEqual(
      skipped({ ...plotted, nulls: 1, infinities: 1 }),
      "1 null, 1 infinity not drawn",
    );
    assert.strictEqual(
      skipped({ ...plotted, nulls: 0, infinities: 1200 }),
      "1,200 infinities not drawn",
    );
  });

  test("writes a time at the cursor as q does", () => {
    const t = Date.UTC(2024, 0, 2, 9, 30, 0, 123) / 1000;
    assert.strictEqual(stamp(t, 12), "2024.01.02D09:30:00.123");
    assert.strictEqual(stamp(t, 15), "2024.01.02T09:30:00.123");
    assert.strictEqual(stamp(t, 14), "2024.01.02");
    assert.strictEqual(stamp(t, 13), "2024.01m");
    assert.strictEqual(stamp(34200.5, 19), "09:30:00.500");
    assert.strictEqual(stamp(34200, 18), "09:30:00");
    assert.strictEqual(stamp(34200, 17), "09:30");
    assert.strictEqual(stamp(86400 + 34200, 16), "1D09:30:00.000");
    assert.strictEqual(stamp(-60, 16), "-0D00:01:00.000");
  });

  test("writes ticks as finely as they're apart, the date where it changes", () => {
    const day = Date.UTC(2024, 0, 2) / 1000;
    assert.deepStrictEqual(ticks([day, day + 86400], 14, 86400), [
      "2024.01.02",
      "2024.01.03",
    ]);
    assert.deepStrictEqual(ticks([day, day + 31 * 86400], 12, 31 * 86400), [
      "2024.01",
      "2024.02",
    ]);
    assert.deepStrictEqual(
      ticks([day + 82800, day + 86400, day + 90000], 12, 3600),
      ["2024.01.02\n23:00", "2024.01.03\n00:00", "01:00"],
    );
    assert.deepStrictEqual(ticks([1, 2], 18, 1), ["00:00:01", "00:00:02"]);
    assert.deepStrictEqual(ticks([0.5], 19, 0.5), ["00:00:00.500"]);
  });
});
