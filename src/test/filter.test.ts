import * as assert from "node:assert";
import { Attribute, type Vector } from "../codec/types";
import {
  type Comparison,
  comparable,
  compared,
  field,
  passing,
  read,
} from "../webview/filter";
import { type Column, sheet } from "../webview/table";

function columnOf(vector: Vector): Column {
  const s = sheet(vector, 7);
  assert.ok(s);
  return s.columns[0];
}

const vector = (type: number, data: ArrayLike<unknown>) =>
  ({ type, attribute: Attribute.None, data }) as Vector;

// The rows a condition lets through
function rows(
  column: Column,
  type: Comparison,
  filter: string,
  filterTo?: string,
): number[] | undefined {
  const test = passing(column, { type, filter, filterTo });
  if (!test) {
    return undefined;
  }
  const count = (column.vector as { data: ArrayLike<unknown> }).data.length;
  return Array.from({ length: count }, (_, row) => row).filter(test);
}

const nullLong = -(2n ** 63n);

suite("the Grid's filters of numbers and times", () => {
  test("compare numbers and times, but not other columns", () => {
    assert.deepStrictEqual(
      [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 19, 20].map(comparable),
      [
        false,
        false,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        true,
        true,
        true,
        false,
      ],
    );
  });

  test("take numbers and timespans typed, other times picked to the type's finest", () => {
    assert.deepStrictEqual([7, 9, 16, 12, 15, 13, 14, 17, 18, 19].map(field), [
      { type: "text" },
      { type: "text" },
      { type: "text" },
      { type: "datetime-local", step: "0.001" },
      { type: "datetime-local", step: "0.001" },
      { type: "month" },
      { type: "date" },
      { type: "time", step: "60" },
      { type: "time", step: "1" },
      { type: "time", step: "0.001" },
    ]);
  });

  test("read numbers as q writes them", () => {
    assert.strictEqual(read("42", 7), 42n);
    assert.strictEqual(read(" -42j ", 7), -42n);
    assert.strictEqual(read("9223372036854775807", 7), 2n ** 63n - 1n);
    assert.strictEqual(read("1.085", 9), 1.085);
    assert.strictEqual(read(".5", 9), 0.5);
    assert.strictEqual(read("1e5", 9), 100000);
    assert.strictEqual(read("2f", 9), 2);
    assert.strictEqual(read("1.1e", 8), Math.fround(1.1));
    assert.strictEqual(read("1e5e", 8), Math.fround(100000));
    assert.strictEqual(read("0N", 7), null);
    assert.strictEqual(read("0n", 9), null);
    assert.strictEqual(read("0Nh", 5), null);
    assert.strictEqual(read("0W", 7), 2n ** 63n - 1n);
    assert.strictEqual(read("-0Wh", 5), -32767n);
    assert.strictEqual(read("0Wi", 6), 2147483647n);
    assert.strictEqual(read("0w", 9), Number.POSITIVE_INFINITY);
    assert.strictEqual(read("-0We", 8), Number.NEGATIVE_INFINITY);
    for (const typo of ["", "abc", "1.2.3", "1ef", "-0N", "0x10", "1,000"]) {
      assert.strictEqual(read(typo, 9), undefined, typo);
    }
  });

  test("read timespans as q writes them, to the nanosecond", () => {
    assert.strictEqual(read("0D00:00:00.000001500", 16), 1500n);
    assert.strictEqual(read("00:00:00.000001500", 16), 1500n);
    assert.strictEqual(read("1D", 16), 86_400_000_000_000n);
    assert.strictEqual(read("2D03", 16), (2n * 24n + 3n) * 3_600_000_000_000n);
    assert.strictEqual(read("09:30", 16), 34_200_000_000_000n);
    assert.strictEqual(read("-0D00:00:01.5", 16), -1_500_000_000n);
    assert.strictEqual(read("0N", 16), null);
    assert.strictEqual(read("0Wn", 16), 2n ** 63n - 1n);
    for (const typo of ["5", "09:3", "0D00:00:00.0000000001", "1D2D"]) {
      assert.strictEqual(read(typo, 16), undefined, typo);
    }
  });

  test("read times picked as q's own values, no time zone between", () => {
    // 2026.10.27 is 9796 days from 2000.01.01
    assert.strictEqual(read("2026-10-27", 14), 9796n);
    assert.strictEqual(read("1999-12-31", 14), -1n);
    assert.strictEqual(read("0001-01-01", 14), -730119n);
    assert.strictEqual(read("2026-10", 13), 321n);
    assert.strictEqual(
      read("2026-10-27T09:30:05.123", 12),
      (9796n * 86_400_000n + 34_205_123n) * 1_000_000n,
    );
    assert.strictEqual(
      read("2026-10-27T09:30", 12),
      (9796n * 86_400_000n + 34_200_000n) * 1_000_000n,
    );
    assert.strictEqual(read("2026-10-27T12:00", 15), 9796.5);
    assert.strictEqual(read("09:30", 17), 570n);
    assert.strictEqual(read("09:30:05", 18), 34205n);
    assert.strictEqual(read("09:30:05.12", 19), 34_205_120n);
    for (const [typo, type] of [
      ["2026-10-27", 12],
      ["2026-10-27T09", 12],
      ["27/10/2026", 14],
      ["9:30", 19],
    ] as const) {
      assert.strictEqual(read(typo, type), undefined, typo);
    }
  });

  test("order as q compares: nulls first, integers exactly, floats within q's tolerance", () => {
    assert.strictEqual(compared(null, null), 0);
    assert.strictEqual(compared(null, -(2n ** 62n)), -1);
    assert.strictEqual(compared(null, Number.NEGATIVE_INFINITY), -1);
    assert.strictEqual(compared(5n, null), 1);
    assert.strictEqual(compared(2n ** 53n + 1n, 2n ** 53n), 1);
    // A long against a float is a float, as q has it
    assert.strictEqual(compared(2n ** 53n + 1n, 2 ** 53), 0);
    assert.strictEqual(compared(1.085, 1.085 + 1e-14), 0);
    assert.strictEqual(compared(1.085, 1.0850000001), -1);
    // Just under 2^-43 apart is equal, 2^-43 apart isn't
    assert.strictEqual(compared(1, 1 + 511 * 2 ** -52), 0);
    assert.strictEqual(compared(1, 1 + 2 ** -43), -1);
    assert.strictEqual(compared(-1, -1 - 5e-15), 0);
    assert.strictEqual(compared(0, 1e-300), -1);
    assert.strictEqual(
      compared(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
      0,
    );
    assert.strictEqual(compared(Number.POSITIVE_INFINITY, 1e308), 1);
    // A real is the float it widens to: 1.1e isn't 1.1
    assert.strictEqual(compared(Math.fround(1.1), 1.1), 1);
  });

  test("filter longs exactly, nulls smallest, as q", () => {
    const longs = columnOf(
      vector(
        7,
        new BigInt64Array([5n, nullLong, 2n ** 53n + 1n, -3n, 2n ** 53n]),
      ),
    );
    assert.deepStrictEqual(rows(longs, "equals", "9007199254740993"), [2]);
    assert.deepStrictEqual(rows(longs, "lessThan", "5"), [1, 3]);
    assert.deepStrictEqual(rows(longs, "lessThanOrEqual", "5"), [0, 1, 3]);
    assert.deepStrictEqual(rows(longs, "greaterThan", "5"), [2, 4]);
    assert.deepStrictEqual(rows(longs, "greaterThanOrEqual", "5"), [0, 2, 4]);
    assert.deepStrictEqual(rows(longs, "notEqual", "5"), [1, 2, 3, 4]);
    assert.deepStrictEqual(rows(longs, "equals", "0N"), [1]);
    assert.deepStrictEqual(rows(longs, "inRange", "-3", "5"), [0, 3]);
    assert.deepStrictEqual(rows(longs, "inRange", "5", "-3"), []);
    // A float typed compares as floats
    assert.deepStrictEqual(rows(longs, "equals", "9007199254740992f"), [2, 4]);
    assert.deepStrictEqual(rows(longs, "lessThan", "-2.5"), [1, 3]);
    assert.deepStrictEqual(rows(longs, "contains", "900"), [2, 4]);
  });

  test("filter floats and reals within q's tolerance", () => {
    const floats = columnOf(
      vector(
        9,
        new Float64Array([
          1.085,
          1.085 + 1e-14,
          1.0850000001,
          Number.NaN,
          Number.POSITIVE_INFINITY,
        ]),
      ),
    );
    assert.deepStrictEqual(rows(floats, "equals", "1.085"), [0, 1]);
    assert.deepStrictEqual(rows(floats, "greaterThan", "1.085"), [2, 4]);
    assert.deepStrictEqual(rows(floats, "lessThan", "1.085"), [3]);
    assert.deepStrictEqual(rows(floats, "equals", "0w"), [4]);
    assert.deepStrictEqual(rows(floats, "equals", "0n"), [3]);
    const reals = columnOf(vector(8, new Float32Array([1.1, 2.5])));
    assert.deepStrictEqual(rows(reals, "equals", "1.1"), []);
    assert.deepStrictEqual(rows(reals, "equals", "1.1e"), [0]);
    assert.deepStrictEqual(rows(reals, "equals", "2.5"), [1]);
  });

  test("filter shorts and ints by the value, a null by its own", () => {
    const shorts = columnOf(
      vector(5, new Int16Array([-32768, 32767, -32767, 7])),
    );
    assert.deepStrictEqual(rows(shorts, "equals", "0N"), [0]);
    assert.deepStrictEqual(rows(shorts, "equals", "0n"), [0]);
    // An infinity is its value, as q widens it: 0Wh isn't 0W
    assert.deepStrictEqual(rows(shorts, "equals", "0Wh"), [1]);
    assert.deepStrictEqual(rows(shorts, "equals", "0W"), []);
    assert.deepStrictEqual(rows(shorts, "lessThan", "0W"), [0, 1, 2, 3]);
    assert.deepStrictEqual(rows(shorts, "greaterThan", "-0Wh"), [1, 3]);
  });

  test("filter timestamps and timespans to the nanosecond", () => {
    const at = (9796n * 86_400_000n + 34_200_000n) * 1_000_000n;
    const stamps = columnOf(
      vector(
        12,
        new BigInt64Array([at, at + 123_456_789n, nullLong, at + 1_000_000n]),
      ),
    );
    assert.deepStrictEqual(rows(stamps, "equals", "2026-10-27T09:30"), [0]);
    assert.deepStrictEqual(
      rows(stamps, "greaterThan", "2026-10-27T09:30:00.123"),
      [1],
    );
    assert.deepStrictEqual(
      rows(stamps, "lessThan", "2026-10-27T09:30:00.001"),
      [0, 2],
    );
    assert.deepStrictEqual(
      rows(stamps, "inRange", "2026-10-27T09:30", "2026-10-27T09:30:00.001"),
      [0, 3],
    );
    assert.deepStrictEqual(rows(stamps, "contains", "09:30:00.123"), [1]);
    const spans = columnOf(
      vector(16, new BigInt64Array([1500n, 999n, nullLong])),
    );
    assert.deepStrictEqual(
      rows(spans, "lessThan", "0D00:00:00.000001"),
      [1, 2],
    );
    assert.deepStrictEqual(rows(spans, "equals", "0D00:00:00.0000015"), [0]);
  });

  test("filter dates, months, times and datetimes picked", () => {
    const none = -2147483648;
    const dates = columnOf(vector(14, new Int32Array([9796, 9797, none])));
    assert.deepStrictEqual(rows(dates, "equals", "2026-10-27"), [0]);
    assert.deepStrictEqual(rows(dates, "lessThan", "2026-10-28"), [0, 2]);
    const months = columnOf(vector(13, new Int32Array([321, 322])));
    assert.deepStrictEqual(rows(months, "greaterThan", "2026-10"), [1]);
    const minutes = columnOf(vector(17, new Int32Array([570, 571])));
    assert.deepStrictEqual(rows(minutes, "equals", "09:31"), [1]);
    const times = columnOf(
      vector(19, new Int32Array([34_205_123, 34_205_124])),
    );
    assert.deepStrictEqual(rows(times, "lessThanOrEqual", "09:30:05.123"), [0]);
    const datetimes = columnOf(
      vector(
        15,
        new Float64Array([9796.5, 9796.5 + 1e-12, 9796.75, Number.NaN]),
      ),
    );
    assert.deepStrictEqual(
      rows(datetimes, "equals", "2026-10-27T12:00"),
      [0, 1],
    );
    assert.deepStrictEqual(
      rows(datetimes, "lessThan", "2026-10-27T18:00"),
      [0, 1, 3],
    );
  });

  test("filter nothing until there's something to compare, and nothing through a typo", () => {
    const longs = columnOf(vector(7, new BigInt64Array([1n, 2n])));
    assert.strictEqual(rows(longs, "equals", ""), undefined);
    assert.strictEqual(rows(longs, "inRange", "1"), undefined);
    assert.deepStrictEqual(rows(longs, "equals", "1x"), []);
    assert.deepStrictEqual(rows(longs, "inRange", "1", "2x"), []);
  });
});
