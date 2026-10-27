import uPlot from "uplot";
import type { Sheet } from "../table";
import { barred, lined, type Plotted } from "./data";
import type { Spec } from "./spec";
import { stamp, ticks } from "./time";

// The Chart view: a spec of a sheet drawn by uPlot. Only this file knows
// uPlot.

// Series in VS Code's own chart colours, as its views draw them, in turn
const palette = ["blue", "orange", "green", "purple", "red", "yellow"];

// uPlot draws on a canvas, which takes colours and fonts as values, not
// VS Code's variables: so they're read as the chart's drawn, and again as
// the theme changes
function styles() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  // As small as the tabs' names
  const font = `11px ${read("--vscode-font-family") || "sans-serif"}`;
  return {
    text: read("--vscode-descriptionForeground"),
    lines: read("--vscode-charts-lines"),
    font,
    series: palette.map((colour) => read(`--vscode-charts-${colour}`)),
  };
}

export class Chart {
  private plot?: uPlot;
  private drawn?: { sheet: Sheet; spec: Spec };
  private readonly resized = new ResizeObserver(() => this.fit());
  // VS Code changes its variables, on the page's root, with the theme
  private readonly themed = new MutationObserver(() => this.redraw());

  constructor(
    private readonly place: HTMLElement,
    // Told the series hidden, each time the legend hides or shows one
    private readonly hid: (hidden: string[]) => void,
  ) {}

  // Draw a spec of a sheet, in place of what was. It says what's drawn,
  // for what was left out.
  draw(sheet: Sheet, spec: Spec): Plotted {
    this.clear();
    this.drawn = { sheet, spec };
    const plotted =
      spec.type === "bar" ? barred(sheet, spec) : lined(sheet, spec);
    const x =
      spec.x === null
        ? undefined
        : sheet.columns.find(({ name }) => name === spec.x);
    const time = x && x.type >= 12 && x.type <= 19 ? x.type : undefined;
    const { text, lines, font, series } = styles();
    const colour = (i: number) => series[i % series.length];
    const axis: uPlot.Axis = {
      stroke: text,
      font,
      grid: { stroke: lines, width: 1 },
      ticks: { stroke: lines, width: 1 },
      size: depth,
    };
    const { label } = plotted;
    const bars = spec.y.length;
    // Each row's bars side by side, filling 80% of its width
    const width = 0.8 / bars;
    const starts = spec.y.map((_, k) =>
      plotted.x.map((i) => i - 0.4 + k * width),
    );
    const wide = label ? widest(label, sheet.rows, font) : 0;
    const options: uPlot.Options = {
      width: this.place.clientWidth,
      height: this.place.clientHeight,
      // Room for half a bar's label beyond the first and last
      padding: [null, wide / 2, null, Math.max(0, wide / 2 - 40)],
      // Times as they are: a q time has no time zone, so it's read as
      // UTC, which no zone shifts, and never as the machine's local time
      tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), "Etc/UTC"),
      scales: {
        x: label
          ? // Each row's bars about its index, half a row out at each end
            { time: false, range: (_, min, max) => [min - 0.5, max + 0.5] }
          : { time: time !== undefined },
        // Bars from 0, their heights to scale: with some room past the
        // tallest, as uPlot's own range has
        ...(label && {
          y: {
            range: (_, min, max) =>
              uPlot.rangeNum(Math.min(0, min), Math.max(0, max), 0.1, true),
          },
        }),
      },
      series: [
        {
          label: spec.x ?? "Row index",
          value: (_, value, __, i) =>
            value === null || i === null
              ? ""
              : label
                ? label(i)
                : time !== undefined
                  ? stamp(value, time)
                  : String(value),
        },
        ...spec.y.map(
          (name, k): uPlot.Series => ({
            label: name,
            stroke: colour(k),
            width: 1,
            show: !spec.hidden.includes(name),
            ...(label
              ? {
                  fill: colour(k),
                  paths: uPlot.paths.bars?.({
                    disp: {
                      x0: {
                        unit: 1,
                        // A typed array, read by index as an array is
                        values: () => starts[k] as unknown as number[],
                      },
                      size: { unit: 1, values: () => [width] },
                    },
                  }),
                  points: { show: false },
                }
              : spec.steps
                ? { paths: uPlot.paths.stepped?.({ align: 1 }) }
                : {}),
          }),
        ),
      ],
      axes: [
        {
          ...axis,
          ...(label
            ? {
                // A label at each row whose index falls on a tick, the
                // ticks as far apart as the longest label is wide
                incrs: [
                  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 1e4, 1e5, 1e6,
                ],
                space: wide + 16,
                values: (_, splits) =>
                  splits.map((i) =>
                    Number.isInteger(i) && i >= 0 && i < sheet.rows
                      ? label(i)
                      : "",
                  ),
              }
            : time !== undefined
              ? {
                  values: (_, splits, __, ___, apart) =>
                    ticks(splits, time, apart),
                }
              : {}),
        },
        axis,
      ],
      hooks: {
        setSeries: [
          (plot) => {
            const hidden = spec.y.filter((_, k) => !plot.series[k + 1].show);
            // Drawn so again, should the theme change
            this.drawn = { sheet, spec: { ...spec, hidden } };
            this.hid(hidden);
          },
        ],
      },
    };
    this.plot = new uPlot(
      options,
      [plotted.x, ...plotted.ys] as unknown as uPlot.AlignedData,
      this.place,
    );
    this.fit();
    this.resized.observe(this.place);
    this.themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    this.themed.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return plotted;
  }

  clear() {
    this.resized.disconnect();
    this.themed.disconnect();
    this.plot?.destroy();
    this.plot = undefined;
  }

  // The plot fills the place, the legend below it
  private fit() {
    const plot = this.plot;
    if (!plot) {
      return;
    }
    const legend = plot.root.querySelector<HTMLElement>(".u-legend");
    const height = this.place.clientHeight - (legend?.offsetHeight ?? 0);
    const width = this.place.clientWidth;
    if (width !== plot.width || height !== plot.height) {
      plot.setSize({ width, height: Math.max(height, 0) });
    }
  }

  private redraw() {
    const drawn = this.drawn;
    if (drawn) {
      this.draw(drawn.sheet, drawn.spec);
    }
  }
}

