import type { Column } from "./table";

// The Grid's filter for a column of numbers or times: a value compared as q
// compares it, or the cell's text containing what's typed, as other
// columns' filters. Numbers and timespans are typed as q writes them; other
// times are picked, to the millisecond at the finest, and read as q's own
// values, never a Date, so no time zone shifts them. A null is smaller than
// any value, as q orders it, and floats, reals and datetimes are equal
// within q's tolerance. What can't be read matches no rows.

export type Comparison =
  | "equals"
  | "notEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "inRange"
  | "contains";

// What a filter is set to, kept with a kept tab: what's typed or picked, as
// it is, and for a range its end
export interface Condition {
  type: Comparison;
  filter: string;
  filterTo?: string;
}

// Each comparison as a filter offers it
export const comparisons: [Comparison, string][] = [
  ["equals", "Equals"],
  ["notEqual", "Does not equal"],
  ["lessThan", "Less than"],
  ["lessThanOrEqual", "Less than or equal to"],
  ["greaterThan", "Greater than"],
  ["greaterThanOrEqual", "Greater than or equal to"],
  ["inRange", "Between"],
  ["contains", "Contains"],
];

// Whether a column of q's type is filtered by comparing: a short, int,
// long, real or float, or a time
export function comparable(type: number): boolean {
  return (type >= 5 && type <= 9) || (type >= 12 && type <= 19);
}

// How a value is given for a column of q's type: typed, for numbers and
// timespans, else the browser's picker of a month, a date, a date and time,
// or a time, to as fine as the type holds, down to the millisecond
export function field(type: number): { type: string; step?: string } {
  switch (type) {
    case 12:
    case 15:
      return { type: "datetime-local", step: "0.001" };
    case 13:
      return { type: "month" };
    case 14:
      return { type: "date" };
    case 17:
      return { type: "time", step: "60" };
    case 18:
      return { type: "time", step: "1" };
    case 19:
      return { type: "time", step: "0.001" };
  }
  return { type: "text" };
}

// A value as q compares it: none for a null, an integer exactly, or a float
type Q = null | bigint | number;

// Which rows a condition lets through, by their index in the result; none
// while there's nothing to compare with, when it filters nothing
export function passing(
  column: Column,
  { type, filter, filterTo }: Condition,
): ((row: number) => boolean) | undefined {
  if (!filter || (type === "inRange" && !filterTo)) {
    return undefined;
  }
  if (type === "contains") {
    const typed = filter.toLowerCase();
    return (row) => column.text(row).toLowerCase().includes(typed);
  }
  const cell = cellOf(column);
  const value = read(filter, column.type);
  const to = type === "inRange" ? read(filterTo ?? "", column.type) : null;
  if (!cell || value === undefined || to === undefined) {
    return () => false;
  }
  switch (type) {
    case "equals":
      return (row) => compared(cell(row), value) === 0;
    case "notEqual":
      return (row) => compared(cell(row), value) !== 0;
    case "lessThan":
      return (row) => compared(cell(row), value) < 0;
    case "lessThanOrEqual":
      return (row) => compared(cell(row), value) <= 0;
    case "greaterThan":
      return (row) => compared(cell(row), value) > 0;
    case "greaterThanOrEqual":
      return (row) => compared(cell(row), value) >= 0;
    case "inRange":
      // Both ends in, as q's within
      return (row) => {
        const x = cell(row);
        return compared(x, value) >= 0 && compared(x, to) <= 0;
      };
  }
}

