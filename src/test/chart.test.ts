import * as assert from "node:assert";
import { Attribute, type Texts, type Value } from "../codec/types";
import { datetime } from "../format/temporal";
import { float } from "../format/text";
import {
  barred,
  binned,
  lined,
  noted,
  numbers,
  read,
  scattered,
  stepped,
} from "../webview/chart/data";
import {
  fitted,
  initial,
  retyped,
  type Spec,
  typesOf,
  xColumns,
} from "../webview/chart/spec";
import { splits, stamp, steps, ticks } from "../webview/chart/time";
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
    assert.deepStrictEqual(typesOf(trades), [
      "line",
      "bar",
      "histogram",
      "scatter",
    ]);
    // A scatter takes two numbers
    assert.deepStrictEqual(typesOf(table({ v: floats(1), d: ints(14, 1) })), [
      "line",
      "bar",
      "histogram",
    ]);
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

  test("reads times as whole units, a timestamp's and a timespan's in milliseconds, cut", () => {
    const at = (
      type: number,
      data: Int32Array | BigInt64Array | Float64Array,
    ) => [...read({ type, attribute: none, data } as never).values];
    // 2000.01.02 and 2000.02m, as q counts them
    assert.deepStrictEqual(at(14, Int32Array.of(1)), [1]);
    assert.deepStrictEqual(at(13, Int32Array.of(1)), [1]);
    // 2000.01.01T12:00:00.0004 in milliseconds, cut
    assert.deepStrictEqual(
      at(15, Float64Array.of(0.5 + 0.0004 / 86400)),
      [43_200_000],
    );
    assert.deepStrictEqual(at(19, Int32Array.of(1500)), [1500]);
    // 2026.10.27D09:30, then every 100 microseconds: milliseconds, cut
    const from = 9796n * 86_400_000_000_000n + 34_200_000_000_000n;
    const stamps = at(
      12,
      BigInt64Array.from({ length: 30 }, (_, i) => from + 100_000n * BigInt(i)),
    );
    assert.deepStrictEqual(
      stamps.map((v) => v - (9796 * 86_400_000 + 34_200_000)),
      Array.from({ length: 30 }, (_, i) => Math.floor(i / 10)),
    );
    // A timespan's too, a negative one down: -0D00:00:00.000000001 is
    // -00:00:00.001, as q casts it
    assert.deepStrictEqual(at(16, BigInt64Array.of(1_999_999n, -1n)), [1, -1]);
    // A datetime placed at the millisecond the Grid writes, however it
    // rounds
    for (let k = 0; k < 2000; k++) {
      const days = (Math.random() - 0.5) * 20000;
      assert.strictEqual(
        stamp(at(15, Float64Array.of(days))[0], 15),
        datetime(days),
        String(days),
      );
    }
    // A long as a double, as a float is: past 2^53, as near as it holds
    const big = 1_698_400_000_000_000_001n;
    assert.deepStrictEqual(at(7, BigInt64Array.of(big)), [Number(big)]);
  });

  test("draws times in milliseconds since 2000.01.01, unshifted by any time zone", () => {
    const t = table({ d: ints(14, 1, 3), v: floats(1, 2) });
    const plotted = lined(t, spec({ x: 0, y: [1] }));
    assert.deepStrictEqual([...plotted.x], [86_400_000, 3 * 86_400_000]);
  });

  test("draws a line's rows in order of its x, leaving out those with none", () => {
    const t = table({
      time: ints(19, 3000, -2147483648, 1000, 2000),
      price: floats(3, 9, 1, Number.NaN),
    });
    const plotted = lined(t, spec({ x: 0, y: [1] }));
    assert.deepStrictEqual([...plotted.x], [1000, 2000, 3000]);
    // Each point's row, for the cursor to show its cells
    assert.deepStrictEqual([...(plotted.rows ?? [])], [2, 3, 0]);
    assert.deepStrictEqual(plotted.ys, [[1, null, 3]]);
    assert.deepStrictEqual([plotted.nulls, plotted.infinities], [2, 0]);
    assert.strictEqual(noted(plotted), "2 nulls not drawn");
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
    assert.strictEqual(noted(plotted), "");
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
    // 09:30 to 10:30 every 20 minutes: Sturges 20 minutes, so half hours,
    // of whole milliseconds, a bin for the highest too
    const minutes = (m: number) => BigInt(m) * 60_000_000_000n;
    const timed = table({
      t: {
        type: 12,
        attribute: none,
        data: BigInt64Array.from([570, 590, 610, 630].map(minutes)),
      },
    });
    assert.deepStrictEqual(histogram(timed, {}), {
      counts: [2, 1, 1],
      said: [
        "2000.01.01D09:30:00.000 – 2000.01.01D09:59:59.999",
        "2000.01.01D10:30:00.000 – 2000.01.01D10:59:59.999",
      ],
      nulls: 0,
    });
  });

  test("bins times of day in steps of a clock, from a whole number of them, as a timestamp's", () => {
    // 09:30:00.008, then 09:40 to 10:30 every 10 minutes: Sturges 15.8
    // minutes, so half hours from 09:30, not 09:30:00.008
    const t = table({
      t: ints(
        19,
        34200008,
        ...[580, 590, 600, 610, 620, 630].map((m) => m * 60_000),
      ),
    });
    assert.deepStrictEqual(histogram(t, {}).said, [
      "09:30:00.000 – 09:59:59.999",
      "10:30:00.000 – 10:59:59.999",
    ]);
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

  test("draws fewer bins than typed of whole units, where as many wouldn't hold as many each, and says so", () => {
    const counted = table({ v: longs(...[...Array(10).keys()].map(BigInt)) });
    const plotted = binned(counted, spec({ type: "histogram", x: 0, bins: 7 }));
    assert.strictEqual(plotted.ys[0].length, 5);
    assert.strictEqual(noted(plotted), "5 bins of 2 values each");
    const asked = binned(counted, spec({ type: "histogram", x: 0, bins: 5 }));
    assert.strictEqual(noted(asked), "");
  });

  test("says a bin's edges in full, however near 0", () => {
    // Two bins from -0.7, the second from 5e-06, not 0
    const floated = table({ v: floats(-0.7, 0.70001) });
    assert.deepStrictEqual(histogram(floated, { bins: 2 }).said, [
      "-0.7 – 5e-06",
      "5e-06 – 0.70001",
    ]);
  });

  test("bins times of more than a day from 0D, or 2000.01.01, as the axis ticks them, whatever the data", () => {
    // 0D to 22D, a day apart: Sturges 4 days, so 5, from 0D
    const spans: Value = {
      type: 16,
      attribute: none,
      data: BigInt64Array.from(
        { length: 23 },
        (_, i) => BigInt(i) * 86_400_000_000_000n,
      ),
    };
    assert.deepStrictEqual(histogram(table({ s: spans }), {}).said, [
      "0D00:00:00.000 – 4D23:59:59.999",
      "20D00:00:00.000 – 24D23:59:59.999",
    ]);
  });

  test("never bins in more than 10,000, though starting at a whole number of a width takes one more", () => {
    const spans: Value = {
      type: 16,
      attribute: none,
      data: BigInt64Array.from(
        [
          -17709060000000, 472395000000, -295673, 25088000000, -653370000000000,
          565396100000000, 8576380000000, -251911200, -3047298, 47858700000,
          51514400000000, -3873643, -104409400, 351985200, -224631600,
          51820020000, -8296410000, 5213000000, -1212466000000,
          -586369000000000, 28760710000000, 48389900,
        ].map(BigInt),
      ),
    };
    const { counts } = histogram(table({ s: spans }), {});
    assert.ok(counts.length <= 10000);
    assert.strictEqual(
      counts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
      22,
    );
  });

  test("bins a huge value all alone in a bin wider than none", () => {
    const plotted = binned(
      table({ v: floats(1e16, 1e16) }),
      spec({ type: "histogram", x: 0 }),
    );
    assert.deepStrictEqual([...plotted.ys[0]], [2]);
    assert.ok((plotted.bins?.from ?? 0) < (plotted.bins?.to ?? 0));
  });

  test("bins floats that differ only where a double rounds as one value, and counts the lowest in the first bin", () => {
    const rounded = histogram(table({ v: floats(0.3, 0.1 + 0.2) }), {});
    assert.deepStrictEqual(rounded.counts, [2]);
    // 0.3 / 0.1 is 2.9999999999999996, which mustn't start the bins at 0.2
    const from = table({
      v: floats(...Array.from({ length: 40 }, (_, i) => 0.3 + i / 100)),
    });
    assert.ok((histogram(from, {}).counts[0] ?? 0) > 0);
  });

  test("never draws more bins than typed, even of longs past what a double tells apart", () => {
    const huge = table({ v: longs(0n, 2n ** 62n) });
    assert.ok(histogram(huge, { bins: 7 }).counts.length <= 7);
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

  test("a scatter is of numbers by a number, never by the row's index or a time", () => {
    assert.deepStrictEqual(
      fitted(retyped(spec({ x: null, y: [3] }), "scatter"), trades),
      spec({
        type: "scatter",
        x: 2,
        y: [3],
        others: { line: { x: null, y: [3] } },
      }),
    );
    assert.deepStrictEqual(xColumns(trades, "scatter"), [2, 3]);
  });

  test("scatters each row with both an x and a y, each series apart", () => {
    const t = table({
      x: floats(1, 2, Number.NaN, 4),
      y: floats(10, Number.NaN, 30, 40),
      z: longs(100n, 200n, 300n, 400n),
    });
    const plotted = scattered(t, spec({ type: "scatter", x: 0, y: [1, 2] }));
    assert.deepStrictEqual(
      plotted.points?.map(([xs, ys]) => [[...xs], [...ys]]),
      [
        [
          [1, 4],
          [10, 40],
        ],
        [
          [1, 2, 4],
          [100, 200, 400],
        ],
      ],
    );
    assert.strictEqual(noted(plotted), "2 nulls not drawn");
  });

  test("says what it left out", () => {
    const plotted = { x: new Float64Array(), ys: [] };
    assert.strictEqual(
      noted({ ...plotted, nulls: 1, infinities: 1 }),
      "1 null, 1 infinity not drawn",
    );
    assert.strictEqual(
      noted({ ...plotted, nulls: 0, infinities: 1200 }),
      "1,200 infinities not drawn",
    );
  });

  test("writes a time as q does, its digits cut, not rounded", () => {
    // 2024.01.02, q's day 8767, in milliseconds since 2000.01.01
    const day = 86_400_000;
    const t = 8767 * day + 34_200_123;
    assert.strictEqual(stamp(t, 12), "2024.01.02D09:30:00.123000000");
    assert.strictEqual(stamp(t, 12, 3), "2024.01.02D09:30:00.123");
    assert.strictEqual(stamp(t, 15), "2024.01.02T09:30:00.123");
    assert.strictEqual(stamp(8767 * day, 14), "2024.01.02");
    assert.strictEqual(stamp(8766 * day, 13), "2024.01m");
    assert.strictEqual(stamp(34_200_500, 19), "09:30:00.500");
    assert.strictEqual(stamp(34_200_000, 18), "09:30:00");
    assert.strictEqual(stamp(34_200_000, 17), "09:30");
    assert.strictEqual(stamp(120_600_000, 16, 3), "1D09:30:00.000");
    assert.strictEqual(stamp(-60_000, 16, 3), "-0D00:01:00.000");
    // Never wrapped to a day, as q writes them
    assert.strictEqual(stamp(30 * 3_600_000, 17), "30:00");
    assert.strictEqual(stamp(-1000, 19), "-00:00:01.000");
    // Far from 2000, to the millisecond: 2200.01.01T10:40, q's day 73049
    assert.strictEqual(
      stamp(73049 * day + 38_400_000, 15),
      "2200.01.01T10:40:00.000",
    );
    // Before 2000, and a moment before midnight, never the next day
    assert.strictEqual(stamp(-1, 12, 3), "1999.12.31D23:59:59.999");
  });

  test("writes ticks as finely as they're apart, the date where it changes", () => {
    // From 2024.01.02, q's day 8767, in milliseconds
    const day = 86_400_000;
    const hour = 3_600_000;
    const from = 8767 * day;
    assert.deepStrictEqual(ticks([from, from + day], 14, day), [
      "2024.01.02",
      "2024.01.03",
    ]);
    assert.deepStrictEqual(ticks([from, from + 31 * day], 12, 31 * day), [
      "2024.01",
      "2024.02",
    ]);
    assert.deepStrictEqual(
      ticks([from + 23 * hour, from + day, from + day + hour], 12, hour),
      ["2024.01.02\n23:00", "2024.01.03\n00:00", "01:00"],
    );
    assert.deepStrictEqual(ticks([1000, 2000], 18, 1000), [
      "00:00:01",
      "00:00:02",
    ]);
    assert.deepStrictEqual(ticks([500], 19, 500), ["00:00:00.500"]);
    assert.deepStrictEqual(ticks([34_200_000, 36_000_000], 17, 1_800_000), [
      "09:30",
      "10:00",
    ]);
    // A timestamp's milliseconds
    const at = from + 34_200_000;
    assert.deepStrictEqual(ticks([at + 1, at + 2], 12, 1), [
      "2024.01.02\n09:30:00.001",
      "09:30:00.002",
    ]);
  });

  test("ticks times at steps of a clock or a calendar, a millisecond to centuries apart", () => {
    const day = 86_400_000;
    // Every millisecond from 09:30
    const at = 8767 * day + 34_200_000;
    assert.deepStrictEqual(
      splits(at, at + 3, 1, 12).map((t) => t - at),
      [0, 1, 2, 3],
    );
    // The first of each month, from 2024.01.15, q's day 8780, to April
    assert.deepStrictEqual(
      splits(8780 * day, 8870 * day, 30 * day, 14).map((t) => stamp(t, 14)),
      ["2024.02.01", "2024.03.01", "2024.04.01"],
    );
    // 1900.01.01 to 9999.12.31, every 1,000 years
    const years = splits(-36524 * day, 2921939 * day, 1000 * 365 * day, 14);
    assert.deepStrictEqual(
      years.map((t) => stamp(t, 14).slice(0, 4)),
      ["2000", "3000", "4000", "5000", "6000", "7000", "8000", "9000"],
    );
    // Days apart from 2000.01.01, and from 0D, wherever the data are
    assert.deepStrictEqual(
      splits(9034 * day, 9074 * day, 10 * day, 14).map((t) => t / day),
      [9040, 9050, 9060, 9070],
    );
    assert.deepStrictEqual(
      splits(0, 22 * day, 5 * day, 16).map((t) => t / day),
      [0, 5, 10, 15, 20],
    );
    // As fine as a type is drawn, and as far apart as dates go
    assert.strictEqual(steps(12)[0], 1);
    assert.strictEqual(steps(19)[0], 1);
    assert.strictEqual(steps(17)[0], 60_000);
    assert.ok((steps(14).at(-1) ?? 0) >= 1000 * 365 * day);
  });

  test("ticks numbers about 10^18 without end, where a step is less than a double tells apart", () => {
    const ticks = stepped(1.7e18, 1.7e18 + 256, 100);
    assert.ok(ticks.length >= 1 && ticks.length <= 4);
    assert.strictEqual(new Set(ticks).size, ticks.length);
  });

  test("writes 16 and 17 digits exactly", () => {
    assert.strictEqual(float(0.40516741630084363, 17), "0.40516741630084363");
    assert.strictEqual(float(1.0851234567890122, 17), "1.0851234567890122");
  });

  test("writes numbers on an axis as q does, to as many digits as tell the ticks apart", () => {
    // No more than a double holds
    assert.strictEqual(numbers([1e22, 1e22 + 2 ** 21], 2 ** 21)[0], "1e+22");
    assert.deepStrictEqual(numbers([1.08505, 1.0851, 1.08515], 0.00005), [
      "1.08505",
      "1.0851",
      "1.08515",
    ]);
    assert.deepStrictEqual(numbers([-0.0005, -0, 0.0005], 0.0005), [
      "-0.0005",
      "0",
      "0.0005",
    ]);
    assert.deepStrictEqual(numbers([1e-12, 2e-12], 1e-12), ["1e-12", "2e-12"]);
    assert.deepStrictEqual(numbers([0, 1e15], 1e15), ["0", "1e+15"]);
    assert.deepStrictEqual(numbers([20000, 40000], 20000), ["20000", "40000"]);
    // More than 7 where the ticks need them
    assert.deepStrictEqual(numbers([100.000001, 100.000002], 1e-6), [
      "100.000001",
      "100.000002",
    ]);
  });
});
