import * as assert from "node:assert";
import { Attribute, type Texts, type Value } from "../codec/types";
import { barred, binned, lined, read, skipped } from "../webview/chart/data";
import {
  fitted,
  initial,
  retyped,
  type Spec,
  typesOf,
  xColumns,
} from "../webview/chart/spec";
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
  bins: null,
  others: {},
  ...to,
});

suite("the Chart", () => {
  test("first draws a bar of the first numbers where the first column is a label", () => {
    assert.deepStrictEqual(
      initial(trades),
      spec({ type: "bar", x: 0, y: [2] }),
    );
  });

  test("first draws a line of the first numbers by the first time, else the first number", () => {
    const timed = table({
      price: floats(1),
      time: ints(19, 1),
      size: longs(1n),
    });
    assert.deepStrictEqual(initial(timed), spec({ x: 1, y: [0] }));
    const numbered = table({ price: floats(1), size: longs(1n) });
    assert.deepStrictEqual(initial(numbered), spec({ x: 0, y: [1] }));
  });

  test("draws a lone number by each row's index, times alone as a histogram, and nothing where there are neither", () => {
    assert.deepStrictEqual(
      initial(table({ price: floats(1, 2) })),
      spec({ x: null, y: [0] }),
    );
    const dated = table({ s: syms("a"), d: ints(14, 1) });
    assert.deepStrictEqual(initial(dated), spec({ type: "histogram", x: 1 }));
    assert.deepStrictEqual(typesOf(dated), ["histogram"]);
    assert.deepStrictEqual(typesOf(trades), ["line", "bar", "histogram"]);
    assert.strictEqual(initial(table({ sym: syms("a") })), undefined);
  });

  test("never offers as the x the only number, which would leave no series", () => {
    const lone = table({ a: longs(1n, 2n), s: syms("x", "y") });
    assert.deepStrictEqual(xColumns(lone, "line"), []);
    assert.deepStrictEqual(xColumns(lone, "bar"), [1]);
    assert.deepStrictEqual(xColumns(trades, "line"), [1, 2, 3]);
    assert.deepStrictEqual(
      fitted(spec({ x: 0, y: [0] }), lone),
      spec({ x: null, y: [0] }),
    );
  });

  test("tells columns of the same name apart by their place", () => {
    const twice = sheet({
      type: 99,
      keys: { type: 98, attribute: none, columns: ["a"], data: [floats(1, 2)] },
      values: {
        type: 98,
        attribute: none,
        columns: ["a"],
        data: [floats(3, 4)],
      },
    } as Value);
    assert.ok(twice);
    const plotted = lined(twice, spec({ x: 0, y: [1] }));
    assert.deepStrictEqual([...plotted.x], [1, 2]);
    assert.deepStrictEqual(
      plotted.ys.map((y) => [...y]),
      [[3, 4]],
    );
  });

  test("fits a spec to a sheet, keeping what fits and choosing afresh what doesn't", () => {
    // A line can't take a label as its x
    assert.deepStrictEqual(
      fitted(spec({ x: 0, y: [3, 2], hidden: [3] }), trades),
      spec({ x: 1, y: [3, 2], hidden: [3] }),
    );
    // A series that's become the x, or is no number, goes, and a series is
    // chosen where none is left
    assert.deepStrictEqual(
      fitted(spec({ x: 2, y: [2, 0], hidden: [2] }), trades),
      spec({ x: 2, y: [3] }),
    );
    // A bar takes any column as its x, and a row's index stays
    assert.deepStrictEqual(
      fitted(spec({ type: "bar", x: 0, y: [3] }), trades),
      spec({ type: "bar", x: 0, y: [3] }),
    );
    assert.deepStrictEqual(
      fitted(spec({ x: null, y: [3] }), trades),
      spec({ x: null, y: [3] }),
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

  test("reads times as seconds since 1970, unshifted by any time zone", () => {
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
    const plotted = lined(t, spec({ x: 0, y: [1] }));
    assert.deepStrictEqual([...plotted.x], [1, 2, 3]);
    assert.deepStrictEqual(plotted.ys, [[1, null, 3]]);
    assert.deepStrictEqual([plotted.nulls, plotted.infinities], [2, 0]);
    assert.strictEqual(skipped(plotted), "2 nulls not drawn");
  });

  test("draws a line in order as it came, and by each row's index", () => {
    const plotted = lined(trades, spec({ x: null, y: [2, 3] }));
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
    const plotted = barred(trades, spec({ type: "bar", x: 1, y: [3] }));
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

  test("a histogram counts the first number, else the first time, never the row's index", () => {
    assert.deepStrictEqual(
      fitted(spec({ type: "histogram", x: null, y: [3] }), trades),
      spec({ type: "histogram", x: 2, y: [3] }),
    );
    // Any number, the only one too, or a time
    const lone = table({ a: longs(1n, 2n), s: syms("x", "y") });
    assert.deepStrictEqual(xColumns(lone, "histogram"), [0]);
    assert.deepStrictEqual(xColumns(trades, "histogram"), [1, 2, 3]);
  });

  // The counts, and what each bin says it holds
  const histogram = (s: Sheet, to: Partial<Spec>) => {
    const plotted = binned(s, spec({ type: "histogram", x: 0, ...to }));
    return {
      counts: [...plotted.ys[0]],
      said: plotted.ys[0].length
        ? [0, plotted.ys[0].length - 1].map((i) => plotted.bins?.said(i))
        : [],
      nulls: plotted.nulls,
    };
  };

  test("bins as numpy's auto does: here Sturges', narrower than Freedman–Diaconis'", () => {
    // 4 values over 3: Sturges 3 / 3 = 1, Freedman–Diaconis 2 × 1.5 / ∛4
    const floated = table({ v: floats(1, 2, 3, 4, Number.NaN) });
    assert.deepStrictEqual(histogram(floated, {}), {
      counts: [1, 1, 2],
      said: ["1 – 2", "3 – 4"],
      nulls: 1,
    });
    // As many as asked
    assert.deepStrictEqual(histogram(floated, { bins: 2 }).counts, [2, 2]);
  });

  test("bins as wide as suits the values, rounded to a width that reads well and starting at a whole number of it", () => {
    // Sturges 9.3 / 3 = 3.1, so 5, from 0
    const floated = table({ v: floats(0.3, 1.7, 2.2, 9.6) });
    assert.deepStrictEqual(histogram(floated, {}), {
      counts: [3, 1],
      said: ["0 – 5", "5 – 10"],
      nulls: 0,
    });
    // 09:30 to 10:30 every 20 minutes: Sturges 20 minutes, so half hours
    const minutes = (m: number) => BigInt(m) * 60_000_000_000n;
    const timed = table({
      t: {
        type: 12,
        attribute: none,
        data: BigInt64Array.from([570, 590, 610, 630].map(minutes)),
      },
    });
    assert.deepStrictEqual(histogram(timed, {}), {
      counts: [2, 2],
      said: [
        "2000.01.01D09:30:00.000 – 2000.01.01D10:00:00.000",
        "2000.01.01D10:00:00.000 – 2000.01.01D10:30:00.000",
      ],
      nulls: 0,
    });
  });

  test("bins whole units, a bin for the highest too, for a column that counts in them", () => {
    // 0 to 9: Sturges 9 / 4.32 = 2.08, so 3 wide
    const counted = table({ v: longs(...[...Array(10).keys()].map(BigInt)) });
    assert.deepStrictEqual(histogram(counted, {}), {
      counts: [3, 3, 3, 1],
      said: ["0 – 2", "9 – 11"],
      nulls: 0,
    });
    // Seven days: Sturges 1.58 days, so 2
    const dated = table({
      d: ints(14, 8766, 8767, 8768, 8769, 8770, 8771, 8772),
    });
    assert.deepStrictEqual(histogram(dated, {}), {
      counts: [2, 2, 2, 1],
      said: ["2024.01.01 – 2024.01.02", "2024.01.07 – 2024.01.08"],
      nulls: 0,
    });
  });

  test("never bins in more than 10,000, however the values lie", () => {
    // One far out makes Freedman–Diaconis' bins tiny
    const outlier = table({
      v: floats(...Array.from({ length: 1000 }, (_, i) => i / 1000), 1e9),
    });
    assert.ok(histogram(outlier, {}).counts.length <= 10000);
    const counted = table({ v: longs(0n, 1n, 10n ** 12n) });
    assert.ok(histogram(counted, { bins: 10000 }).counts.length <= 10000);
  });

  test("says a whole number in full, and a time of whole milliseconds in its own bin", () => {
    const big = table({ v: longs(1234567n, 1234568n, 1234569n, 1234590n) });
    assert.deepStrictEqual(histogram(big, { bins: 24 }).said, [
      "1234567",
      "1234590",
    ]);
    // 09:30:00.000 to 09:30:02.000, a bin to each millisecond
    const ms = table({
      t: ints(19, ...Array.from({ length: 2001 }, (_, i) => 34200000 + i)),
    });
    const { counts } = histogram(ms, { bins: 2001 });
    assert.deepStrictEqual(new Set(counts), new Set([1]));
  });

  test("bins months as months", () => {
    // 2020.01m to 2024.12m: Sturges 59 / 6.9 = 8.5, so 9 months
    const months: Value = {
      type: 13,
      attribute: none,
      data: Int32Array.from({ length: 60 }, (_, i) => 240 + i),
    };
    assert.deepStrictEqual(histogram(table({ m: months }), {}), {
      counts: [9, 9, 9, 9, 9, 9, 6],
      said: ["2020.01m – 2020.09m", "2024.07m – 2025.03m"],
      nulls: 0,
    });
    assert.deepStrictEqual(histogram(table({ m: months }), { bins: 60 }).said, [
      "2020.01m",
      "2024.12m",
    ]);
  });

  test("keeps each type's columns for coming back to it, and only bins that could be typed", () => {
    const line = spec({ x: 1, y: [2] });
    const histogram = fitted({ ...retyped(line, "histogram"), x: 3 }, trades);
    assert.deepStrictEqual(retyped(histogram, "line"), {
      ...line,
      others: { histogram: { x: 3, y: [2] } },
    });
    for (const bins of [0, 2.5, 10001]) {
      assert.strictEqual(fitted(spec({ bins }), trades).bins, null);
    }
  });

  test("bins values all the same in one, a unit wide, and none at all in none", () => {
    assert.deepStrictEqual(histogram(table({ v: longs(5n, 5n) }), {}).said, [
      "5",
      "5",
    ]);
    assert.deepStrictEqual(histogram(table({ v: floats(5, 5) }), {}), {
      counts: [2],
      said: ["4.5 – 5.5", "4.5 – 5.5"],
      nulls: 0,
    });
    assert.deepStrictEqual(histogram(table({ v: floats(Number.NaN) }), {}), {
      counts: [],
      said: [],
      nulls: 1,
    });
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
    // Never wrapped to a day, as q writes them
    assert.strictEqual(stamp(30 * 3600, 17), "30:00");
    assert.strictEqual(stamp(-1, 19), "-00:00:01.000");
    // To the microsecond where that's needed
    assert.strictEqual(
      stamp(t + 0.000456, 12, 6),
      "2024.01.02D09:30:00.123456",
    );
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
