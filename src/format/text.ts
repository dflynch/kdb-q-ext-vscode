import {
  type Atom,
  Attribute,
  count,
  type List,
  type QFunction,
  type Texts,
  type Value,
  type Vector,
} from "../codec/types";
import * as temporal from "./temporal";

// Values as q writes them as text. Two forms:
// - q's own form, as -3! gives it and the console shows a value inside a
//   list: atoms with their type's suffix, as in 42h or `kdb, and lists in
//   brackets, as in (1;`a)
// - a cell's form, as the console shows an element of a vector in a column:
//   no suffix, quotes or backtick, and a blank for a null
//
// Text is written into a Text that takes no more once it's full, so a large
// vector costs only as much as the part that's shown. Loops also stop when
// it's full, so as not to format what would be dropped.

// How much text to take: past as many lines, or a line as wide as width,
// it's cut; and how many significant digits a float or a real is written
// to, as q's \P: 1 to 17, or 0 for as many as each holds, 17 and 8
export type Bounds = { lines: number; width: number; precision: number };

class Text {
  private parts: string[] = [];
  private lines = 1;
  // The length of the last line
  private line = 0;

  constructor(readonly size: Bounds) {}

  get full(): boolean {
    return this.line > this.size.width || this.lines > this.size.lines;
  }

  // Once full, what's there is cut anyway
  put(text: string): void {
    if (this.full) {
      return;
    }
    this.parts.push(text);
    const end = text.lastIndexOf("\n");
    if (end < 0) {
      this.line += text.length;
    } else {
      this.lines += text.split("\n").length - 1;
      this.line = text.length - end - 1;
    }
  }

  toString(): string {
    return this.parts.join("");
  }
}

// q's form of a value, with at least as much of it as fits the size
export function qText(value: Value, size: Bounds): string {
  const text = new Text(size);
  write(value, text);
  return text.toString();
}

// The internal codes of q's primitives, as -3! shows each
// biome-ignore format: a table
const unaries = [
  "::", "+:", "-:", "*:", "%:", "&:", "|:", "^:", "=:", "<:", ">:", "$:",
  ",:", "#:", "_:", "~:", "!:", "?:", "@:", ".:", "0::", "1::", "2::", "avg",
  "last", "sum", "prd", "min", "max", "exit", "getenv", "abs", "sqrt", "log",
  "exp", "sin", "asin", "cos", "acos", "tan", "atan", "enlist", "var", "dev",
  "hopen",
];
// biome-ignore format: a table
const operators = [
  ":", "+", "-", "*", "%", "&", "|", "^", "=", "<", ">", "$", ",", "#", "_",
  "~", "!", "?", "@", ".", "0:", "1:", "2:", "in", "within", "like", "bin",
  "ss", "insert", "wsum", "wavg", "div", "xexp", "setenv", "binr", "cov",
  "cor",
];
// Also the iterated functions, 106 to 111, in the same order
const iterators = ["'", "/", "\\", "':", "/:", "\\:"];
// The unary code of a projection's missing argument, as in +[;1]
const elided = 255;

// The type names q casts an empty vector with, by type
// biome-ignore format: a table
const names = [
  "", "boolean", "guid", "", "byte", "short", "int", "long", "real", "float",
  "char", "symbol", "timestamp", "month", "date", "datetime", "timespan",
  "minute", "second", "time",
];
// The letters q writes after a null or infinity, or a vector, by type, as
// .Q.t has them. A long's j is never written.
const letters = " bg xhijefcspmdznuvt";

// Which special value an element is, if any. Each integer type keeps its
// smallest value for null and the largest, and its negation, for infinity;
// the floating-point types keep NaN and infinities. Other types have none.
type Special = "null" | "infinity" | "-infinity" | undefined;

const short = [-32768, 32767, -32767];
const int = [-2147483648, 2147483647, -2147483647];
const long = [-0x8000000000000000n, 0x7fffffffffffffffn, -0x7fffffffffffffffn];
const floating = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];
// Null, infinity and -infinity, by type
// biome-ignore format: a table
const specials: Partial<Record<number, unknown[]>> = {
  5: short, 6: int, 7: long, 8: floating, 9: floating, 12: long, 13: int,
  14: int, 15: floating, 16: long, 17: int, 18: int, 19: int,
};

