import { count, type Vector } from "../../codec/types";
import { float } from "../../format/text";
import type { Column, Sheet } from "../table";
import { mostBins, type Spec } from "./spec";
import { monthDay, stamp } from "./time";

// A sheet's columns as the chart draws them: numbers, and times as whole
// microseconds from a day in the middle of their range, which a double
// holds exactly for any column spanning under 570 years, a timestamp's and
// a timespan's nanoseconds cut off, as q casts to a coarser time; nulls and
// infinities left out, and counted, so the chart can say what it didn't
// draw. Never a JavaScript number per cell where a typed array will do.

// A column's cells as numbers, NaN for a null or an infinity: a time as a
// whole number of its unit, as q counts it, but a timestamp's and a
// timespan's in microseconds and a datetime's in milliseconds, from the
// origin, in days since 2000.01.01, 0 for times of day
type Read = {
  values: Float64Array;
  nulls: number;
  infinities: number;
  origin: number;
};

// What's drawn: the x, ascending, and a series for each column, null where
// a cell is left out; the row each x is of; a bar's label, by its row, made
// only for the bars a tick or the cursor is at; a histogram's bins, from
// the first's start to the last's end, each said as the values it counts,
// and how many there are of how many values each, where that isn't as many
// as typed; a scatter's points, each series' x and y and the rows they're
// of, in place of an x shared by the series; the day a time x counts from;
// and how many nulls and infinities were left out
export type Plotted = {
  x: Float64Array;
  ys: (Float64Array | (number | null)[])[];
  rows?: Uint32Array;
  label?: (row: number) => string;
  bins?: {
    from: number;
    to: number;
    said: (bin: number) => string;
    fewer?: { count: number; each: number };
  };
  points?: [x: Float64Array, y: Float64Array, rows: Uint32Array][];
  origin?: number;
  nulls: number;
  infinities: number;
};

// A day, in microseconds and nanoseconds
const day = 86_400_000_000;
const dayNs = 86_400_000_000_000n;

// The smallest and largest of a type's integers are its null and its
// infinities, the rest of the span its values
const ranges: Record<number, number> = {
  5: 2 ** 15,
  6: 2 ** 31,
  13: 2 ** 31,
  14: 2 ** 31,
  17: 2 ** 31,
  18: 2 ** 31,
  19: 2 ** 31,
};

// A numeric or temporal column's cells
export function read(vector: Vector): Read {
  const n = count(vector) ?? 0;
  const values = new Float64Array(n);
  let nulls = 0;
  let infinities = 0;
  let origin = 0;
  const left = (i: number, isNull: boolean) => {
    values[i] = Number.NaN;
    if (isNull) {
      nulls++;
    } else {
      infinities++;
    }
  };
  switch (vector.type) {
    case 7:
    case 12:
    case 16: {
      const data = vector.data;
      const most = 2n ** 63n - 1n;
      const special = (v: bigint) =>
        v === -most - 1n || v === most || v === -most;
      let low = most;
      let high = -most;
      for (const v of data) {
        if (special(v)) {
          continue;
        }
        if (v < low) {
          low = v;
        }
        if (v > high) {
          high = v;
        }
      }
      const timed = vector.type !== 7 && low <= high;
      if (timed) {
        origin = Number(floored((low + high) / 2n, dayNs));
      }
      const from = BigInt(origin) * dayNs;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (special(v)) {
          left(i, v === -most - 1n);
        } else {
          values[i] = timed ? Number(floored(v - from, 1000n)) : Number(v);
        }
      }
      break;
    }
    case 8:
    case 9:
    case 15: {
      const data = vector.data;
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (Number.isNaN(v) || !Number.isFinite(v)) {
          left(i, Number.isNaN(v));
        } else {
          values[i] = v;
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
      }
      if (vector.type === 15 && low <= high) {
        // A datetime's days as milliseconds, rounded to the microsecond
        // then cut, as q writes it
        origin = Math.floor((low + high) / 2);
        for (let i = 0; i < n; i++) {
          values[i] = Math.floor(
            Math.round((values[i] - origin) * 864e8) / 1000,
          );
        }
      }
      break;
    }
    default: {
      const data = vector.data as ArrayLike<number>;
      const range = ranges[vector.type];
      if (range === undefined) {
        throw new Error("type", { cause: "charted column not a number" });
      }
      let low = range;
      let high = -range;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (v === -range || v === range - 1 || v === 1 - range) {
          left(i, v === -range);
        } else {
          values[i] = v;
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
      }
      if (low <= high && (vector.type === 13 || vector.type === 14)) {
        const middle = Math.floor((low + high) / 2);
        origin = vector.type === 13 ? monthDay(middle) : middle;
      }
    }
  }
  return { values, nulls, infinities, origin };
}

