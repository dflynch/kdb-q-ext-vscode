import {
  Attribute,
  count,
  type Dictionary,
  type List,
  type Table,
  type Value,
  type Vector,
} from "../codec/types";
import { type Bounds, cell, qText } from "./text";

// A value as text, as the q console shows it: a port of q's own .Q.s2 and
// .Q.S, whose source q prints, to compare with when q changes

// How much text to show: as many lines, each as wide as width, and in all
// no more than characters, where it's given. Our own measure, not q's \c,
// which leaves room for the prompt: \c 25 80 shows 23 lines of 79.
export type Size = Bounds & { characters?: number };

// How much of a value to show: far more than q's \c, as the panel scrolls.
// A value with more lines shows the first 4999 and then .., and a wider
// line shows its first 4998 characters and then ... Lines past a million
// characters in all become .. too, so that what reaches the panel stays
// small even when many lines are wide.
export const defaultSize: Size = {
  lines: 5000,
  width: 5000,
  characters: 1_000_000,
};

// A value as the q console shows it
export function show(value: Value, size: Size = defaultSize): string {
  // The generic null
  if (value.type === 101 && value.code === 0) {
    return "";
  }
  // Lists, tables and dictionaries are laid out a line to an item, so need
  // only as many items as there are lines. Anything else is in q's form,
  // where only a lambda's source, as written, runs over lines.
  const laid = [0, 98, 99, 127].includes(value.type)
    ? lines(value, size.lines + 1, size)
    : [qText(value, size)];
  return cut(
    laid.flatMap((line) => line.split("\n")),
    size,
  ).join("\n");
}

function cut(lines: string[], size: Size): string[] {
  const shown = (
    lines.length > size.lines
      ? [...lines.slice(0, size.lines - 1), ".."]
      : lines
  ).map((line) =>
    line.length > size.width ? `${line.slice(0, size.width - 2)}..` : line,
  );
  // Then the line that takes it past the characters, with the newlines
  // between, becomes .., and any after it go
  const characters = size.characters ?? Number.POSITIVE_INFINITY;
  let total = -1;
  for (let i = 0; i < shown.length; i++) {
    total += shown[i].length + 1;
    if (total > characters) {
      return [...shown.slice(0, i), ".."];
    }
  }
  return shown;
}

// The lines of a value's first rows items, as q's .Q.s2 lays them out: a
// vector's elements as cells, a table under its header, a dictionary's keys
// beside their values, and a general list a line to an item
function lines(value: Value, rows: number, size: Size): string[] {
  switch (value.type) {
    case 0:
      return column(value, rows, size);
    case 98:
      return table(value, rows, size);
    case 99:
    case 127:
      return dictionary(value, rows, size);
  }
  if (value.type > 0 && value.type <= 19) {
    const vector = value as Vector;
    const n = Math.min(count(vector) ?? 0, rows);
    return Array.from({ length: n }, (_, i) => cell(vector, i));
  }
  return [qText(value, size)];
}

// A general list, one item to a line. When every item is a list of the same
// length, they're the rows of a matrix, its columns lined up.
function column(list: List, rows: number, size: Size): string[] {
  const shown = Math.min(count(list) ?? 0, rows);
  if (!("items" in list) || !matrix(list.items)) {
    return Array.from({ length: shown }, (_, i) =>
      qText(itemAt(list, i), size),
    );
  }
  return layout(list.items.slice(0, shown) as (Vector | List)[], size);
}

// Whether items are a matrix's rows: lists all of the same length, other
// than strings, booleans or bytes all of one type, which q shows as they are
function matrix(items: Value[]): boolean {
  const length = items.length ? count(items[0]) : undefined;
  return (
    items.length > 0 &&
    items.every(
      (item) => item.type >= 0 && item.type <= 19 && count(item) === length,
    ) &&
    !items.every(
      (item) => [1, 4, 10].includes(item.type) && item.type === items[0].type,
    )
  );
}

// A matrix's lines. A vector's element is a cell and a list's item is in
// q's form, but a row that's a matrix itself is laid out as one, its jth
// line its jth entry, so a 3-D array lines up as q's does.
function layout(rows: (Vector | List)[], size: Size): string[] {
  const length = count(rows[0]) ?? 0;
  // Each entry takes at least a character and a space
  const columns = Math.min(length, size.width);
  const inner = rows.map((row) =>
    row.type === 0 && "items" in row && matrix(row.items)
      ? layout(row.items.slice(0, columns) as (Vector | List)[], size)
      : undefined,
  );
  return besides(rows.length, columns, size, (j) =>
    rows.map((row, i) =>
      row.type !== 0
        ? cell(row, j)
        : (inner[i]?.[j] ?? qText(itemAt(row, j), size)),
    ),
  );
}

// Lines of columns side by side, each padded to its widest and a space
// apart, until the lines are full
function besides(
  height: number,
  columns: number,
  size: Size,
  cells: (j: number) => string[],
): string[] {
  const lines = Array.from({ length: height }, () => "");
  for (let j = 0; j < columns && lines[0].length <= size.width; j++) {
    const column = cells(j);
    const width = Math.max(...column.map((c) => c.length));
    lines.forEach((line, i) => {
      lines[i] = `${line}${j ? " " : ""}${(column[i] ?? "").padEnd(width)}`;
    });
  }
  return lines;
}

// A table: its column names, dashes, then a line to a row
function table(t: Table, rows: number, size: Size): string[] {
  if ("reference" in t) {
    // Only the server can read an on-disk table's files
    return [qText(t, size)];
  }
  const n = Math.min(count(t) ?? 0, rows);
  const body = besides(n + 1, t.columns.length, size, (j) => [
    t.columns[j],
    ...lines(t.data[j], n, size),
  ]);
  return [body[0], "-".repeat(body[0].length), ...body.slice(1)];
}

// A dictionary: its keys, padded, beside their values. A table on one side
// gives that side a header, and the other a blank line and dashes to match.
function dictionary(d: Dictionary, rows: number, size: Size): string[] {
  let keys = lines(d.keys, rows, size);
  let values = lines(d.values, rows, size);
  if (values.length > keys.length) {
    keys = headed(keys);
  } else if (keys.length > values.length) {
    values = headed(values);
  }
  const width = Math.max(0, ...keys.map((k) => k.length));
  return keys.map((k, i) => `${k.padEnd(width)}| ${values[i] ?? ""}`);
}

function headed(lines: string[]): string[] {
  const width = lines[0]?.length ?? 0;
  return [" ".repeat(width), "-".repeat(width), ...lines];
}

// A list's ith item, with a list of strings' as a char vector
function itemAt(list: List, i: number): Value {
  if ("items" in list) {
    return list.items[i];
  }
  const { bytes, offsets } = list.strings;
  return {
    type: 10,
    attribute: Attribute.None,
    data: bytes.subarray(offsets[i], offsets[i + 1]),
  };
}