// How two values order, as q's comparisons: a null first, integers exactly,
// and otherwise as floats, equal where they differ by less than 2^-43 of
// the smaller, as q's tolerance has it, which an infinity isn't within
export function compared(x: Q, y: Q): number {
  if (x === null || y === null) {
    return Number(y === null) - Number(x === null);
  }
  if (typeof x === "bigint" && typeof y === "bigint") {
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const a = Number(x);
  const b = Number(y);
  if (
    a === b ||
    Math.abs(a - b) < 2 ** -43 * Math.min(Math.abs(a), Math.abs(b))
  ) {
    return 0;
  }
  return a < b ? -1 : 1;
}

// A column's cells as q compares them, of a column of numbers or times
function cellOf(column: Column): ((row: number) => Q) | undefined {
  const vector = column.vector;
  if (!vector) {
    return undefined;
  }
  switch (vector.type) {
    case 5:
    case 6:
    case 13:
    case 14:
    case 17:
    case 18:
    case 19: {
      const data = vector.data;
      const none = vector.type === 5 ? -32768 : -2147483648;
      return (row) => (data[row] === none ? null : BigInt(data[row]));
    }
    case 7:
    case 12:
    case 16: {
      const data = vector.data;
      return (row) => (data[row] === -(2n ** 63n) ? null : data[row]);
    }
    case 8:
    case 9:
    case 15: {
      const data = vector.data;
      return (row) => (Number.isNaN(data[row]) ? null : data[row]);
    }
  }
  return undefined;
}

// What's typed or picked for a column of q's type as q's value, or nothing
// where it can't be read
export function read(text: string, type: number): Q | undefined {
  const typed = text.trim();
  switch (type) {
    case 12: {
      const ms = moment(typed);
      return ms === undefined ? undefined : BigInt(ms) * 1_000_000n;
    }
    case 13: {
      const parts = /^(\d{4,})-(\d\d)$/.exec(typed);
      return parts
        ? BigInt((Number(parts[1]) - 2000) * 12 + Number(parts[2]) - 1)
        : undefined;
    }
    case 14: {
      const parts = /^(\d{4,})-(\d\d)-(\d\d)$/.exec(typed);
      return parts
        ? BigInt(days(Number(parts[1]), Number(parts[2]), Number(parts[3])))
        : undefined;
    }
    case 15: {
      const ms = moment(typed);
      return ms === undefined ? undefined : ms / 86_400_000;
    }
    case 16:
      return timespan(typed);
    case 17:
    case 18:
    case 19: {
      const ms = clock(typed);
      const unit = type === 17 ? 60_000 : type === 18 ? 1000 : 1;
      return ms === undefined ? undefined : BigInt(Math.floor(ms / unit));
    }
  }
  return number(typed);
}

// A number as q writes it: an integer, a float or, with an e at its end, a
// real, or a null or an infinity, of any of q's numeric types
function number(text: string): Q | undefined {
  const special = /^(-?)0([NnWw])([hijef]?)$/.exec(text);
  if (special) {
    const [, minus, letter, suffix] = special;
    if (letter === "N" || letter === "n") {
      return minus ? undefined : null;
    }
    const sign = minus ? -1 : 1;
    if (letter === "w" || suffix === "e" || suffix === "f") {
      return sign * Number.POSITIVE_INFINITY;
    }
    const most = {
      h: 32767n,
      i: 2147483647n,
      j: 2n ** 63n - 1n,
      "": 2n ** 63n - 1n,
    };
    return BigInt(sign) * most[suffix as "h" | "i" | "j" | ""];
  }
  const integer = /^(-?\d+)[hij]?$/.exec(text);
  if (integer) {
    return BigInt(integer[1]);
  }
  const float = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(e?)f?$/.exec(text);
  if (!float || (float[2] && text.endsWith("f"))) {
    return undefined;
  }
  const x = Number(float[1]);
  return float[2] ? Math.fround(x) : x;
}

// A timespan as q writes it, or a minute, second or time, which q compares
// as one, in nanoseconds: days, then hours and as much of the rest as is
// given, a fraction of a second to the nanosecond; or a null or an infinity
function timespan(text: string): Q | undefined {
  const special = /^(-?)0([NW])n?$/.exec(text);
  if (special) {
    if (special[2] === "N") {
      return special[1] ? undefined : null;
    }
    return (special[1] ? -1n : 1n) * (2n ** 63n - 1n);
  }
  const parts =
    /^(-?)(?:(\d+)D)?(?:(\d+)(?::(\d\d)(?::(\d\d)(?:\.(\d{1,9}))?)?)?)?$/.exec(
      text,
    );
  // A day or a minute at least, as a bare number is no time
  if (!parts || (parts[2] === undefined && parts[4] === undefined)) {
    return undefined;
  }
  const [, minus, d, h, m, s, fraction] = parts;
  const ns =
    ((BigInt(d ?? 0) * 24n + BigInt(h ?? 0)) * 60n + BigInt(m ?? 0)) *
      60_000_000_000n +
    BigInt(s ?? 0) * 1_000_000_000n +
    BigInt((fraction ?? "").padEnd(9, "0"));
  return minus ? -ns : ns;
}

// A date and time picked, as the browser gives it, in milliseconds since
// 2000.01.01
function moment(text: string): number | undefined {
  const [date, time] = text.split("T");
  const parts = /^(\d{4,})-(\d\d)-(\d\d)$/.exec(date);
  const ms = clock(time ?? "");
  return parts && ms !== undefined
    ? days(Number(parts[1]), Number(parts[2]), Number(parts[3])) * 86_400_000 +
        ms
    : undefined;
}

// A time of day picked, as the browser gives it, in milliseconds
function clock(text: string): number | undefined {
  const parts = /^(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/.exec(text);
  if (!parts) {
    return undefined;
  }
  const [, h, m, s, fraction] = parts;
  return (
    ((Number(h) * 60 + Number(m)) * 60 + Number(s ?? 0)) * 1000 +
    Number((fraction ?? "").padEnd(3, "0"))
  );
}

// Days from 2000.01.01 to a date: Howard Hinnant's days_from_civil, as
// temporal.ts's civil_from_days the other way
function days(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 730425;
}
