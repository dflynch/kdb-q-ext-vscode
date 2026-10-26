import type { Sheet } from "./table";

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
  const shown = columns.map((j) => sheet.columns[j]);
  const writers = shown.flatMap(({ csv }) => (csv ? [csv] : []));
  if (writers.length < shown.length) {
    return { mixed: shown.filter(({ csv }) => !csv).map(({ name }) => name) };
  }
  const lines = [shown.map(({ name }) => field(name)).join(",")];
  for (const row of rows) {
    lines.push(writers.map((write) => field(write(row))).join(","));
  }
  return { text: `${lines.join("\n")}\n` };
}

function field(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