// How wide the longest of the bars' labels is, in the font: by characters,
// as measuring each of a million would take too long, and of ten thousand
// at most, evenly apart, as making each would too
function widest(
  label: (row: number) => string,
  rows: number,
  font: string,
): number {
  const step = Math.max(1, Math.ceil(rows / 10000));
  let longest = "";
  for (let row = 0; row < rows; row += step) {
    const text = label(row);
    if (text.length > longest.length) {
      longest = text;
    }
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return 50;
  }
  context.font = font;
  return context.measureText(longest).width;
}

// An axis as deep as its labels need: as wide as the widest, for the y, or
// as tall as their lines, for the x
function depth(
  plot: uPlot,
  values: string[],
  axisIdx: number,
  cycle: number,
): number {
  const axis = plot.axes[axisIdx];
  if (cycle > 1) {
    return (axis as { _size?: number })._size ?? 0;
  }
  const gap = (axis.ticks?.size ?? 10) + (axis.gap ?? 5);
  // uPlot keeps an axis's font as the font and its size
  plot.ctx.font = (axis.font as unknown as [string, number])[0];
  if (axisIdx === 0) {
    const lines = Math.max(
      1,
      ...(values ?? []).map((v) => v.split("\n").length),
    );
    const { fontBoundingBoxAscent, fontBoundingBoxDescent } =
      plot.ctx.measureText("0");
    return Math.ceil(
      gap +
        (lines * (fontBoundingBoxAscent + fontBoundingBoxDescent)) /
          devicePixelRatio +
        4,
    );
  }
  const widest = Math.max(
    0,
    ...(values ?? []).map((v) => plot.ctx.measureText(v).width),
  );
  return Math.ceil(gap + widest / devicePixelRatio + 4);
}