function special(type: number, x: unknown): Special {
  const values = specials[Math.abs(type)];
  // Object.is, as NaN isn't equal to itself
  const i = values ? values.findIndex((v) => Object.is(v, x)) : -1;
  return i < 0 ? undefined : (["null", "infinity", "-infinity"] as const)[i];
}

// A float as C's %.7g writes it, q's default \P 7: seven significant
// digits, or as many as asked, trailing zeros dropped, and exponent form for
// the very large and the very small. JavaScript rounds as C does except for
// an exact tie, which C rounds to even: 1000.0625 is 1000.062.
export function float(x: number, precision = 7): string {
  if (x === 0) {
    return Object.is(x, -0) ? "-0" : "0";
  }
  // Twenty digits after the first are past a double's precision, so a tie
  // shows as a 5 then zeros
  const [m, e] = Math.abs(x).toExponential(20).split("e");
  const all = m.replace(".", "");
  const rest = all.slice(precision);
  const tie = /^50*$/.test(rest);
  const up = rest[0] >= "5" && (!tie || Number(all[precision - 1]) % 2 === 1);
  // As a bigint, as 16 or 17 digits can be past what a double holds
  let digits = String(BigInt(all.slice(0, precision)) + (up ? 1n : 0n));
  let exponent = Number(e);
  if (digits.length > precision) {
    digits = digits.slice(0, precision);
    exponent += 1;
  }
  const sign = x < 0 ? "-" : "";
  if (exponent < -4 || exponent >= precision) {
    const power = `${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
    const mantissa = `${digits[0]}.${digits.slice(1)}`;
    // q keeps the zeros of a tie it rounds down: 10541605 is 1.054160e+07
    return `${sign}${tie && !up ? mantissa : trim(mantissa)}e${power}`;
  }
  const point =
    exponent < 0
      ? `0.${"0".repeat(-exponent - 1)}${digits}`
      : `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  return `${sign}${trim(point)}`;
}

function trim(digits: string): string {
  return digits.includes(".") ? digits.replace(/\.?0*$/, "") : digits;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function guid(bytes: Uint8Array): string {
  const h = Array.from(bytes, hex).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A char as it's written inside a string's quotes
function escaped(byte: number): string {
  switch (byte) {
    case 0x22:
      return '\\"';
    case 0x5c:
      return "\\\\";
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0d:
      return "\\r";
  }
  return byte >= 0x20 && byte < 0x7f
    ? String.fromCharCode(byte)
    : `\\${byte.toString(8).padStart(3, "0")}`;
}

function quoted(bytes: Uint8Array, text: Text): void {
  text.put('"');
  for (let i = 0; i < bytes.length && !text.full; i++) {
    text.put(escaped(bytes[i]));
  }
  text.put('"');
}

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

function textAt(texts: Texts, i: number): Uint8Array {
  return texts.bytes.subarray(texts.offsets[i], texts.offsets[i + 1]);
}

// An element of a vector, as an atom
export function element(vector: Vector, i: number): Atom {
  switch (vector.type) {
    case 2:
      return { type: -2, value: vector.data.subarray(16 * i, 16 * i + 16) };
    case 11:
      return { type: -11, value: utf8.decode(textAt(vector.data, i)) };
  }
  return { type: -vector.type, value: vector.data[i] } as Atom;
}

// An ordinary value of an atom, without its type's suffix
function plain(atom: Atom, precision: number): string {
  switch (atom.type) {
    case -1:
    case -5:
    case -6:
    case -7:
      return String(atom.value);
    case -2:
      return guid(atom.value);
    case -4:
      return hex(atom.value);
    case -8:
      return float(atom.value, precision || 8);
    case -9:
      return float(atom.value, precision || 17);
    case -10:
      // Raw, as in a column, unless it can't be shown
      return atom.value >= 0x20 && atom.value < 0x7f
        ? String.fromCharCode(atom.value)
        : escaped(atom.value);
    case -11:
      return atom.value;
    case -12:
      return temporal.timestamp(atom.value);
    case -13:
      return temporal.month(atom.value);
    case -14:
      return temporal.date(atom.value);
    case -15:
      return temporal.datetime(atom.value);
    case -16:
      return temporal.timespan(atom.value);
    case -17:
      return temporal.minute(atom.value);
    case -18:
      return temporal.second(atom.value);
    case -19:
      return temporal.time(atom.value);
  }
}

// q writes infinities in floating-point types with a lowercase w
function infinity(type: number, which: "infinity" | "-infinity"): string {
  const w = specials[Math.abs(type)] === floating ? "0w" : "0W";
  return which === "infinity" ? w : `-${w}`;
}

// q's form of an atom
function atom(a: Atom, precision: number): string {
  if (special(a.type, a.value)) {
    // A long and a float have no letter
    return `${inVector(a, precision)}${[-7, -9].includes(a.type) ? "" : letters[-a.type]}`;
  }
  switch (a.type) {
    case -1:
      return `${a.value}b`;
    case -4:
      return `0x${hex(a.value)}`;
    case -5:
      return `${a.value}h`;
    case -6:
      return `${a.value}i`;
    case -8:
      return `${plain(a, precision)}e`;
    case -9: {
      const text = plain(a, precision);
      return /[.e]/.test(text) ? text : `${text}f`;
    }
    case -10:
      return `"${escaped(a.value)}"`;
    case -11:
      return `\`${a.value}`;
    case -13:
      return `${temporal.month(a.value)}m`;
  }
  return plain(a, precision);
}

// An element as q writes it among a vector's others: a null or infinity
// without its type's letter, which goes once at the end of the vector
function inVector(a: Atom, precision: number): string {
  const which = special(a.type, a.value);
  if (which === "null") {
    return a.type === -9 ? "0n" : "0N";
  }
  return which ? infinity(a.type, which) : plain(a, precision);
}

// An element as the console shows it in a column: a null is blank, though a
// null guid shows its zeros, and a char that can't be shown is escaped
export function cell(vector: Vector, i: number, precision: number): string {
  const a = element(vector, i);
  const which = special(a.type, a.value);
  if (which === "null") {
    return "";
  }
  return which ? infinity(a.type, which) : plain(a, precision);
}

// An element as q's csv 0: writes it: as in a column, but a char as itself,
// and a date with - between its parts, as ISO 8601 has it, a datetime with a
// space before its time
export function csvCell(vector: Vector, i: number, precision: number): string {
  const a = element(vector, i);
  if (a.type === -10) {
    return utf8.decode(Uint8Array.of(a.value));
  }
  const text = cell(vector, i, precision);
  if (a.type < -15 || a.type > -12 || special(a.type, a.value)) {
    return text;
  }
  const date = text.slice(0, 10).replaceAll(".", "-");
  const rest = text.slice(10);
  return `${date}${a.type === -15 ? rest.replace("T", " ") : rest}`;
}

// Text as it is, without q's quotes and escapes
export function decoded(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

function attribute(value: { attribute: Attribute }, text: Text): void {
  if (value.attribute !== Attribute.None) {
    text.put(`\`${" supg"[value.attribute]}#`);
  }
}

function vector(v: Vector, text: Text): void {
  attribute(v, text);
  const n = count(v) ?? 0;
  if (n === 0) {
    text.put(v.type === 10 ? '""' : `\`${names[v.type]}$()`);
    return;
  }
  if (n === 1 && v.type !== 10) {
    text.put(`,${atom(element(v, 0), text.size.precision)}`);
    return;
  }
  switch (v.type) {
    case 1:
      for (let i = 0; i < n && !text.full; i++) {
        text.put(String(v.data[i]));
      }
      text.put("b");
      return;
    case 4:
      text.put("0x");
      for (let i = 0; i < n && !text.full; i++) {
        text.put(hex(v.data[i]));
      }
      return;
    case 10:
      if (n === 1) {
        text.put(",");
      }
      quoted(v.data, text);
      return;
    case 11:
      for (let i = 0; i < n && !text.full; i++) {
        text.put(`\`${utf8.decode(textAt(v.data, i))}`);
      }
      return;
  }
  // Whether any element is an ordinary value, and for floats, whether any
  // already shows it's a float
  let ordinary = false;
  let shown = false;
  for (let i = 0; i < n && !text.full; i++) {
    const a = element(v, i);
    const e = inVector(a, text.size.precision);
    ordinary ||= special(a.type, a.value) === undefined;
    shown ||= /[.enw]/.test(e);
    text.put(i ? ` ${e}` : e);
  }
  switch (v.type) {
    case 5:
    case 6:
    case 8:
    case 13:
      text.put(letters[v.type]);
      return;
    case 9:
      if (!shown) {
        text.put("f");
      }
      return;
    case 12:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
      // Only nulls and infinities, which could be any of these
      if (!ordinary) {
        text.put(letters[v.type]);
      }
  }
}

function string(texts: Texts, i: number, text: Text): void {
  const bytes = textAt(texts, i);
  if (bytes.length === 1) {
    text.put(",");
  }
  quoted(bytes, text);
}

function list(l: List, text: Text): void {
  attribute(l, text);
  const n = count(l) ?? 0;
  if (n === 0) {
    text.put("()");
    return;
  }
  const item = (i: number) =>
    "items" in l ? write(l.items[i], text) : string(l.strings, i, text);
  if (n === 1) {
    text.put(",");
    item(0);
    return;
  }
  text.put("(");
  for (let i = 0; i < n && !text.full; i++) {
    if (i) {
      text.put(";");
    }
    item(i);
  }
  text.put(")");
}

// A dictionary's keys go in brackets, as q puts them, when they're a table,
// a dictionary, or a vector of fewer than two
function keys(value: Value, text: Text): void {
  const bracket =
    value.type === 98 ||
    value.type === 99 ||
    value.type === 127 ||
    (value.type > 0 && value.type <= 19 && (count(value) ?? 0) < 2);
  if (bracket) {
    text.put("(");
  }
  write(value, text);
  if (bracket) {
    text.put(")");
  }
}

function fn(f: QFunction, text: Text): void {
  switch (f.type) {
    case 100:
      text.put(f.source);
      return;
    case 101:
      text.put(
        f.code === elided ? "::" : (unaries[f.code] ?? `unary ${f.code}`),
      );
      return;
    case 102:
      text.put(operators[f.code] ?? `operator ${f.code}`);
      return;
    case 103:
      text.put(iterators[f.code] ?? `iterator ${f.code}`);
      return;
    case 104: {
      const [head, ...args] = f.parts;
      write(head, text);
      text.put("[");
      args.forEach((arg, i) => {
        if (i) {
          text.put(";");
        }
        if (!(arg.type === 101 && arg.code === elided)) {
          write(arg, text);
        }
      });
      text.put("]");
      return;
    }
    case 105:
      // Side by side, each primitive but the last without its colon, so
      // '[neg;abs] is -abs
      f.parts.forEach((part, i) => {
        if (
          i < f.parts.length - 1 &&
          part.type === 101 &&
          unaries[part.code]?.endsWith(":")
        ) {
          text.put(unaries[part.code].slice(0, -1));
        } else {
          write(part, text);
        }
      });
      return;
    case 112:
      text.put("foreign");
      return;
  }
  write(f.value, text);
  text.put(iterators[f.type - 106]);
}

// Write a value in q's form
function write(value: Value, text: Text): void {
  if (value.type < 0 && value.type >= -19) {
    text.put(atom(value as Atom, text.size.precision));
    return;
  }
  switch (value.type) {
    case 0:
      list(value, text);
      return;
    case 98:
      attribute(value, text);
      text.put("+");
      if ("reference" in value) {
        // Only the server can read an on-disk table's files
        text.put(`\`${value.reference}`);
        return;
      }
      text.put(columns(value.columns));
      text.put("!");
      list({ type: 0, attribute: Attribute.None, items: value.data }, text);
      return;
    case 99:
    case 127:
      if (value.type === 127) {
        text.put("`s#");
      }
      keys(value.keys, text);
      text.put("!");
      write(value.values, text);
      return;
    case -128:
      text.put(`'${value.message}`);
      return;
  }
  if (value.type >= 100) {
    fn(value as QFunction, text);
    return;
  }
  vector(value as Vector, text);
}

// A table's column names as its dictionary's keys, which q brackets when
// there are fewer than two
function columns(names: string[]): string {
  const symbols = names.map((name) => `\`${name}`).join("");
  switch (names.length) {
    case 0:
      return "(`symbol$())";
    case 1:
      return `(,${symbols})`;
  }
  return symbols;
}
