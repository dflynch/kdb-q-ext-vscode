// Times on the chart, as q writes them: 2024.01.02D09:30:00.000 at the
// cursor, and as much of that as the space between ticks needs on an axis.
// A time is in seconds since 1970, as the chart's data are, read as UTC so
// that it's written as it is, unshifted by the machine's time zone; to the
// millisecond, which is as fine as a pixel ever is.

const day = 86400;

// A time at the cursor, of a column of q's type
export function stamp(seconds: number, type: number): string {
  const ms = Math.round(seconds * 1000);
  switch (type) {
    case 12:
      return `${date(ms)}D${clock(ms, 3)}`;
    case 13:
      return `${date(ms).slice(0, 7)}m`;
    case 14:
      return date(ms);
    case 15:
      return `${date(ms)}T${clock(ms, 3)}`;
    case 16:
      return span(ms, 3);
    case 17:
      return hours(ms, 0).slice(0, -3);
    case 18:
      return hours(ms, 0);
  }
  return hours(ms, 3);
}

// Each tick's time on an axis, of a column of q's type, the ticks this many
// seconds apart: the year, month or day, for ticks a year, a month or a day
// or more apart; else the time of day, to the minute, second or
// millisecond, with the date above at the first tick and where it changes
export function ticks(times: number[], type: number, apart: number): string[] {
  const dated = type >= 12 && type <= 15;
  if (dated && apart >= 365 * day) {
    return times.map((t) => date(t * 1000).slice(0, 4));
  }
  if (dated && apart >= 28 * day) {
    return times.map((t) => date(t * 1000).slice(0, 7));
  }
  if (dated && apart >= day) {
    return times.map((t) => date(t * 1000));
  }
  const digits = apart >= 1 ? 0 : 3;
  const short = apart >= 60;
  return times.map((t, i) => {
    const ms = Math.round(t * 1000);
    const time =
      type === 16
        ? span(ms, digits, short)
        : dated
          ? short
            ? clock(ms, 0).slice(0, 5)
            : clock(ms, digits)
          : short
            ? hours(ms, 0).slice(0, -3)
            : hours(ms, digits);
    const first = i === 0 || date(ms) !== date(Math.round(times[i - 1] * 1000));
    return dated && first ? `${date(ms)}\n${time}` : time;
  });
}

// The date, as 2024.01.02
function date(ms: number): string {
  const at = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}.${two(at.getUTCMonth() + 1)}.${two(at.getUTCDate())}`;
}

// The time of day, as 09:30:00, or 09:30:00.123 with digits
function clock(ms: number, digits: number): string {
  const within = ((ms % (day * 1000)) + day * 1000) % (day * 1000);
  const text = new Date(within).toISOString().slice(11, 23);
  return digits ? text : text.slice(0, 8);
}

// A minute, second or time, as q writes it: as hours, minutes, seconds
// and milliseconds, never wrapped to a day, as 30:00 or -00:00:01.000
function hours(ms: number, digits: number): string {
  const sign = ms < 0 ? "-" : "";
  const size = Math.abs(ms);
  const within = clock(size, digits).slice(2);
  const whole = String(Math.floor(size / 3600000)).padStart(2, "0");
  return `${sign}${whole}${within}`;
}

// A span, as q writes a timespan: 0D09:30:00.123, its days and sign first
function span(ms: number, digits: number, short = false): string {
  const sign = ms < 0 ? "-" : "";
  const size = Math.abs(ms);
  const days = Math.floor(size / (day * 1000));
  const time = clock(size, digits);
  return `${sign}${days}D${short ? time.slice(0, 5) : time}`;
}
