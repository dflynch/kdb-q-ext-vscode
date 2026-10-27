import type { Sheet } from "../table";
import { type ChartType, fitted, type Spec, xColumns, yColumns } from "./spec";

// The Chart view's settings, beside the chart: its type, and a line's
// style, then a slot for each of the columns it draws, offering only the
// columns a slot takes

const types: [ChartType, string][] = [
  ["line", "Line"],
  ["bar", "Bar"],
  ["histogram", "Histogram"],
];

// A row's index, offered as an x, by a value no column's place can be
const index = "index";

export class Panel {
  readonly element = document.createElement("aside");

  constructor(
    // Told of each change, with the chart to draw, to show anew
    private readonly changed: (spec: Spec) => void,
  ) {
    this.element.className = "settings";
    this.element.ariaLabel = "Chart settings";
  }

  show(sheet: Sheet, spec: Spec) {
    // Each column offered by its place, named as the grid names it
    const named = (j: number): [string, string] => [
      String(j),
      sheet.columns[j].name,
    ];
    const change = (to: Partial<Spec>) => {
      this.changed(fitted({ ...spec, ...to }, sheet));
    };
    const type = select(types, spec.type, (value) =>
      change({ type: value as ChartType }),
    );
    // A histogram counts a column's values, so never the row's index
    const histogram = spec.type === "histogram";
    const x = select(
      [
        ...(histogram ? [] : [[index, "Row index"] as [string, string]]),
        ...xColumns(sheet, spec.type).map(named),
      ],
      spec.x === null ? index : String(spec.x),
      (value) => change({ x: value === index ? null : Number(value) }),
    );
    // A series each, offering the numbers neither the x nor another series
    const ys = yColumns(sheet).filter((j) => j !== spec.x);
    const series = spec.y.map((column, i) => {
      const row = document.createElement("div");
      row.className = "series";
      const others = spec.y.filter((_, j) => j !== i);
      const choice = select(
        ys.filter((j) => !others.includes(j)).map(named),
        String(column),
        (value) =>
          change({ y: spec.y.map((y, k) => (k === i ? Number(value) : y)) }),
      );
      choice.ariaLabel = `Series ${i + 1}`;
      const name = sheet.columns[column].name;
      const remove = button("codicon-close", `Remove ${name}`, () =>
        change({ y: others }),
      );
      // A chart has a series at least
      remove.disabled = spec.y.length < 2;
      row.append(choice, remove);
      return row;
    });
    const unused = ys.filter((j) => !spec.y.includes(j));
    const add = button(
      "codicon-add",
      "Add series",
      () => change({ y: [...spec.y, unused[0]] }),
      true,
    );
    add.disabled = !unused.length;
    const steps = select(
      [
        ["line", "Line"],
        ["steps", "Steps"],
      ],
      spec.steps ? "steps" : "line",
      (value) => change({ steps: value === "steps" }),
    );
    // A histogram's bins: as many as suit its values, else as many as typed,
    // from 1 to 10,000
    const bins = document.createElement("input");
    bins.type = "number";
    bins.min = "1";
    bins.max = "10000";
    bins.placeholder = "Auto";
    bins.ariaLabel = "Bins, or none for as many as suit the values";
    bins.value = spec.bins === null ? "" : String(spec.bins);
    bins.addEventListener("change", () => {
      const typed = Math.round(Number(bins.value));
      change({
        bins:
          bins.value.trim() && Number.isFinite(typed)
            ? Math.min(10000, Math.max(1, typed))
            : null,
      });
    });
    // Made anew, the control changed keeps the focus, by its place
    const controls = () => [
      ...this.element.querySelectorAll("select, input, button"),
    ];
    const focused = controls().findIndex((each) => each.matches(":focus"));
    this.element.replaceChildren(
      slot("Chart", type),
      // How a line or a histogram is drawn, with its type, before the
      // columns
      ...(spec.type === "line" ? [slot("Style", steps)] : []),
      ...(histogram
        ? [slot("Bins", bins), slot("Values", x)]
        : [slot("X", x), slot("Y", ...series, add)]),
    );
    const now = controls();
    if (focused >= 0) {
      (now[Math.min(focused, now.length - 1)] as HTMLElement).focus();
    }
  }
}

// A slot: its name above what fills it
function slot(name: string, ...controls: HTMLElement[]): HTMLElement {
  const group = document.createElement("div");
  group.className = "slot";
  group.role = "group";
  const label = document.createElement("div");
  label.className = "name";
  label.textContent = name;
  group.ariaLabel = name;
  group.append(label, ...controls);
  return group;
}

function select(
  options: [value: string, text: string][],
  chosen: string,
  chose: (value: string) => void,
): HTMLSelectElement {
  const element = document.createElement("select");
  for (const [value, text] of options) {
    element.append(new Option(text, value, false, value === chosen));
  }
  element.addEventListener("change", () => chose(element.value));
  return element;
}

// A button with an icon, and its label beside it or, if not, as its tooltip
function button(
  icon: string,
  label: string,
  pressed: () => void,
  labelled = false,
): HTMLButtonElement {
  const element = document.createElement("button");
  const symbol = document.createElement("span");
  symbol.className = `codicon ${icon}`;
  symbol.ariaHidden = "true";
  element.append(symbol);
  if (labelled) {
    element.append(label);
  } else {
    element.title = label;
    element.ariaLabel = label;
  }
  element.addEventListener("click", pressed);
  return element;
}
