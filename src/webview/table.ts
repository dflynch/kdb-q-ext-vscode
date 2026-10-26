import {
  Attribute,
  count,
  type List,
  type Texts,
  type Value,
  type Vector,
} from "../codec/types";
import { cell, element, qText } from "../format/text";

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
  // A row's cell as a value of its own, to drill into
  value(row: number): Value;
  // How two rows' cells order, as q's asc orders them: nulls first
  compare(a: number, b: number): number;
}

export interface Sheet {
  rows: number;
  columns: Column[];
  // How many of the columns, from the left, are a keyed table's keys
  keys: number;
}

// A table, a keyed table, a dictionary as key and value columns, or a list
// as a value column, as a sheet. An atom, a string, which q reads as text
// rather than as characters, anything else, or an on-disk table, which only
// the server can read, is shown only in the Console view.
export function sheet(value: Value): Sheet | undefined {
  if (listed(value) && value.type !== 10) {
    return {
      rows: count(value) ?? 0,
      columns: [column("value", value)],
      keys: 0,
    };
  }
  if (value.type === 98) {
    if (!("data" in value)) {
      return undefined;
    }
    return {
      rows: count(value) ?? 0,
      columns: value.data.map((data, j) => column(value.columns[j], data)),
      keys: 0,
    };
  }
  if (value.type !== 99 && value.type !== 127) {
    return undefined;
  }
  const { keys, values } = value;
  if (keys.type === 98 && values.type === 98) {
    const k = sheet(keys);
    const v = sheet(values);
    return k && v
      ? {
          rows: k.rows,
          columns: [...k.columns, ...v.columns],
          keys: k.columns.length,
        }
      : undefined;
  }
  if (listed(keys) && listed(values)) {
    return {
      rows: count(keys) ?? 0,
      columns: [column("key", keys), column("value", values)],
      keys: 0,
    };
  }
  return undefined;
}

// Whether a value is a vector or a general list
function listed(value: Value): value is Vector | List {
  return value.type >= 0 && value.type <= 19;
}

function column(name: string, data: Vector | List): Column {
  if (data.type !== 0) {
    return {
      name,
      type: data.type,
      text: (row) => cell(data, row),
      value: (row) => element(data, row),
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
      text: (row) => qText(string(row), unbounded),
      value: string,
      compare: (a, b) => bytewise(textAt(strings, a), textAt(strings, b)),
    };
  }
  // Mixed or nested items, as q writes them; ordered by that text, as they
  // have no order of their own
  const { items } = data;
  const text = (row: number) => nested(items[row]);
  return {
    name,
    type: 0,
    text,
    value: (row) => items[row],
    compare: (a, b) => compared(text(a), text(b)),
  };
}

// An item as q writes it, but a table, which has rows and columns of its
// own and can't be read on one line, as what it is and its size
function nested(item: Value): string {
  const rows = count(item);
  const plural = rows === 1 ? "row" : "rows";
  if (item.type === 98 && "data" in item) {
    return `table, ${rows} ${plural}`;
  }
  if ((item.type === 99 || item.type === 127) && item.keys.type === 98) {
    return `keyed table, ${rows} ${plural}`;
  }
  return qText(item, unbounded);
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
