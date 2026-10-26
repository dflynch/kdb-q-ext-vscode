import type { Sheet } from "./table";

// A sheet as CSV: a header of the columns' names, then a line to a row, in
// the order given, each cell as q's csv 0: writes it. Quoted as RFC 4180
// has it, where q's isn't: a cell with a comma, a quote or a line break is
// put in quotes, a quote in it doubled. Lines end in LF, as q's do.
export function csv(sheet: Sheet, rows: Iterable<number>, columns: number[]) {
  const shown = columns.map((j) => sheet.columns[j]);
  const lines = [shown.map(({ name }) => field(name)).join(",")];
  for (const row of rows) {
    lines.push(shown.map((column) => field(column.csv(row))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function field(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
