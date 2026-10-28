import { count, type Vector } from "../../codec/types";
import type { Column, Sheet } from "../table";
import { mostBins, type Spec } from "./spec";
import { stamp } from "./time";

// A sheet's columns as the chart draws them: numbers, times as seconds
// since 1970, read as UTC so that no time zone shifts them, and nulls and infinities left out, and counted, so the
// chart can say what it didn't draw. Never a JavaScript number per cell
// where a typed array will do.

// A column's cells as numbers, NaN for a null or an infinity
type Read = { values: Float64Array; nulls: number; infinities: number };

// What's drawn: the x, ascending, and a series for each column, null where
// a cell is left out; a bar's label, by its row, made only for the bars a
// tick or the cursor is at; a histogram's bins, from the first's start to
// the last's end, each said as the values it counts; a scatter's points,
// each series' x and y, in place of an x shared by the series; and how
// many nulls and infinities were left out
export type Plotted = {
  x: Float64Array;
  ys: (Float64Array | (number | null)[])[];
  label?: (row: number) => string;
  bins?: { from: number; to: number; said: (bin: number) => string };
  points?: [x: Float64Array, y: Float64Array][];
  nulls: number;
  infinities: number;
};

// 2000.01.01, where q counts from, in seconds since 1970
const epoch = 946684800;

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

// A numeric or temporal column's cells, as numbers or seconds since 1970,
// or, raw, as q counts them, as days since 2000.01.01 for a date
export function read(vector: Vector, raw = false): Read {
  const n = count(vector) ?? 0;
  const values = new Float64Array(n);
  let nulls = 0;
  let infinities = 0;
  const left = (i: number, isNull: boolean) => {
    values[i] = Number.NaN;
    if (isNull) {
      nulls++;
    } else {
      infinities++;
    }
  };
  const scale = raw ? (v: number) => v : seconds(vector.type);
  switch (vector.type) {
    case 7:
    case 12:
    case 16: {
      const data = vector.data;
      const most = 2n ** 63n - 1n;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (v === -most - 1n || v === most || v === -most) {
          left(i, v === -most - 1n);
        } else {
          values[i] = scale(Number(v));
        }
      }
      break;
    }
    case 8:
    case 9:
    case 15: {
      const data = vector.data;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (Number.isNaN(v) || !Number.isFinite(v)) {
          left(i, Number.isNaN(v));
        } else {
          values[i] = scale(v);
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
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (v === -range || v === range - 1 || v === 1 - range) {
          left(i, v === -range);
        } else {
          values[i] = scale(v);
        }
      }
    }
  }
  return { values, nulls, infinities };
}

// A type's count in seconds since 1970: its date from 2000.01.01, or its
// time of day or span as a time on 1970.01.01, which is how it's drawn
function seconds(type: number): (v: number) => number {
  switch (type) {
    case 12:
      return (ns) => epoch + ns / 1e9;
    case 13:
      return (months) => Date.UTC(2000, months) / 1000;
    case 14:
    case 15:
      return (days) => epoch + days * 86400;
    case 16:
      return (ns) => ns / 1e9;
    case 17:
      return (minutes) => minutes * 60;
    case 19:
      return (ms) => ms / 1000;
  }
  return (v) => v;
}