// A type's values, as read, in microseconds from the origin, as drawn
export function micros(type: number, origin: number): (v: number) => number {
  switch (type) {
    case 13:
      return (months) => (monthDay(months) - origin) * day;
    case 14:
      return (days) => (days - origin) * day;
    case 15:
    case 19:
      return (ms) => ms * 1e3;
    case 17:
      return (minutes) => minutes * 6e7;
    case 18:
      return (seconds) => seconds * 1e6;
  }
  return (v) => v;
}

// Division rounded down, where a bigint's rounds toward zero
function floored(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d < 0n ? q - 1n : q;
}

// A line's points: each row with an x, ascending by it, as the chart draws
// a line from left to right. Rows come sorted where they aren't already.
// A row's index is its x where there's no column for it.
export function lined(sheet: Sheet, spec: Spec): Plotted {
  const x = spec.x === null ? undefined : read(vectorOf(sheet, spec.x));
  const ys = spec.y.map((j) => read(vectorOf(sheet, j)));
  const type = spec.x === null ? 0 : columnOf(sheet, spec.x).type;
  const xs = x
    ? x.values.map(micros(type, x.origin))
    : Float64Array.from({ length: sheet.rows }, (_, i) => i);
  // The rows drawn, in the order drawn
  let rows = new Uint32Array(sheet.rows);
  let n = 0;
  let ascending = true;
  for (let i = 0; i < sheet.rows; i++) {
    if (!Number.isNaN(xs[i])) {
      ascending &&= n === 0 || xs[rows[n - 1]] <= xs[i];
      rows[n++] = i;
    }
  }
  rows = rows.subarray(0, n);
  if (!ascending) {
    rows.sort((a, b) => xs[a] - xs[b]);
  }
  return {
    x: picked(xs, rows),
    ys: ys.map(({ values }) => gapped(picked(values, rows))),
    rows,
    origin: x?.origin,
    ...counted([...(x ? [x] : []), ...ys]),
  };
}

// A scatter's: each row with both an x and a y, a point to each, in the
// order they came, as a point's place is its x and y
export function scattered(sheet: Sheet, spec: Spec): Plotted {
  if (spec.x === null) {
    throw new Error("type", { cause: "scatter by row index" });
  }
  const x = read(vectorOf(sheet, spec.x));
  const ys = spec.y.map((j) => read(vectorOf(sheet, j)));
  return {
    x: new Float64Array(),
    ys: [],
    points: ys.map(({ values }) => {
      const xs = new Float64Array(sheet.rows);
      const vs = new Float64Array(sheet.rows);
      const rows = new Uint32Array(sheet.rows);
      let n = 0;
      for (let i = 0; i < sheet.rows; i++) {
        if (!Number.isNaN(x.values[i]) && !Number.isNaN(values[i])) {
          xs[n] = x.values[i];
          vs[n] = values[i];
          rows[n++] = i;
        }
      }
      return [xs.slice(0, n), vs.slice(0, n), rows.slice(0, n)];
    }),
    ...counted([x, ...ys]),
  };
}

// A bar's: each row in order, labelled with its x as the grid shows it, or
// its index, at 0, 1, 2 and on
export function barred(sheet: Sheet, spec: Spec): Plotted {
  const ys = spec.y.map((j) => read(vectorOf(sheet, j)));
  const x = spec.x === null ? undefined : columnOf(sheet, spec.x);
  return {
    x: Float64Array.from({ length: sheet.rows }, (_, i) => i),
    ys: ys.map(({ values }) => gapped(values)),
    label: x ? (row) => x.text(row) : String,
    ...counted(ys),
  };
}

