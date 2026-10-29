import {
  Attribute,
  count,
  type List,
  type Texts,
  type Value,
  type Vector,
} from "../codec/types";
import { cell, csvCell, decoded, element, qText } from "../format/text";

// What the Grid view shows of a result, apart from the grid that shows it:
// columns read a row at a time, by the row's index in the result, so that a
// million rows are never a million objects or strings here. Only the cells
// a grid draws are made into text, and sorting compares q's own values.

export interface Column {
  name: string;
  // The column's type on the wire: a vector's, or 0 for a general list
  type: number;
  // A row's cell as the q console shows it in a column
  text(row: number): string;
  // A row's cell as q's csv 0: writes it; none for a mixed list, which q
  // won't write, but a string column
  csv?: (row: number) => string;
  // A row's cell, where it's a table, as its shape, shown as a symbol
  shape?: (row: number) => Shape | undefined;
  // A row's cell as a value of its own, to drill into
  value(row: number): Value;
  // The column itself, where it's a vector, for the Chart to read at once
  vector?: Vector;
  // How two rows' cells order, as q's asc orders them: nulls first
  compare(a: number, b: number): number;
}

export interface Sheet {
  rows: number;
  columns: Column[];
  // How many of the columns, from the left, are a keyed table's keys
  keys: number;
}

// What the Grid shows, as a sheet: a table; a list as a value column, but a
// string, which q reads as text; or a dictionary, a keyed table among them,
// as its keys, pinned, then its values, as q's console lays it out, each
// side a table's columns or a list as a key or a value column. An atom,
// anything else, or an on-disk table, which only the server can read, is
// shown only in the Console view. Floats and reals are written to the
// precision given, as q's \P.
export function sheet(value: Value, precision: number): Sheet | undefined {
  if (listed(value) && value.type !== 10) {
    return {
      rows: count(value) ?? 0,
      columns: [column("value", value, precision)],
      keys: 0,
    };
  }
  if (value.type === 98) {
    if (!("data" in value)) {
      return undefined;
    }
    return {
      rows: count(value) ?? 0,
      columns: value.data.map((data, j) =>
        column(value.columns[j], data, precision),
      ),
      keys: 0,
    };
  }
  if (value.type !== 99 && value.type !== 127) {
    return undefined;
  }
  const k = side(value.keys, "key", precision);
  const v = side(value.values, "value", precision);
  return k && v
    ? {
        rows: k.rows,
        columns: [...k.columns, ...v.columns],
        keys: k.columns.length,
      }
    : undefined;
}

// A dictionary's keys or values as columns: a table's own, or a list as one
// column of that name
function side(
  value: Value,
  name: string,
  precision: number,
): Omit<Sheet, "keys"> | undefined {
  if (value.type === 98) {
    return sheet(value, precision);
  }
  return listed(value)
    ? { rows: count(value) ?? 0, columns: [column(name, value, precision)] }
    : undefined;
}

// Whether a value is a vector or a general list
function listed(value: Value): value is Vector | List {
  return value.type >= 0 && value.type <= 19;
}

function column(name: string, data: Vector | List, precision: number): Column {
  const bounds = { ...unbounded, precision };
  if (data.type !== 0) {
    return {
      name,
      type: data.type,
      text: (row) => cell(data, row, precision),
      csv: (row) => csvCell(data, row, precision),
      value: (row) => element(data, row),
      vector: data,
      compare: order(data),
    };
  }
  if ("strings" in data) {
    const { strings } = data;
    // Each string as q writes it, as the console shows it in a column
    const string = (row: number): Value => ({
      type: 10,
      attribute: Attribute.None,
      data: textAt(strings, row),
    });
    return {
      name,
      type: 0,
      text: (row) => qText(string(row), bounds),
      csv: (row) => decoded(textAt(strings, row)),
      value: string,
      compare: (a, b) => bytewise(textAt(strings, a), textAt(strings, b)),
    };
  }
  // Mixed or nested items, as q writes them, but a table as its shape.
  // Ordered by that text, as they have no order of their own, but tables
  // by their shapes, after the rest.
  const { items } = data;
  const text = (row: number) => {
    const table = shape(items[row]);
    return table
      ? `${table.rows} × ${table.columns}`
      : qText(items[row], bounds);
  };
  return {
    name,
    type: 0,
    text,
    shape: (row) => shape(items[row]),
    value: (row) => items[row],
    compare: (a, b) => {
      const x = shape(items[a]);
      const y = shape(items[b]);
      if (x && y) {
        return (
          Number(x.keyed) - Number(y.keyed) ||
          x.rows - y.rows ||
          x.columns - y.columns
        );
      }
      return x ? 1 : y ? -1 : compared(text(a), text(b));
    },
  };
}

// A table in a cell, which has rows and columns of its own and can't be read
// on one line, as its rows and columns, a keyed table's keys among them, as
// the Grid shows it drilled into
export type Shape = { keyed: boolean; rows: number; columns: number };

function shape(item: Value): Shape | undefined {
  // Not an on-disk table, which is only its name
  if (item.type === 98 && "data" in item) {
    return {
      keyed: false,
      rows: count(item) ?? 0,
      columns: item.columns.length,
    };
  }
  if (
    (item.type === 99 || item.type === 127) &&
    item.keys.type === 98 &&
    item.values.type === 98
  ) {
    return {
      keyed: true,
      rows: count(item) ?? 0,
      columns: item.keys.columns.length + item.values.columns.length,
    };
  }
  return undefined;
}

// A shape in words
export function said({ keyed, rows, columns }: Shape): string {
  const counted = (n: number, what: string) =>
    `${n} ${what}${n === 1 ? "" : "s"}`;
  return `${keyed ? "Keyed table" : "Table"}, ${counted(rows, "row")} and ${counted(columns, "column")}`;
}

// A cell isn't cut in the grid, which shows as much of it as fits
const unbounded = {
  lines: Number.POSITIVE_INFINITY,
  width: Number.POSITIVE_INFINITY,
};

// How a vector's elements order, as q's asc orders them. A null is its
// type's smallest value, an infinity its largest, so integers and temporals
// order as they are, but a floating-point null is NaN, which goes first.
// Symbols, strings and guids order by their bytes.
function order(vector: Vector): (a: number, b: number) => number {
  switch (vector.type) {
    case 2: {
      const guids = vector.data;
      return (a, b) =>
        bytewise(
          guids.subarray(16 * a, 16 * a + 16),
          guids.subarray(16 * b, 16 * b + 16),
        );
    }
    case 8:
    case 9:
    case 15: {
      const floats = vector.data;
      return (a, b) => {
        const x = floats[a];
        const y = floats[b];
        return Number.isNaN(x) || Number.isNaN(y)
          ? Number(Number.isNaN(y)) - Number(Number.isNaN(x))
          : compared(x, y);
      };
    }
    case 11: {
      const symbols = vector.data;
      return (a, b) => bytewise(textAt(symbols, a), textAt(symbols, b));
    }
  }
  const data: ArrayLike<number | bigint> = vector.data;
  return (a, b) => compared(data[a], data[b]);
}

function compared<T extends number | bigint | string>(x: T, y: T): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function bytewise(x: Uint8Array, y: Uint8Array): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) {
      return x[i] - y[i];
    }
  }
  return x.length - y.length;
}

function textAt(texts: Texts, i: number): Uint8Array {
  return texts.bytes.subarray(texts.offsets[i], texts.offsets[i + 1]);
}
