import type { Sheet } from "../table";
import { type ChartType, fitted, type Spec, xColumns, yColumns } from "./spec";

// The Chart view's settings, beside the chart: its type, then a slot for
// each of the columns it draws, offering only the columns a slot takes

const types: [ChartType, string][] = [
  ["line", "Line"],
  ["bar", "Bar"],
];

// A row's index, offered as an x, by a value no column's name can be: a
// name is a symbol, which can't hold a 0 byte
const index = "\0";

export class Panel {
  readonly element = document.createElement("aside");

  constructor(
    // Told of each change, with the chart to draw
    private readonly changed: (spec: Spec) => void,
  ) {
    this.element.className = "settings";
    this.element.ariaLabel = "Chart settings";
  }

  show(sheet: Sheet, spec: Spec) {
    const change = (to: Partial<Spec>) => {
      const next = fitted({ ...spec, ...to }, sheet);
      this.show(sheet, next);
      this.changed(next);
    };
    const type = select(types, spec.type, (value) =>
      change({ type: value as ChartType }),
    );
    const x = select(
      [
        [index, "Row index"],
        ...xColumns(sheet, spec.type).map((name): [string, string] => [
          name,
          name,
        ]),
      ],
      spec.x ?? index,
      (value) => change({ x: value === index ? null : value }),
    );
    // A series each, offering the numbers neither the x nor another series
    const ys = yColumns(sheet).filter((name) => name !== spec.x);
    const series = spec.y.map((name, i) => {
      const row = document.createElement("div");
      row.className = "series";
      const others = spec.y.filter((_, j) => j !== i);
      const choice = select(
        ys
          .filter((each) => !others.includes(each))
          .map((each): [string, string] => [each, each]),
        name,
        (value) => change({ y: spec.y.map((y, j) => (j === i ? value : y)) }),
      );
      choice.ariaLabel = `Series ${i + 1}`;
      const remove = button("codicon-close", `Remove ${name}`, () =>
        change({ y: others }),
      );
      // A chart has a series at least
      remove.disabled = spec.y.length < 2;
      row.append(choice, remove);
      return row;
    });
    const unused = ys.filter((name) => !spec.y.includes(name));
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
    // Made anew, the control changed keeps the focus, by its place
    const controls = () => [...this.element.querySelectorAll("select, button")];
    const focused = controls().findIndex((each) => each.matches(":focus"));
    this.element.replaceChildren(
      slot("Chart", type),
      slot("X", x),
      slot("Y", ...series, add),
      ...(spec.type === "line" ? [slot("Style", steps)] : []),
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
