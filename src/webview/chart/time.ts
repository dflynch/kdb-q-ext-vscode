// Times on the chart, as q writes them: 2024.01.02D09:30:00.000 at the
// cursor, and as much of that as the space between ticks needs on an axis.
// A time is in seconds since 1970, as the chart's data are, read as UTC so
// that it's written as it is, unshifted by the machine's time zone. It's
// written to the millisecond, or the microsecond where that's needed and
// as fine as seconds in a double can hold it: a count of microseconds since
// 1970 is a whole number a double holds exactly.

const day = 86400;
const second = 1e6;

// A time at the cursor, of a column of q's type, to the millisecond or to
// 6 digits
export function stamp(seconds: number, type: number, digits = 3): string {
  const us = Math.round(seconds * second);
  switch (type) {
    case 12:
      return `${date(us)}D${clock(us, digits)}`;
    case 13:
      return `${date(us).slice(0, 7)}m`;
    case 14:
      return date(us);
    case 15:
      return `${date(us)}T${clock(us, digits)}`;
    case 16:
      return span(us, digits);
    case 17:
      return hours(us, 0).slice(0, -3);
    case 18:
      return hours(us, 0);
  }
  return hours(us, digits);
}

// Each tick's time on an axis, of a column of q's type, the ticks this many
// seconds apart: the year, month or day, for ticks a year, a month or a day
// or more apart; else the time of day, to the minute, second or
// millisecond, with the date above at the first tick and where it changes
export function ticks(times: number[], type: number, apart: number): string[] {
  const dated = type >= 12 && type <= 15;
  const us = times.map((t) => Math.round(t * second));
  if (dated && apart >= 365 * day) {
    return us.map((t) => date(t).slice(0, 4));
  }
  if (dated && apart >= 28 * day) {
    return us.map((t) => date(t).slice(0, 7));
  }
  if (dated && apart >= day) {
    return us.map(date);
  }
  const digits = apart >= 1 ? 0 : apart >= 1e-3 ? 3 : 6;
  const short = apart >= 60;
  return us.map((t, i) => {
    const time =
      type === 16
        ? span(t, digits, short)
        : dated
          ? short
            ? clock(t, 0).slice(0, 5)
            : clock(t, digits)
          : short
            ? hours(t, 0).slice(0, -3)
            : hours(t, digits);
    const first = i === 0 || date(t) !== date(us[i - 1]);
    return dated && first ? `${date(t)}\n${time}` : time;
  });
}

// The date, as 2024.01.02
function date(us: number): string {
  const at = new Date(Math.floor(us / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}.${two(at.getUTCMonth() + 1)}.${two(at.getUTCDate())}`;
}

// The time of day, as 09:30:00, or with digits of a second, as
// 09:30:00.123
function clock(us: number, digits: number): string {
  const within = ((us % (day * second)) + day * second) % (day * second);
  const two = (n: number) => String(Math.floor(n)).padStart(2, "0");
  const whole = `${two(within / 3600e6)}:${two((within / 60e6) % 60)}:${two((within / second) % 60)}`;
  const part = String(within % second)
    .padStart(6, "0")
    .slice(0, digits);
  return digits ? `${whole}.${part}` : whole;
}

// A minute, second or time, as q writes it: as hours, minutes, seconds
// and a part of one, never wrapped to a day, as 30:00 or -00:00:01.000
function hours(us: number, digits: number): string {
  const sign = us < 0 ? "-" : "";
  const size = Math.abs(us);
  const whole = String(Math.floor(size / 3600e6)).padStart(2, "0");
  return `${sign}${whole}${clock(size, digits).slice(2)}`;
}

// A span, as q writes a timespan: 0D09:30:00.123, its days and sign first
function span(us: number, digits: number, short = false): string {
  const sign = us < 0 ? "-" : "";
  const size = Math.abs(us);
  const days = Math.floor(size / (day * second));
  const time = clock(size, digits);
  return `${sign}${days}D${short ? time.slice(0, 5) : time}`;
}