// A line's points: each row with an x, ascending by it, as the chart draws
// a line from left to right. Rows come sorted where they aren't already.
// A row's index is its x where there's no column for it.
export function lined(sheet: Sheet, spec: Spec): Plotted {
  const x = spec.x === null ? undefined : read(vectorOf(sheet, spec.x));
  const ys = spec.y.map((j) => read(vectorOf(sheet, j)));
  const xs =
    x?.values ?? Float64Array.from({ length: sheet.rows }, (_, i) => i);
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
      let n = 0;
      for (let i = 0; i < sheet.rows; i++) {
        if (!Number.isNaN(x.values[i]) && !Number.isNaN(values[i])) {
          xs[n] = x.values[i];
          vs[n++] = values[i];
        }
      }
      return [xs.slice(0, n), vs.slice(0, n)];
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
// 10,000 at most. A column of whole units, such as ints, days or months,
// is binned as q counts them, a whole number of them to a bin and a bin
// for the highest too, so that no bin holds more of them than another and
// none is lost to rounding.
export function binned(sheet: Sheet, spec: Spec): Plotted {
  if (spec.x === null) {
    throw new Error("type", { cause: "histogram of row index" });
  }
  const { type } = columnOf(sheet, spec.x);
  const whole = wholes.includes(type);
  const values = read(vectorOf(sheet, spec.x), whole);
  // Where a value is drawn, in seconds since 1970 for a time
  const drawn = whole ? seconds(type) : (v: number) => v;
  const sorted = values.values.filter((v) => !Number.isNaN(v)).sort();
  const n = sorted.length;
  if (!n) {
    return {
      x: new Float64Array(),
      ys: [new Float64Array()],
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
  if (whole) {
    // Values of whole units span one more than from the lowest to the
    // highest
    const fits = (wide: number) => Math.max(1, Math.ceil(wide - 1e-9));
    width = fits(spec.bins ? (spread + 1) / spec.bins : suited(sorted));
    if (Math.floor(spread / width) + 1 > mostBins) {
      width = fits((spread + 1) / mostBins);
    }
    start = low;
    count = Math.floor(spread / width) + 1;
  } else if (!spread) {
    // One bin, for values all the same, one either side of them
    width = 1;
    start = low - 0.5;
    count = 1;
  } else {
    // As wide as asked, or as suits the values, rounded up to a width that
    // reads well, the bins starting at a whole number of it: 5 minutes
    // from 09:35, not 4 minutes 51.3 seconds from 09:33:12.7
    width = spec.bins ? spread / spec.bins : readable(suited(sorted), time);
    if (spread / width > mostBins) {
      width = readable(spread / mostBins, time);
    }
    start = spec.bins ? low : Math.floor(low / width) * width;
    // The highest in the last bin, which ends with it or after it
    count = Math.max(1, Math.ceil((high - start) / width - 1e-9));
  }
  const counts = new Float64Array(count);
  for (const v of sorted) {
    const bin = Math.floor((v - start) / width + (whole ? 0 : 1e-9));
    counts[Math.min(count - 1, bin)]++;
  }
  const edge = (bin: number) => drawn(start + bin * width);
  // As many digits as tell one bin's edge from the next
  const digits = Math.min(15, Math.max(0, Math.ceil(-Math.log10(width)) + 1));
  const write = (v: number) =>
    time
      ? stamp(drawn(v), type, fine(type) && width < 1e-3 ? 6 : 3)
      : String(whole ? v : Number(v.toFixed(digits)));
  return {
    x: Float64Array.from(counts, (_, i) => (edge(i) + edge(i + 1)) / 2),
    ys: [counts],
    bins: {
      from: edge(0),
      to: edge(count),
      // From its first value to its last, of a column of whole units, else
      // from where it starts to where the next does
      said: (bin) => {
        const from = start + bin * width;
        const last = from + width - (whole ? 1 : 0);
        return last === from ? write(from) : `${write(from)} – ${write(last)}`;
      },
    },
    ...counted([values]),
  };
}

// Columns of whole units: shorts, ints and longs, and months, dates,
// minutes, seconds and times
const wholes = [5, 6, 7, 13, 14, 17, 18, 19];

// Whether a type holds times finer than a millisecond: a timestamp or a
// timespan, of nanoseconds
export function fine(type: number): boolean {
  return type === 12 || type === 16;
}

// A width at least this, that reads well: 1, 2, 2.5 or 5 of a power of 10;
// or, for a time, a step of a clock, as 15 seconds, 5 minutes or 6 hours,
// and whole days past a day
function readable(width: number, time: boolean): number {
  const clock = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const hours = [7200, 10800, 21600, 43200, 86400];
  if (time && width >= 1) {
    const step = [...clock, ...hours].find((each) => each >= width - 1e-9);
    return step ?? Math.ceil(readable(width / 86400, false)) * 86400;
  }
  const power = 10 ** Math.floor(Math.log10(width));
  const step = [1, 2, 2.5, 5, 10].find((each) => each * power >= width - 1e-12);
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

// What the chart left out, in words: as 12 nulls, 2 infinities not drawn
export function skipped({ nulls, infinities }: Plotted): string {
  const counted = (n: number, word: string, words: string) =>
    n ? [`${n.toLocaleString("en-US")} ${n === 1 ? word : words}`] : [];
  const parts = [
    ...counted(nulls, "null", "nulls"),
    ...counted(infinities, "infinity", "infinities"),
  ];
  return parts.length ? `${parts.join(", ")} not drawn` : "";
}
