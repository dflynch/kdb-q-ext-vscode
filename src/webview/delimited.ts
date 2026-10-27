import type { Sheet } from "./table";

// A sheet's cells as delimited text: CSV to export, tab-separated to copy

// A sheet as CSV: a header of the columns' names, then a line to a row, in
// the order given, each cell as q's csv 0: writes it. Quoted as RFC 4180
// has it, where q's isn't: a cell with a comma, a quote or a line break is
// put in quotes, a quote in it doubled. Lines end in LF, as q's do. None if
// any of the columns is a mixed list, which q won't write either, as no
// text would hold it whole: their names instead.
export function csv(
  sheet: Sheet,
  rows: Iterable<number>,
  columns: number[],
): { text: string } | { mixed: string[] } {
  const written = delimited(sheet, rows, columns, ",", true, /[",\n\r]/);
  return "text" in written ? { text: `${written.text}\n` } : written;
}

// Cells copied, as a spreadsheet copies them: the same cells as CSV, but
// tab-separated, with the header only when asked for, and quoted only where
// a spreadsheet pasting them would read a cell otherwise: one with a tab or
// a line break, or starting with a quote. No line break after the last, so
// that one cell pastes as itself.
export function tsv(
  sheet: Sheet,
  rows: Iterable<number>,
  columns: number[],
  headers: boolean,
): { text: string } | { mixed: string[] } {
  return delimited(sheet, rows, columns, "\t", headers, /^"|[\t\n\r]/);
}

function delimited(
  sheet: Sheet,
  rows: Iterable<number>,
  columns: number[],
  separator: string,
  headers: boolean,
  // Which cells are quoted
  quoted: RegExp,
): { text: string } | { mixed: string[] } {
  const shown = columns.map((j) => sheet.columns[j]);
  const writers = shown.flatMap(({ csv }) => (csv ? [csv] : []));
  if (writers.length < shown.length) {
    return { mixed: shown.filter(({ csv }) => !csv).map(({ name }) => name) };
  }
  const field = (text: string) =>
    quoted.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  const lines = headers
    ? [shown.map(({ name }) => field(name)).join(separator)]
    : [];
  for (const row of rows) {
    lines.push(writers.map((write) => field(write(row))).join(separator));
  }
  return { text: lines.join("\n") };
}
