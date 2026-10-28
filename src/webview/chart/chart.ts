import uPlot from "uplot";
import type { Sheet } from "../table";
import { barred, binned, fine, lined, type Plotted, scattered } from "./data";
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
          : spec.type === "scatter"
            ? scattered(sheet, spec)
            : lined(sheet, spec);
    const x = spec.x === null ? undefined : sheet.columns[spec.x];
    const time = x && x.type >= 12 && x.type <= 19 ? x.type : undefined;
    const named = (j: number) => sheet.columns[j].name;
    // One x, of a line or a lone bin, which uPlot would put at the left of
    // a thousand days: a line's at the middle of its own unit either side,
    // a month, a day, a minute, else a second, and a bin's as the bin
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
                    : number(value),
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
    const { points } = plotted;
    if (points) {
      // A scatter, in uPlot's mode for points with an x each: a series to
      // each y, drawn as squares, zoomed in x and y together, and the
      // cursor at the point nearest it
      const near = new Nearest();
      Object.assign(options, {
        mode: 2,
        padding: [null, null, null, null],
        scales: { x: { time: false }, y: {} },
        series: [
          {},
          ...spec.y.map(
            (j, k): uPlot.Series => ({
              label: named(j),
              stroke: colour(k),
              fill: colour(k),
              width: 0,
              show: !spec.hidden.includes(j),
              facets: [
                { scale: "x", auto: true },
                { scale: "y", auto: true },
              ],
              paths: squares(colour(k)),
              // Its x and y at the cursor
              value: (plot, _, i, at) => {
                const [xs, ys] = plot.data[i] as unknown as Float64Array[];
                return at === null
                  ? ""
                  : `${number(xs[at])}, ${number(ys[at])}`;
              },
            }),
          ),
        ],
        axes: [axis, axis],
        cursor: {
          drag: { x: true, y: true },
          dataIdx: (plot, i) => near.at(plot, i),
        },
      } satisfies Partial<uPlot.Options>);
      options.hooks = { ...options.hooks, draw: [() => near.clear()] };
    }
    this.plot = new uPlot(
      options,
      (points
        ? [null, ...points]
        : [plotted.x, ...plotted.ys]) as unknown as uPlot.AlignedData,
      this.place,
    );
    // Named for a screen reader, which can't see the canvas: the legend
    // below it reads the values at the cursor
    this.plot.over.role = "img";
    const drawn = { line: "Line", bar: "Bars", scatter: "Points" };
    this.plot.over.ariaLabel =
      spec.type === "histogram"
        ? `Histogram of ${x?.name}`
        : `${drawn[spec.type]} of ${spec.y.map(named).join(", ")} by ${x?.name ?? "row index"}`;
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

// A scatter's points, as squares 3 pixels a side, painted straight onto
// the canvas, as uPlot's own scatter does: a path of half a million
// squares or more is drawn as nothing at all. A pixel painted already
// isn't painted again, so a million points take no longer than the pixels
// they cover.
function squares(colour: string): uPlot.Series.PathBuilder {
  return (plot, i) => {
    const [xs, ys] = plot.data[i] as unknown as Float64Array[];
    const { ctx } = plot;
    const side = 3 * devicePixelRatio;
    const { left, top, width, height } = plot.bbox;
    const across = Math.ceil(width) + 1;
    const painted = new Uint8Array(across * (Math.ceil(height) + 1));
    ctx.fillStyle = colour;
    for (let at = 0; at < xs.length; at++) {
      const x = Math.round(plot.valToPos(xs[at], "x", true) - left);
      const y = Math.round(plot.valToPos(ys[at], "y", true) - top);
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        const pixel = y * across + x;
        if (!painted[pixel]) {
          painted[pixel] = 1;
          ctx.fillRect(left + x - side / 2, top + y - side / 2, side, side);
        }
      }
    }
    return null;
  };
}

// The point of a scatter's series nearest the cursor, within a few pixels:
// found among those in the cells about it, the plot cut into cells, each
// point in the cell it falls in, made once for each drawing on the first
// hover, and none where none is near
class Nearest {
  // Of each series: its points, ordered by cell, and where each cell's
  // start, with the cells across
  private cells = new Map<
    number,
    { order: Uint32Array; starts: Uint32Array; across: number }
  >();

  clear() {
    this.cells.clear();
  }

  at(plot: uPlot, i: number): number | null {
    const left = plot.cursor.left ?? -1;
    const top = plot.cursor.top ?? -1;
    if (i === 0 || left < 0 || top < 0) {
      return null;
    }
    const [xs, ys] = plot.data[i] as unknown as Float64Array[];
    const { order, starts, across } = this.cellsOf(plot, i, xs, ys);
    const column = Math.floor(left / reach);
    const row = Math.floor(top / reach);
    let nearest: number | null = null;
    let least = reach * reach;
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = column - 1; c <= column + 1; c++) {
        if (c < 0 || c >= across || r < 0) {
          continue;
        }
        const cell = r * across + c;
        if (cell + 1 >= starts.length) {
          continue;
        }
        for (let o = starts[cell]; o < starts[cell + 1]; o++) {
          const at = order[o];
          const dx = plot.valToPos(xs[at], "x") - left;
          const dy = plot.valToPos(ys[at], "y") - top;
          if (dx * dx + dy * dy < least) {
            least = dx * dx + dy * dy;
            nearest = at;
          }
        }
      }
    }
    return nearest;
  }

  private cellsOf(plot: uPlot, i: number, xs: Float64Array, ys: Float64Array) {
    const made = this.cells.get(i);
    if (made) {
      return made;
    }
    const width = plot.bbox.width / devicePixelRatio;
    const height = plot.bbox.height / devicePixelRatio;
    const across = Math.ceil(width / reach) + 1;
    const cells = across * (Math.ceil(height / reach) + 1);
    const of = new Int32Array(xs.length);
    const starts = new Uint32Array(cells + 1);
    for (let at = 0; at < xs.length; at++) {
      const x = plot.valToPos(xs[at], "x");
      const y = plot.valToPos(ys[at], "y");
      of[at] =
        x >= 0 && x <= width && y >= 0 && y <= height
          ? Math.floor(y / reach) * across + Math.floor(x / reach)
          : -1;
      if (of[at] >= 0) {
        starts[of[at] + 1]++;
      }
    }
    for (let cell = 0; cell < cells; cell++) {
      starts[cell + 1] += starts[cell];
    }
    const order = new Uint32Array(starts[cells]);
    const next = starts.slice(0, cells);
    for (let at = 0; at < xs.length; at++) {
      if (of[at] >= 0) {
        order[next[of[at]]++] = at;
      }
    }
    this.cells.set(i, { order, starts, across });
    return { order, starts, across };
  }
}

// How near the cursor a point is found, in pixels
const reach = 12;

// A number at the cursor, to 6 decimal places at most, grouped as the
// axes' are
const number = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 6,
}).format;

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
