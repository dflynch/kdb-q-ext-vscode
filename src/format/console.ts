import {
  Attribute,
  count,
  type List,
  type Value,
  type Vector,
} from "../codec/types";
import { cell, qText, type Size } from "./text";

export type { Size };

// How much of a value to show, like q's \c for its console but far larger,
// as the panel scrolls: lines past the first lines - 1 become .., and so
// does the end of a line wider than width
export const defaultSize: Size = { lines: 5000, width: 5000 };

// A value as the q console shows it, for any result but a table or a
// dictionary, which go to the grid
export function show(value: Value, size: Size = defaultSize): string {
  // The generic null
  if (value.type === 101 && value.code === 0) {
    return "";
  }
  // Only a lambda's source, as written, runs over lines
  const lines = value.type === 0 ? column(value, size) : [qText(value, size)];
  return cut(
    lines.flatMap((line) => line.split("\n")),
    size,
  ).join("\n");
}

function cut(lines: string[], size: Size): string[] {
  const shown =
    lines.length > size.lines
      ? [...lines.slice(0, size.lines - 1), ".."]
      : lines;
  return shown.map((line) =>
    line.length > size.width ? `${line.slice(0, size.width - 2)}..` : line,
  );
}

// A general list, one item to a line. When every item is a list of the same
// length, they're the rows of a matrix, its columns lined up.
function column(list: List, size: Size): string[] {
  // Only as many as can be shown, and one more for the ..
  const shown = Math.min(count(list) ?? 0, size.lines + 1);
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
  const lines = rows.map(() => "");
  // Column by column, until the lines are full
  for (let j = 0; j < columns && lines[0].length <= size.width; j++) {
    const cells = rows.map((row, i) =>
      row.type !== 0
        ? cell(row, j)
        : (inner[i]?.[j] ?? qText(itemAt(row, j), size)),
    );
    const width = Math.max(...cells.map((c) => c.length));
    cells.forEach((c, i) => {
      lines[i] += (j ? " " : "") + c.padEnd(width);
    });
  }
  return lines;
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
