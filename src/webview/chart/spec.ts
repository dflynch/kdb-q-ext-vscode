import type { Column, Sheet } from "../table";

// What the Chart view draws of a sheet: its type, then the columns in its
// slots, by their place in the sheet, as two may share a name. The settings
// panel edits it, and a kept tab carries it.

export type ChartType = "line" | "bar" | "histogram" | "scatter";

export type Spec = {
  type: ChartType;
  // The x axis: a column, or null for each row's index. A bar's first
  // label, a histogram's values, and a scatter's x, which are never the
  // index.
  x: number | null;
  // A bar's further columns, after its x, each bar labelled with its cells
  // in them all, as a keyed table's keys name its rows
  labels: number[];
  // The series, numeric columns, drawn in this order
  y: number[];
  // The series hidden by their legend
  hidden: number[];
  // How a line is drawn: joining its points, or as steps; and how many
  // bins a histogram has, or null for as many as suit its values. Each kept
  // while another type is chosen, for coming back to it. A histogram has
  // no series: it counts its values.
  steps: boolean;
  bins: number | null;
  // Each other type's columns, as last chosen, for coming back to it
  others: Partial<Record<ChartType, Columns>>;
};

// A type's columns: its x, a bar's further labels, and its series
export type Columns = Pick<Spec, "x" | "labels" | "y">;

// The most bins a histogram has, typed or not
export const mostBins = 10000;

// A spec of another type: with its columns as they were when it was left,
// should it have been, and this type's kept for coming back to it
export function retyped(spec: Spec, type: ChartType): Spec {
  const { [type]: back, ...others } = spec.others;
  return {
    ...spec,
    ...back,
    type,
    others: {
      ...others,
      [spec.type]: { x: spec.x, labels: spec.labels, y: spec.y },
    },
  };
}

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

// The types a sheet can be drawn as: a line or a bar where there's a number
// for a series, a histogram where there's a number or a time, and a
// scatter where there are two numbers, one by the other
export function typesOf(sheet: Sheet): ChartType[] {
  const ys = yColumns(sheet).length;
  return [
    ...(ys ? ["line", "bar"] : []),
    "histogram",
    ...(ys > 1 ? ["scatter"] : []),
  ] as ChartType[];
}

// The columns a series can be: numbers
export function yColumns(sheet: Sheet): number[] {
  return places(sheet, (column) => kind(column) === "numeric");
}

// The columns a type's x takes: a line's, a number or a time, as it's
// drawn to scale; a bar's, and its further labels, any column, as each
// row's bar is labelled with its cells; not the only number, which would leave no series. A
// histogram's, a number or a time, to count. A scatter's, a number, not the
// only one.
export function xColumns(sheet: Sheet, type: ChartType): number[] {
  const ys = yColumns(sheet);
  return places(
    sheet,
    (column, j) =>
      (type === "bar" ||
        (type === "scatter"
          ? kind(column) === "numeric"
          : kind(column) !== "other")) &&
      (type === "histogram" || !(ys.length === 1 && ys[0] === j)),
  );
}

function places(
  sheet: Sheet,
  takes: (column: Column, j: number) => boolean,
): number[] {
  return sheet.columns.flatMap((column, j) => (takes(column, j) ? [j] : []));
}

// The chart first drawn of a sheet, or none for a sheet with no numbers or
// times. A bar where the first column is neither a number nor a time, a
// label for each row, else a line; a bar's labels a keyed table's keys, as
// they name its rows; a line's x the first time, else the first number; and
// one series, the first number that isn't the x. The x is each row's index
// where no column fits. With times but no numbers, a histogram of the first
// time, as there's nothing for a series.
export function initial(sheet: Sheet): Spec | undefined {
  const first = sheet.columns[0];
  if (!first || !xColumns(sheet, "histogram").length) {
    return undefined;
  }
  const type: ChartType = !yColumns(sheet).length
    ? "histogram"
    : kind(first) === "other"
      ? "bar"
      : "line";
  return fitted(
    {
      type,
      x: initialX(sheet, type),
      labels: Array.from({ length: sheet.keys }, (_, j) => j).slice(1),
      y: [],
      hidden: [],
      steps: false,
      bins: null,
      others: {},
    },
    sheet,
  );
}

// A spec made to fit a sheet: as it is where it does, and otherwise, slot
// by slot, the initial chart's choice. For a type chosen anew, where the
// x may no longer fit, or a spec carried by a kept tab. A bar's labels are
// columns its x could be, each once, and never all the numbers, which
// would leave no series; other types have none.
export function fitted(spec: Spec, sheet: Sheet): Spec {
  const ys = yColumns(sheet);
  const xs = xColumns(sheet, spec.type);
  const x =
    spec.x === null
      ? spec.type === "histogram" || spec.type === "scatter"
        ? initialX(sheet, spec.type)
        : null
      : xs.includes(spec.x)
        ? spec.x
        : initialX(sheet, spec.type);
  // None in a kept tab's spec from before bars had them
  let labels =
    spec.type === "bar" && x !== null
      ? [...new Set(spec.labels ?? [])].filter((j) => j !== x && xs.includes(j))
      : [];
  // The last number labelling given up, while it leaves no series
  while (ys.every((j) => j === x || labels.includes(j))) {
    const last = labels.findLastIndex((j) => ys.includes(j));
    if (last < 0) {
      break;
    }
    labels = labels.filter((_, k) => k !== last);
  }
  const used = (j: number) => j === x || labels.includes(j);
  let y = spec.y.filter((j) => ys.includes(j) && !used(j));
  if (!y.length) {
    const other = ys.find((j) => !used(j));
    y = other === undefined ? [] : [other];
  }
  // A whole number of bins, as typed, as a kept tab may carry any
  const { bins } = spec;
  return {
    ...spec,
    x,
    labels,
    y,
    hidden: spec.hidden.filter((j) => y.includes(j)),
    bins:
      bins !== null && Number.isInteger(bins) && bins >= 1 && bins <= mostBins
        ? bins
        : null,
  };
}

function initialX(sheet: Sheet, type: ChartType): number | null {
  const xs = xColumns(sheet, type);
  if (type === "bar") {
    return xs.includes(0) ? 0 : null;
  }
  const first = (wanted: Kind) =>
    xs.find((j) => kind(sheet.columns[j]) === wanted);
  // A histogram of the first number, else the first time; a scatter by
  // the first number
  return type === "histogram"
    ? (first("numeric") ?? first("temporal") ?? null)
    : type === "scatter"
      ? (first("numeric") ?? null)
      : (first("temporal") ?? first("numeric") ?? null);
}
