import type { Column, Sheet } from "../table";

// What the Chart view draws of a sheet: its type, then the columns in its
// slots, by name. The settings panel edits it, and a kept tab carries it.

export type ChartType = "line" | "bar";

export type Spec = {
  type: ChartType;
  // The x axis: a column, or null for each row's index
  x: string | null;
  // The series, numeric columns, drawn in this order
  y: string[];
  // The series hidden by their legend
  hidden: string[];
  // How a line is drawn: joining its points, or as steps. Kept while
  // another type is chosen, for coming back to a line.
  steps: boolean;
};

// What a column holds, as the slots take them
export type Kind = "numeric" | "temporal" | "other";

// Short, int, long, real and float; and timestamp to time
export function kind({ type }: Pick<Column, "type">): Kind {
  return type >= 5 && type <= 9
    ? "numeric"
    : type >= 12 && type <= 19
      ? "temporal"
      : "other";
}

// The columns a type's x takes: a line's, a number or a time, as it's
// drawn to scale; a bar's, any column, as each row's bar is labelled with
// its cell
export function xColumns(sheet: Sheet, type: ChartType): string[] {
  return sheet.columns
    .filter((column) => type === "bar" || kind(column) !== "other")
    .map((column) => column.name);
}

// The columns a series can be: numbers
export function yColumns(sheet: Sheet): string[] {
  return sheet.columns
    .filter((column) => kind(column) === "numeric")
    .map((column) => column.name);
}

// The chart first drawn of a sheet, or none for a sheet with no numbers.
// A bar where the first column is neither a number nor a time, a label for
// each row, else a line; a line's x the first time, else the first number;
// and one series, the first number that isn't the x. A line's x is each
// row's index where no number is left for a series.
export function initial(sheet: Sheet): Spec | undefined {
  const first = sheet.columns[0];
  if (!first || !yColumns(sheet).length) {
    return undefined;
  }
  const type: ChartType = kind(first) === "other" ? "bar" : "line";
  return fitted(
    { type, x: initialX(sheet, type), y: [], hidden: [], steps: false },
    sheet,
  );
}

// A spec made to fit a sheet: as it is where it does, and otherwise, slot
// by slot, the initial chart's choice. For a type chosen anew, where the
// x may no longer fit, or a spec carried by a kept tab.
export function fitted(spec: Spec, sheet: Sheet): Spec {
  const ys = yColumns(sheet);
  const x =
    spec.x === null || xColumns(sheet, spec.type).includes(spec.x)
      ? spec.x
      : initialX(sheet, spec.type);
  let y = spec.y.filter((name) => ys.includes(name) && name !== x);
  if (!y.length) {
    const other = ys.find((name) => name !== x);
    y = other === undefined ? [] : [other];
  }
  return {
    ...spec,
    x,
    y,
    hidden: spec.hidden.filter((name) => y.includes(name)),
  };
}

function initialX(sheet: Sheet, type: ChartType): string | null {
  if (type === "bar") {
    return sheet.columns[0]?.name ?? null;
  }
  const x =
    sheet.columns.find((column) => kind(column) === "temporal") ??
    sheet.columns.find((column) => kind(column) === "numeric");
  // A number as the x, where it's the only one, leaves no series
  return x && yColumns(sheet).some((name) => name !== x.name) ? x.name : null;
}
