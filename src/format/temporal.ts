// q's temporal values as q writes them, from the counts the decoder keeps.
// Our own, not Date: q's times can run past 24 hours or be negative, and its
// dates cover years 1 to 9999. Nulls and infinities are the caller's: these
// take only ordinary values.

const day = 86_400_000_000_000n; // nanoseconds

// Two digits, or ** when the number doesn't fit, as q writes an hour of 100
// or more
function two(n: number): string {
  return n < 100 ? String(n).padStart(2, "0") : "**";
}

function digits(n: bigint | number, width: number): string {
  return String(n).padStart(width, "0");
}

// Days since 2000.01.01, as yyyy.mm.dd. q writes 0000.00.00 outside years 1
// to 9999.
export function date(days: number): string {
  if (days < -730119 || days > 2921939) {
    return "0000.00.00";
  }
  // Howard Hinnant's civil_from_days, counting from 0000.03.01 so that a
  // leap day ends each year
  const z = days + 730425;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${digits(y, 4)}.${two(m)}.${two(d)}`;
}

// Months since 2000.01, as yyyy.mm. Past year 9999 q writes stars and stray
// bytes; this writes 0000.00, which q writes for years before 0.
export function month(months: number): string {
  const y = 2000 + Math.floor(months / 12);
  if (y < 0 || y > 9999) {
    return "0000.00";
  }
  return `${digits(y, 4)}.${two(months - (y - 2000) * 12 + 1)}`;
}

// Nanoseconds within a day, or of a timespan's last day, as hh:mm:ss.nnnnnnnnn
function nanoseconds(ns: bigint): string {
  const s = ns / 1_000_000_000n;
  return `${clock(Number(s), 3)}.${digits(ns % 1_000_000_000n, 9)}`;
}

// Seconds as hh:mm:ss, or with fewer parts as hh:mm
function clock(seconds: number, parts: 2 | 3): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  return parts === 2
    ? `${two(h)}:${two(m)}`
    : `${two(h)}:${two(m)}:${two(seconds % 60)}`;
}

// Nanoseconds since 2000.01.01, as a date, D and the time of day
export function timestamp(ns: bigint): string {
  let days = ns / day;
  let rest = ns % day;
  if (rest < 0n) {
    days -= 1n;
    rest += day;
  }
  return `${date(Number(days))}D${nanoseconds(rest)}`;
}

// Nanoseconds, as days, D and the time
export function timespan(ns: bigint): string {
  const sign = ns < 0n ? "-" : "";
  const n = ns < 0n ? -ns : ns;
  return `${sign}${n / day}D${nanoseconds(n % day)}`;
}

// Days since 2000.01.01 as a float, with T between the date and the time.
// q rounds to the microsecond, half away from zero, then drops the
// microseconds. The microseconds can pass 2^53, so they're divided exactly.
// About 1 in 50,000 of q's show a millisecond more than this, where the
// microseconds come to exactly 999: no rule tried matches q's there.
export function datetime(days: number): string {
  const product = days * 86_400_000_000;
  const us = BigInt(Math.sign(product) * Math.round(Math.abs(product)));
  const ms = floor(us, 1000n);
  const whole = floor(ms, 86_400_000n);
  // Outside q's dates the time is zeros too
  const d = date(Number(whole));
  const rest = d.startsWith("0000") ? 0 : Number(ms - whole * 86_400_000n);
  return `${d}T${clock(Math.floor(rest / 1000), 3)}.${digits(rest % 1000, 3)}`;
}

// Division rounded down, where a bigint's rounds toward zero
function floor(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d < 0n ? q - 1n : q;
}

function signed(n: number, write: (n: number) => string): string {
  return n < 0 ? `-${write(-n)}` : write(n);
}

// Minutes, as hh:mm
export function minute(minutes: number): string {
  return signed(minutes, (n) => clock(n * 60, 2));
}

// Seconds, as hh:mm:ss
export function second(seconds: number): string {
  return signed(seconds, (n) => clock(n, 3));
}

// Milliseconds, as hh:mm:ss.mmm
export function time(ms: number): string {
  return signed(
    ms,
    (n) => `${clock(Math.floor(n / 1000), 3)}.${digits(n % 1000, 3)}`,
  );
}
