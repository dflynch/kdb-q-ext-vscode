import uPlot from "uplot";
import type { Sheet } from "../table";
import { barred, binned, fine, lined, type Plotted } from "./data";
import type { Spec } from "./spec";
import { stamp, ticks } from "./time";

// The Chart view: a spec of a sheet drawn by uPlot. Only this file knows
// uPlot.

// Ticks for dates, as far apart as uPlot's own: days, then months and years
// as uPlot counts them
const day = 86400;
const days = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15].map((n) => n * day);
const months = [
  ...[1, 2, 3, 4, 6].map((n) => n * 30 * day),
  ...[1, 2, 5, 10, 25, 50, 100].map((n) => n * 365 * day),
];

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
    private readonly hid: (hidden: number[]) => void,
  ) {}

  // Draw a spec of a sheet, in place of what was. It says what's drawn,
  // for what was left out.
  draw(sheet: Sheet, spec: Spec): Plotted {
    this.clear();
    this.drawn = { sheet, spec };
    const plotted =
      spec.type === "bar"
        ? barred(sheet, spec)
        : spec.type === "histogram"
          ? binned(sheet, spec)
          : lined(sheet, spec);
    const x = spec.x === null ? undefined : sheet.columns[spec.x];
    const time = x && x.type >= 12 && x.type <= 19 ? x.type : undefined;
    const named = (j: number) => sheet.columns[j].name;
    // A line of one x, which uPlot would put at the left of a thousand
    // days, at the middle of its own unit either side: a month, a day, a
    // minute, else a second
    const { x: xs } = plotted;
    const single = xs.length > 0 && xs[0] === xs[xs.length - 1];
    const unit =
      time === 13 ? 31 * day : time === 14 ? day : time === 17 ? 60 : 1;
    const { text, lines, font, series } = styles();
    const colour = (i: number) => series[i % series.length];
    const axis: uPlot.Axis = {
      stroke: text,
      font,
      grid: { stroke: lines, width: 1 },
      ticks: { stroke: lines, width: 1 },
      size: depth,
    };
    const { label, bins } = plotted;
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
          : bins
            ? {
                time: time !== undefined,
                // All the bins, from the first's start to the last's end,
                // where uPlot would go from the middle of one to the
                // other's, or pad a lone one as it likes; or as zoomed
                range: (_, min, max): uPlot.Range.MinMax =>
                  single || (min === xs[0] && max === xs[xs.length - 1])
                    ? [bins.from, bins.to]
                    : [min, max],
              }
            : {
                time: time !== undefined,
                ...(single &&
                  time !== undefined && {
                    range: (): uPlot.Range.MinMax => [
                      xs[0] - unit,
                      xs[0] + unit,
                    ],
                  }),
              },
        // Bars from 0, their heights to scale: with some room past the
        // tallest, as uPlot's own range has
        ...((label || bins) && {
          y: {
            range: (_, min, max) =>
              uPlot.rangeNum(Math.min(0, min), Math.max(0, max), 0.1, true),
          },
        }),
      },
      series: [
        {
          label: x?.name ?? "Row index",
          // A timestamp or timespan to the microsecond while less than a
          // second is shown, a millisecond to a pixel or less
          value: (plot, value, __, i) =>
            value === null || i === null
              ? ""
              : label
                ? label(i)
                : bins
                  ? bins.said(i)
                  : time !== undefined
                    ? stamp(value, time, fine(time) && shown(plot) < 1 ? 6 : 3)
                    : String(value),
        },
        // A histogram's one series, its counts, a bar to each bin, a
        // pixel between them
        ...(bins
          ? [
              {
                label: "count",
                stroke: colour(0),
                fill: colour(0),
                width: 1,
                paths: uPlot.paths.bars?.({ size: [1, Infinity, 1], gap: 1 }),
                points: { show: false },
              },
            ]
          : []),
        ...(bins ? [] : spec.y).map(
          (j, k): uPlot.Series => ({
            label: named(j),
            stroke: colour(k),
            width: 1,
            show: !spec.hidden.includes(j),
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
                  // A month or a date ticked at months or days at least,
                  // as it has no time of day
                  ...(time === 13 && { incrs: months }),
                  ...(time === 14 && { incrs: [...days, ...months] }),
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
            // A histogram's counts aren't a column
            if (bins) {
              return;
            }
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
    // Named for a screen reader, which can't see the canvas: the legend
    // below it reads the values at the cursor
    this.plot.over.role = "img";
    this.plot.over.ariaLabel = bins
      ? `Histogram of ${x?.name}`
      : `${spec.type === "bar" ? "Bars" : "Line"} of ${spec.y.map(named).join(", ")} by ${x?.name ?? "row index"}`;
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

// How much of the x is shown, as zoomed
function shown(plot: uPlot): number {
  const { min, max } = plot.scales.x;
  return min === undefined || max === undefined ? Infinity : max - min;
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
