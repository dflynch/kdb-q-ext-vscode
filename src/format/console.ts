import {
  Attribute,
  count,
  type List,
  type Value,
  type Vector,
} from "../codec/types";
import { cell, qText } from "./text";

// How much of a value to show, as q's \c sets for its console: lines past
// the first lines - 1 become .., and so does the end of a line wider than
// width. The panel scrolls, so both are far beyond q's 25 by 80.
export type Size = { lines: number; width: number };

export const defaultSize: Size = { lines: 5000, width: 5000 };

// A value as the q console shows it, for any result but a table or a
// dictionary, which go to the grid
export function show(value: Value, size: Size = defaultSize): string {
  // The generic null
  if (value.type === 101 && value.code === 0) {
    return "";
  }
  // Only a function's text can run over lines, a lambda's source as written
  const limit = value.type >= 100 ? size.width * size.lines : size.width;
  const lines = value.type === 0 ? column(value, size) : [qText(value, limit)];
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
      qText(itemAt(list, i), size.width),
    );
  }
  const rows = list.items.slice(0, shown) as (Vector | List)[];
  const flat = rows.map((row) => row.type === 0 && matrix(itemsOf(row)));
  const length = count(rows[0]) ?? 0;
  const lines = rows.map(() => "");
  // Column by column, until the lines are full
  for (let j = 0; j < length && lines[0].length <= size.width; j++) {
    const cells = rows.map((row, i) => entry(row, j, flat[i], size.width));
    const width = Math.max(...cells.map((c) => c.length));
    cells.forEach((c, i) => {
      lines[i] += (j ? " " : "") + c.padEnd(width);
    });
  }
  return lines;
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

// The jth entry of a matrix's row. A vector's element is a cell, a list's
// item is in q's form, and the item of a row that's a matrix itself is
// flattened into cells.
function entry(
  row: Vector | List,
  j: number,
  flat: boolean,
  limit: number,
): string {
  if (row.type !== 0) {
    return cell(row, j);
  }
  const item = itemAt(row, j);
  return flat ? cells(item as Vector | List, limit) : qText(item, limit);
}

// A list as cells side by side, flattening any matrix in it
function cells(list: Vector | List, limit: number): string {
  const flat = list.type === 0 && matrix(itemsOf(list));
  const n = count(list) ?? 0;
  const parts: string[] = [];
  for (let j = 0, length = 0; j < n && length <= limit; j++) {
    parts.push(entry(list, j, flat, limit));
    length += parts[j].length + 1;
  }
  return parts.join(" ");
}

function itemsOf(list: List): Value[] {
  return "items" in list ? list.items : [];
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