// A histogram's bins: how many of a column's values fall in each, at the
// middle of each, as many bins as asked or, if not, as suit the values,
// 10,000 at most. A column of whole units, such as ints, days, months or
// a timestamp's microseconds, is binned as they're counted, a whole number
// of them to a bin and a bin for the highest too, so that no bin holds more
// of them than another and none is lost to rounding: fewer bins than asked,
// where as many wouldn't each hold as many.
export function binned(sheet: Sheet, spec: Spec): Plotted {
  if (spec.x === null) {
    throw new Error("type", { cause: "histogram of row index" });
  }
  const { type } = columnOf(sheet, spec.x);
  // Every column but of reals and floats counts in whole units
  const whole = type !== 8 && type !== 9;
  const values = read(vectorOf(sheet, spec.x));
  const { origin } = values;
  // Where a value is drawn
  const drawn = micros(type, origin);
  const sorted = values.values.filter((v) => !Number.isNaN(v)).sort();
  const n = sorted.length;
  if (!n) {
    return {
      x: new Float64Array(),
      ys: [new Float64Array()],
      origin,
      ...counted([values]),
    };
  }
  const low = sorted[0];
  const high = sorted[n - 1];
  const spread = high - low;
  const time = type >= 12;
  let width: number;
  let start: number;
  let count: number;
  // Where each bin starts: a whole number of widths, or of the spread over
  // as many as typed, from where the first does, so that no rounding builds
  // up across them, and a bin at 0 starts at 0
  let edge: (bin: number) => number;
  let fewer: { count: number; each: number } | undefined;
  if (whole) {
    // Values of whole units span one more than from the lowest to the
    // highest. A time's bins are a step of a clock, from a whole number of
    // them.
    const fits = (wide: number) => Math.max(1, Math.ceil(wide - 1e-9));
    const unit = clocked[type];
    width = spec.bins
      ? fits((spread + 1) / spec.bins)
      : unit
        ? fits((readable((suited(sorted) * unit) / 1e6, true) * 1e6) / unit)
        : fits(suited(sorted));
    if (Math.floor(spread / width) + 1 > mostBins) {
      width = fits((spread + 1) / mostBins);
    }
    start = unit && !spec.bins ? Math.floor(low / width) * width : low;
    count = Math.floor((high - start) / width) + 1;
    if (spec.bins && count !== spec.bins) {
      fewer = { count, each: width };
    }
    edge = (bin) => start + bin * width;
  } else if (!spread) {
    // One bin, for values all the same, one either side of them
    width = 1;
    start = low - 0.5;
    count = 1;
    edge = (bin) => start + bin;
  } else if (spec.bins) {
    width = spread / spec.bins;
    start = low;
    count = spec.bins;
    edge = (bin) => low + (spread * bin) / count;
  } else {
    // As suits the values, rounded up to a width that reads well, the bins
    // starting at a whole number of it: 0.5 from 1.5, not 0.48 from 1.53
    width = readable(suited(sorted), false);
    if (spread / width > mostBins) {
      width = readable(spread / mostBins, false);
    }
    const first = Math.floor(low / width);
    start = first * width;
    // The highest in the last bin, which ends with it or after it
    count = Math.max(1, Math.ceil((high - start) / width - 1e-9));
    edge = (bin) => (first + bin) * width;
  }
  const counts = new Float64Array(count);
  for (const v of sorted) {
    const bin = Math.floor((v - start) / width + (whole ? 0 : 1e-9));
    counts[Math.min(count - 1, bin)]++;
  }
  // A number to as many digits as tell one edge from the next, 7 at least,
  // as q writes it; a time to the microsecond, or as finely as its type is
  const digits = Math.max(
    7,
    figures(Math.max(Math.abs(edge(0)), Math.abs(edge(count))), width),
  );
  const write = (v: number) =>
    time
      ? stamp(drawn(v), origin, type, fine(type) ? 6 : undefined)
      : whole
        ? String(v)
        : float(v, digits);
  return {
    x: Float64Array.from(
      counts,
      (_, i) => (drawn(edge(i)) + drawn(edge(i + 1))) / 2,
    ),
    ys: [counts],
    bins: {
      from: drawn(edge(0)),
      to: drawn(edge(count)),
      // From its first value to its last, of a column of whole units, else
      // from where it starts to where the next does
      said: (bin) => {
        const from = edge(bin);
        const last = edge(bin + 1) - (whole ? 1 : 0);
        return last === from ? write(from) : `${write(from)} – ${write(last)}`;
      },
      fewer,
    },
    origin,
    ...counted([values]),
  };
}

// The microseconds in a unit of each time of fixed length, which a month
// isn't, as read
const clocked: Record<number, number> = {
  12: 1,
  14: day,
  15: 1e3,
  16: 1,
  17: 6e7,
  18: 1e6,
  19: 1e3,
};

