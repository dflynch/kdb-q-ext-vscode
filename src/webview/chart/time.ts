import * as q from "../../format/temporal";

// Times on the chart, as q writes them: in full at a bin's edges, and as
// much of that as the space between ticks needs on an axis, where the
// ticks fall on steps of a clock or a calendar. A time is in seconds from
// its column's first day, the origin, in days since 2000.01.01, as the
// chart's data are: a double holds a timestamp's nanoseconds only that
// near. A time of day or a span counts from 0. uPlot's own time axis ticks
// no finer than a millisecond, and reads times as seconds since 1970, so
// the chart ticks them itself.

const day = 86400;

// A time as q writes it, of a column of q's type, with as many digits of a
// second as asked, the rest cut off, as q casts a time to a coarser one
export function stamp(
  t: number,
  origin: number,
  type: number,
  digits?: number,
): string {
  const text = written(t, origin, type);
  return digits === undefined
    ? text
    : text.replace(/\.(\d+)$/, (_, part: string) =>
        digits ? `.${part.slice(0, digits)}` : "",
      );
}

function written(t: number, origin: number, type: number): string {
  // Whole days and what's left, to the nanosecond: a time's days need not
  // fit a double's nanoseconds, its time within the day does
  const days = Math.floor(t / day + 1e-12);
  const ns = BigInt(Math.round((t - days * day) * 1e9));
  switch (type) {
    case 12:
      return q.timestamp(BigInt(origin + days) * 86_400_000_000_000n + ns);
    case 13:
      return `${q.date(origin + days).slice(0, 7)}m`;
    case 14:
      return q.date(origin + days);
    case 15:
      return q.datetime(origin + t / day);
    case 16:
      return q.timespan(BigInt(days) * 86_400_000_000_000n + ns);
    case 17:
      return q.minute(Math.floor(t / 60 + 1e-9));
    case 18:
      return q.second(Math.floor(t + 1e-9));
  }
  return q.time(Math.floor(t * 1000 + 1e-6));
}

// Each tick's time on an axis, of a column of q's type, the ticks this many
// seconds apart: the year, month or day, for ticks a year, a month or a day
// or more apart; else the time of day, to the minute, second or as many
// digits as tell them apart, with the date above at the first tick and
// where it changes
export function ticks(
  times: number[],
  origin: number,
  type: number,
  apart: number,
): string[] {
  const dated = type >= 12 && type <= 15;
  const texts = times.map((t) => written(t, origin, type));
  if (type === 13 || (dated && apart >= 365 * day)) {
    return texts.map((t) =>
      t.slice(0, type === 13 && apart < 365 * day ? 7 : 4),
    );
  }
  if (dated && apart >= 28 * day) {
    return texts.map((t) => t.slice(0, 7));
  }
  if (type === 14 || (dated && apart >= day)) {
    return texts.map((t) => t.slice(0, 10));
  }
  const digits =
    apart >= 1 ? 0 : apart >= 1e-3 - 1e-12 ? 3 : apart >= 1e-6 - 1e-15 ? 6 : 9;
  return texts.map((text, i) => {
    let time = dated ? text.slice(11) : text;
    time = time.replace(/\.(\d+)$/, (_, part: string) =>
      digits ? `.${part.slice(0, digits)}` : "",
    );
    // Hours and minutes, for ticks a minute or more apart, as a minute is
    if (apart >= 60 && type !== 17) {
      time = time.replace(/:\d\d$/, "");
    }
    const date = text.slice(0, 10);
    const first = i === 0 || date !== texts[i - 1].slice(0, 10);
    return dated && first ? `${date}\n${time}` : time;
  });
}

// How far apart ticks can be for a column of q's type, in seconds, as
// uPlot's own: a nanosecond to a second as 1, 2 and 5 of a power of 10,
// for a type that holds them, then a clock's steps, days, and months and
// years for a type of dates, or many days for one that isn't
export function steps(type: number): number[] {
  const finest =
    type === 12 || type === 16
      ? 1e-9
      : type === 15 || type === 19
        ? 1e-3
        : type === 17
          ? 60
          : 1;
  const fractions = [-9, -8, -7, -6, -5, -4, -3, -2, -1].flatMap((power) =>
    [1, 2, 5].map((n) => Number(`${n}e${power}`)),
  );
  const clock = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600,
    43200,
  ];
  const days = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15].map((n) => n * day);
  const months = [1, 2, 3, 4, 6].map((n) => n * 30 * day);
  const years = [
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
  ].map((n) => n * 365 * day);
  const many = [0, 1, 2, 3, 4, 5].flatMap((power) =>
    [1, 2, 5].map((n) => n * 10 ** power * day),
  );
  switch (type) {
    case 13:
      return [...months, ...years];
    case 14:
      return [...days, ...months, ...years];
  }
  const within = [...fractions, ...clock].filter((n) => n >= finest - 1e-15);
  return type === 12 || type === 15
    ? [...within, ...days, ...months, ...years]
    : [...within, ...many];
}

// Where ticks fall between two times, a step apart: at whole numbers of the
// step from the origin's midnight, within a month, or at the starts of
// months or years, every so many, counted from 2000
export function splits(
  min: number,
  max: number,
  step: number,
  origin: number,
  type: number,
): number[] {
  const dated = type >= 12 && type <= 15;
  const all: number[] = [];
  if (!dated || step < 28 * day) {
    const first = Math.ceil(min / step - 1e-9);
    const last = Math.floor(max / step + 1e-9);
    for (let k = first; k <= last; k++) {
      all.push(k * step);
    }
    return all;
  }
  const months =
    step >= 365 * day
      ? Math.round(step / (365 * day)) * 12
      : Math.round(step / (30 * day));
  // The month of a time, from 2000.01
  const [year, month] = written(min, origin, 14).split(".").map(Number);
  let at = Math.ceil(((year - 2000) * 12 + month - 1) / months) * months;
  for (;;) {
    const t = (monthDay(at) - origin) * day;
    if (t > max + 1e-9) {
      return all;
    }
    if (t >= min - 1e-9) {
      all.push(t);
    }
    at += months;
  }
}

// The day a month starts, both counted from 2000.01.01
export function monthDay(months: number): number {
  return Date.UTC(2000, months) / 1000 / day - 10957;
}
