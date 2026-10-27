import { count, type Vector } from "../../codec/types";
import type { Column, Sheet } from "../table";
import type { Spec } from "./spec";

// A sheet's columns as the chart draws them: numbers, times as seconds
// since 1970, read as UTC so that no time zone shifts them, and nulls and infinities left out, and counted, so the
// chart can say what it didn't draw. Never a JavaScript number per cell
// where a typed array will do.

// A column's cells as numbers, NaN for a null or an infinity
type Read = { values: Float64Array; nulls: number; infinities: number };

// What's drawn: the x, ascending, and a series for each column, null where
// a cell is left out; a bar's label, by its row, made only for the bars a
// tick or the cursor is at; and how many nulls and infinities were left out
export type Plotted = {
  x: Float64Array;
  ys: (Float64Array | (number | null)[])[];
  label?: (row: number) => string;
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
  const ys = spec.y.map((name) => read(vectorOf(sheet, name)));
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
  const ys = spec.y.map((name) => read(vectorOf(sheet, name)));
  const x = spec.x === null ? undefined : columnOf(sheet, spec.x);
  return {
    x: Float64Array.from({ length: sheet.rows }, (_, i) => i),
    ys: ys.map(({ values }) => gapped(values)),
    label: x ? (row) => x.text(row) : String,
    ...counted(ys),
  };
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

function columnOf(sheet: Sheet, name: string): Column {
  const column = sheet.columns.find((each) => each.name === name);
  if (!column) {
    throw new Error("name", { cause: `charted column ${name} not in sheet` });
  }
  return column;
}

function vectorOf(sheet: Sheet, name: string): Vector {
  const { vector } = columnOf(sheet, name);
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