// Whether a type holds times finer than a millisecond: a timestamp or a
// timespan, of nanoseconds
export function fine(type: number): boolean {
  return type === 12 || type === 16;
}

// How many significant digits tell numbers as large as this apart, a step
// apart: from the largest's first to the step's last, of three at most
export function figures(largest: number, step: number): number {
  if (!largest || !step) {
    return 1;
  }
  const [mantissa, exponent] = Math.abs(step).toExponential().split("e");
  const significant = Math.min(3, mantissa.replace(".", "").length);
  const [, top] = Math.abs(largest).toExponential().split("e");
  return Math.max(1, Number(top) - Number(exponent) + significant);
}

// Numbers on an axis as q writes them: to 7 significant digits, or as many
// more as tell one tick from the next, and a 0 never as -0
export function numbers(splits: number[], step: number): string[] {
  const largest = Math.max(0, ...splits.map(Math.abs));
  const digits = Math.max(7, figures(largest, step));
  return splits.map((v) => float(v + 0, digits));
}

// A width at least this, that reads well: 1, 2, 2.5 or 5 of a power of 10;
// or, for a time, a step of a clock, as 15 seconds, 5 minutes or 6 hours,
// whole days past a day, and 1, 2 or 5 of a power of 10 within a second
function readable(width: number, time: boolean): number {
  const clock = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const hours = [7200, 10800, 21600, 43200, 86400];
  if (time && width >= 1) {
    const step = [...clock, ...hours].find((each) => each >= width - 1e-9);
    return step ?? Math.ceil(readable(width / 86400, false)) * 86400;
  }
  const power = 10 ** Math.floor(Math.log10(width));
  const steps = time ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = steps.find((each) => each * power >= width - 1e-12);
  return (step ?? 10) * power;
}

// How wide bins suit sorted values, as numpy's "auto" has it: the
// narrower of Sturges' rule, for few values, and Freedman–Diaconis', for
// many, which is none for values mostly the same
function suited(sorted: Float64Array): number {
  const n = sorted.length;
  const spread = sorted[n - 1] - sorted[0];
  const sturges = spread / (Math.log2(n) + 1);
  const quartile = (p: number) => {
    const at = p * (n - 1);
    const below = Math.floor(at);
    const above = Math.min(below + 1, n - 1);
    return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
  };
  const fd = (2 * (quartile(0.75) - quartile(0.25))) / Math.cbrt(n);
  return fd > 0 ? Math.min(fd, sturges) : sturges;
}

function counted(read: Read[]): { nulls: number; infinities: number } {
  return {
    nulls: read.reduce((sum, { nulls }) => sum + nulls, 0),
    infinities: read.reduce((sum, { infinities }) => sum + infinities, 0),
  };
}

function picked(values: Float64Array, rows: Uint32Array): Float64Array {
  return rows.length === values.length && rows.every((row, i) => row === i)
    ? values
    : Float64Array.from(rows, (row) => values[row]);
}

// As the chart takes a series: a gap, where a cell is left out, is null,
// which a typed array can't hold
function gapped(values: Float64Array): Float64Array | (number | null)[] {
  return values.some(Number.isNaN)
    ? Array.from(values, (v) => (Number.isNaN(v) ? null : v))
    : values;
}

function columnOf(sheet: Sheet, j: number): Column {
  const column = sheet.columns[j];
  if (!column) {
    throw new Error("index", { cause: `charted column ${j} not in sheet` });
  }
  return column;
}

function vectorOf(sheet: Sheet, j: number): Vector {
  const { vector, name } = columnOf(sheet, j);
  if (!vector) {
    throw new Error("type", { cause: `charted column ${name} not a vector` });
  }
  return vector;
}

// What the chart says of what it drew: fewer bins than typed, as 5 bins of
// 2 values each, and what it left out, as 12 nulls, 2 infinities not drawn
export function noted({ bins, nulls, infinities }: Plotted): string {
  const counted = (n: number, word: string, words: string) =>
    n ? [`${n.toLocaleString("en-US")} ${n === 1 ? word : words}`] : [];
  const left = [
    ...counted(nulls, "null", "nulls"),
    ...counted(infinities, "infinity", "infinities"),
  ];
  const fewer = bins?.fewer;
  return [
    ...(fewer
      ? [
          `${counted(fewer.count, "bin", "bins")} of ${counted(fewer.each, "value", "values")} each`,
        ]
      : []),
    ...(left.length ? [`${left.join(", ")} not drawn`] : []),
  ].join(" · ");
}
