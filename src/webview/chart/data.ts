import { count, type Vector } from "../../codec/types";
import type { Column, Sheet } from "../table";
import type { Spec } from "./spec";
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
// the last's end, each said as the values it counts; and how many nulls
// and infinities were left out
export type Plotted = {
  x: Float64Array;
  ys: (Float64Array | (number | null)[])[];
  label?: (row: number) => string;
  bins?: { from: number; to: number; said: (bin: number) => string };
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

// A numeric or temporal column's cells, as numbers or seconds since 1970
export function read(vector: Vector): Read {
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
  const scale = seconds(vector.type);
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
// middle of each, as many bins as asked or, if not, as suit the values.
// Bins of a whole number of a column's unit, for a column that counts in
// them, such as days, so that no bin holds more of them than another.
export function binned(sheet: Sheet, spec: Spec): Plotted {
  if (spec.x === null) {
    throw new Error("type", { cause: "histogram of row index" });
  }
  const column = columnOf(sheet, spec.x);
  const values = read(vectorOf(sheet, spec.x));
  const drawn = values.values.filter((v) => !Number.isNaN(v)).sort();
  const n = drawn.length;
  const unit = units[column.type] ?? 0;
  // A time to the millisecond, or the microsecond for bins finer than one
  const write = (v: number) =>
    column.type >= 12
      ? stamp(v, column.type, width < 1e-3 ? 6 : 3)
      : String(Number(v.toPrecision(6)));
  if (!n) {
    return {
      x: new Float64Array(),
      ys: [new Float64Array()],
      ...counted([values]),
    };
  }
  const low = drawn[0];
  const spread = drawn[n - 1] - low;
  // As many bins as asked at most: values of a unit span a unit more than
  // from the lowest to the highest. Else as wide as suits them, rounded
  // up, where they don't count in units, to a width that reads well, the
  // bins starting at a whole number of it: 5 minutes from 09:35, not
  // 4 minutes 51.3 seconds from 09:33:12.7.
  let width = spec.bins ? (spread + unit) / spec.bins : suited(drawn);
  const round = !spec.bins && !unit && spread > 0 && width > 0;
  if (round) {
    width = readable(width, column.type >= 12);
  }
  // One bin, for values all the same: a unit wide, or one either side of
  // them
  const start = round
    ? Math.floor(low / width) * width
    : !spread && !unit
      ? low - 0.5
      : low;
  if (!spread || !width) {
    width = unit || 1;
  } else if (unit) {
    width = Math.max(1, Math.ceil(width / unit - 1e-9)) * unit;
  }
  // A whole number of units has a bin for its highest too; else the
  // highest is in the last bin, which ends with it or after it
  const count = unit
    ? Math.floor(spread / width + 1e-9) + 1
    : Math.max(1, Math.ceil((drawn[n - 1] - start) / width - 1e-9));
  const counts = new Float64Array(count);
  for (const v of drawn) {
    counts[Math.min(count - 1, Math.floor((v - start) / width + 1e-9))]++;
  }
  return {
    x: Float64Array.from(counts, (_, i) => start + (i + 0.5) * width),
    ys: [counts],
    bins: {
      from: start,
      to: start + count * width,
      // From its first value to its last, of a column of units, else from
      // where it starts to where the next does
      said: (bin) => {
        const from = start + bin * width;
        const last = unit ? from + width - unit : from + width;
        return last === from ? write(from) : `${write(from)} – ${write(last)}`;
      },
    },
    ...counted([values]),
  };
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

// The unit of a column of whole units, in the chart's numbers: a short,
// int or long's 1, a date's day, a minute's minute, a second's and a
// time's millisecond. A month isn't one: they differ in length.
const units: Record<number, number> = {
  5: 1,
  6: 1,
  7: 1,
  14: 86400,
  17: 60,
  18: 1,
  19: 0.001,
};

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
