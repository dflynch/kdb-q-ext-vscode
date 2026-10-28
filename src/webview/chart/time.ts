import * as q from "../../format/temporal";

// Times on the chart, as q writes them: in full at a bin's edges, and as
// much of that as the space between ticks needs on an axis, where the
// ticks fall on steps of a clock or a calendar. A time is in whole
// milliseconds since 2000.01.01, as the chart's data are, or from 0 for a
// time that isn't of a date, which a double holds exactly for any of q's
// times. uPlot's own time axis reads times as seconds since 1970, and ticks
// no further apart than a century, so the chart ticks them itself.

// A day and a second, in milliseconds, as times are drawn
export const day = 86_400_000;
export const second = 1000;

// A time as q writes it, of a column of q's type, with as many digits of a
// second as asked, the rest cut off, as q casts a time to a coarser one
export function stamp(t: number, type: number, digits?: number): string {
  const text = written(t, type);
  return digits === undefined
    ? text
    : text.replace(/\.(\d+)$/, (_, part: string) =>
        digits ? `.${part.slice(0, digits)}` : "",
      );
}

function written(t: number, type: number): string {
  const ms = Math.floor(t);
  // Whole days and the milliseconds left
  const days = Math.floor(ms / day);
  const within = ms - days * day;
  const ns = BigInt(days) * 86_400_000_000_000n + BigInt(within) * 1_000_000n;
  switch (type) {
    case 12:
      return q.timestamp(ns);
    case 13:
      return `${q.date(days).slice(0, 7)}m`;
    case 14:
      return q.date(days);
    case 15:
      // From its date and time, where its days as a float would round
      // away its milliseconds past 2^16 days from 2000
      return `${q.date(days)}T${q.time(within)}`;
    case 16:
      return q.timespan(ns);
    case 17:
      return q.minute(Math.floor(ms / (60 * second)));
    case 18:
      return q.second(Math.floor(ms / second));
  }
  return q.time(ms);
}

// Each tick's time on an axis, of a column of q's type, the ticks this many
// milliseconds apart: the year, month or day, for ticks a year, a month or
// a day or more apart; else the time of day, to the minute, second or
// millisecond, with the date above at the first tick and where it changes
export function ticks(times: number[], type: number, apart: number): string[] {
  const dated = type >= 12 && type <= 15;
  const texts = times.map((t) => written(t, type));
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
  const digits = apart >= second ? 0 : 3;
  return texts.map((text, i) => {
    let time = dated ? text.slice(11) : text;
    time = time.replace(/\.(\d+)$/, (_, part: string) =>
      digits ? `.${part.slice(0, digits)}` : "",
    );
    // Hours and minutes, for ticks a minute or more apart, as a minute is
    if (apart >= 60 * second && type !== 17) {
      time = time.replace(/:\d\d$/, "");
    }
    const date = text.slice(0, 10);
    const first = i === 0 || date !== texts[i - 1].slice(0, 10);
    return dated && first ? `${date}\n${time}` : time;
  });
}

// How far apart ticks can be for a column of q's type, in milliseconds,
// as uPlot's own: a millisecond to a second as 1, 2 and 5 of a power of
// 10, for a type that holds them, then a clock's steps, days, and months
// and years for a type of dates, or many days for one that isn't
export function steps(type: number): number[] {
  const finest = type === 17 ? 60 * second : type === 18 ? second : 1;
  const fractions = [0, 1, 2].flatMap((power) =>
    [1, 2, 5].map((n) => n * 10 ** power),
  );
  const clock = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600,
    43200,
  ].map((n) => n * second);
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
  const within = [...fractions, ...clock].filter((n) => n >= finest);
  return type === 12 || type === 15
    ? [...within, ...days, ...months, ...years]
    : [...within, ...many];
}

// Where ticks fall between two times, a step apart: at whole numbers of the
// step from 2000.01.01, or from 0 for a time that isn't of a date, within a
// month, or at the starts of months or years, every so many, counted from
// 2000, so that where they fall doesn't depend on the data
export function splits(
  min: number,
  max: number,
  step: number,
  type: number,
): number[] {
  const dated = type >= 12 && type <= 15;
  const all: number[] = [];
  if (!dated || step < 28 * day) {
    for (let k = Math.ceil(min / step); k <= Math.floor(max / step); k++) {
      all.push(k * step);
    }
    return all;
  }
  const months =
    step >= 365 * day
      ? Math.round(step / (365 * day)) * 12
      : Math.round(step / (30 * day));
  // The month of a time, from 2000.01
  const [year, month] = written(min, 14).split(".").map(Number);
  let at = Math.ceil(((year - 2000) * 12 + month - 1) / months) * months;
  for (;;) {
    const t = monthDay(at) * day;
    if (t > max) {
      return all;
    }
    if (t >= min) {
      all.push(t);
    }
    at += months;
  }
}

// The day a month starts, both counted from 2000.01.01
export function monthDay(months: number): number {
  return Date.UTC(2000, months) / day - 10957;
}
