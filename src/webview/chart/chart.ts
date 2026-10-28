import uPlot from "uplot";
import type { Sheet } from "../table";
import {
  barred,
  binned,
  lined,
  numbers,
  type Plotted,
  scattered,
} from "./data";
import type { Spec } from "./spec";
import { day, second, splits, steps, ticks } from "./time";

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
    // A short's, an int's or a long's, written as an integer
    const whole = x !== undefined && x.type >= 5 && x.type <= 7;
    const named = (j: number) => sheet.columns[j].name;
    // A cell at the cursor as the grid shows it, of the row a point is of
    const { rows } = plotted;
    const cell = (j: number, i: number) =>
      sheet.columns[j].text(rows ? rows[i] : i);
    // One x, of a line of times or a lone bin, which would otherwise be
    // shown as closely as a zoom goes: a line's at the middle of its own
    // unit either side, a month, a day, a minute, else a second, and a
    // bin's as the bin
    const { x: xs } = plotted;
    const single = xs.length > 0 && xs[0] === xs[xs.length - 1];
    const unit =
      time === 13
        ? 31 * day
        : time === 14
          ? day
          : time === 17
            ? 60 * second
            : second;
    // Zoomed no closer than ten of a time's finest ticks apart, as it's
    // drawn no finer: ten milliseconds for a timestamp, or ten for an
    // integer
    const least = time !== undefined ? 10 * steps(time)[0] : whole ? 10 : 0;
    const widened = (min: number, max: number): uPlot.Range.MinMax =>
      max - min >= least
        ? [min, max]
        : [(min + max - least) / 2, (min + max + least) / 2];
    const { text, lines, font, series } = styles();
    const colour = (i: number) => series[i % series.length];
    const axis: uPlot.Axis = {
      stroke: text,
      font,
      grid: { stroke: lines, width: 1 },
      ticks: { stroke: lines, width: 1 },
      size: depth,
    };
    // Ticks as far apart as their labels are wide, at about the step
    // they'd be at, where uPlot's 50 pixels would crowd them
    const spaced =
      (write: (splits: number[], step: number) => string[]): uPlot.Axis.Space =>
      (_, __, min, max, dim) =>
        Math.max(
          50,
          ...write([min, max], ((max - min) * 50) / Math.max(1, dim)).map(
            (each) => measure(each, font) + 16,
          ),
        );
    // Numbers as q writes them, on the y axis as uPlot spaces them, and
    // on the x as their labels are wide
    const valued: Pick<uPlot.Axis, "values"> = {
      values: (_, splits, __, ___, step) => numbers(splits, step),
    };
    const across = { ...valued, space: spaced(numbers) };
    // An integer as q writes it, ticked at whole steps
    const integers = (splits: number[]) =>
      splits.map((t) => String(Math.round(t)));
    const counting: Partial<uPlot.Axis> = {
      incrs: wholeSteps,
      values: (_, splits) => integers(splits),
      space: spaced(integers),
    };
    // Room for half the first and the last tick's labels, which are
    // centred on them, as the plot may start or end at them
    let overhang = [0, 0];
    const below: uPlot.Axis.Size = (plot, values, i, cycle) => {
      overhang = [values?.[0], values?.[values.length - 1]].map((each) =>
        each ? Math.ceil(measure(each, font) / 2) : 0,
      );
      return depth(plot, values, i, cycle);
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
      // Room for half a bar's label or a tick's beyond the first and last,
      // the y axis's labels taking some of it at the left
      padding: [
        null,
        () => Math.max(wide / 2, overhang[1]),
        null,
        (plot) =>
          Math.max(
            0,
            Math.max(wide / 2, overhang[0]) -
              ((plot.axes[1] as { _size?: number })._size ?? 0),
          ),
      ],
      // Times as numbers, of milliseconds since 2000.01.01, which the chart
      // ticks itself
      scales: {
        x: label
          ? // Each row's bars about its index, half a row out at each end
            { time: false, range: (_, min, max) => [min - 0.5, max + 0.5] }
          : bins
            ? {
                time: false,
                // All the bins, from the first's start to the last's end,
                // where uPlot would go from the middle of one to the
                // other's, or pad a lone one as it likes; or as zoomed
                range: (_, min, max): uPlot.Range.MinMax =>
                  single || (min === xs[0] && max === xs[xs.length - 1])
                    ? [bins.from, bins.to]
                    : widened(min, max),
              }
            : {
                time: false,
                ...((time !== undefined || whole) && {
                  range: (_, min, max): uPlot.Range.MinMax =>
                    single && time !== undefined
                      ? [xs[0] - unit, xs[0] + unit]
                      : widened(min, max),
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
          value: (_, value, __, i) =>
            value === null || i === null
              ? ""
              : label
                ? label(i)
                : bins
                  ? bins.said(i)
                  : spec.x === null
                    ? String(rows ? rows[i] : i)
                    : cell(spec.x, i),
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
            value: (_, value, __, i) =>
              value === null || i === null ? "" : cell(j, i),
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
          size: below,
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
                  incrs: steps(time),
                  splits: (_, __, min, max, step) =>
                    splits(min, max, step, time),
                  values: (_, splits, __, ___, step) =>
                    ticks(splits, time, step),
                  space: spaced((splits, step) => ticks(splits, time, step)),
                }
              : whole
                ? counting
                : across),
        },
        { ...axis, ...valued },
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
        // Padded in x as uPlot pads y, so a lone x isn't a range of none
        scales: {
          x: {
            time: false,
            range: (_, min, max): uPlot.Range.MinMax => {
              const [from, to] = uPlot.rangeNum(min, max, 0.1, true);
              return whole ? widened(from ?? min, to ?? max) : [from, to];
            },
          },
          y: {},
        },
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
              // Its x and y at the cursor, as the grid shows them
              value: (_, __, ___, at) => {
                if (at === null || spec.x === null) {
                  return "";
                }
                const row = points[k][2][at];
                return `${sheet.columns[spec.x].text(row)}, ${sheet.columns[j].text(row)}`;
              },
            }),
          ),
        ],
        // Named below, as the legend names only the ys
        axes: [
          {
            ...axis,
            ...(whole ? counting : across),
            size: below,
            label: x?.name,
            labelFont: font,
          },
          { ...axis, ...valued },
        ],
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
        ? [null, ...points.map(([xs, ys]) => [xs, ys])]
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
    const down = Math.ceil(height) + 1;
    const painted = new Uint8Array(across * down);
    // Within the plot, and its colour not left for uPlot's next drawing
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = colour;
    for (let at = 0; at < xs.length; at++) {
      const x = Math.round(plot.valToPos(xs[at], "x", true) - left);
      const y = Math.round(plot.valToPos(ys[at], "y", true) - top);
      if (x >= 0 && x < across && y >= 0 && y < down) {
        const pixel = y * across + x;
        if (!painted[pixel]) {
          painted[pixel] = 1;
          ctx.fillRect(left + x - side / 2, top + y - side / 2, side, side);
        }
      }
    }
    ctx.restore();
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
    if (!plot.series[i].show || left < 0 || top < 0) {
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
    const width = Math.ceil(plot.bbox.width / devicePixelRatio) + 1;
    const height = Math.ceil(plot.bbox.height / devicePixelRatio) + 1;
    const across = Math.ceil(width / reach);
    const cells = across * Math.ceil(height / reach);
    const of = new Int32Array(xs.length);
    const starts = new Uint32Array(cells + 1);
    // A pixel's first point only, as drawn, so a cell holds a point to
    // each of its pixels at most, however many fall on one
    const taken = new Uint8Array(width * height);
    for (let at = 0; at < xs.length; at++) {
      const x = Math.round(plot.valToPos(xs[at], "x"));
      const y = Math.round(plot.valToPos(ys[at], "y"));
      const pixel = y * width + x;
      of[at] =
        x >= 0 && x < width && y >= 0 && y < height && !taken[pixel]
          ? Math.floor(y / reach) * across + Math.floor(x / reach)
          : -1;
      if (of[at] >= 0) {
        taken[pixel] = 1;
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

// How far apart an integer's ticks can be: 1, 2 and 5 of a power of 10, as
// a long's can be
const wholeSteps = Array.from({ length: 19 }, (_, power) =>
  [1, 2, 5].map((n) => n * 10 ** power),
).flat();

// How near the cursor a point is found, in pixels
const reach = 12;

// A canvas's context to measure text with, made once it's needed
let measuring: CanvasRenderingContext2D | null | undefined;

// How wide a text is in the font: its widest line
function measure(text: string, font: string): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) {
    return 50;
  }
  measuring.font = font;
  const context = measuring;
  return Math.max(
    ...text.split("\n").map((line) => context.measureText(line).width),
  );
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
  return measure(longest, font);
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
