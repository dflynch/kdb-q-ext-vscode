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
// Text is written into a Text that stops taking more once it's full, so a
// large vector costs only as much as the part that's shown.

class Text {
  private parts: string[] = [];
  private length = 0;

  constructor(private limit = Number.POSITIVE_INFINITY) {}

  get full(): boolean {
    return this.length > this.limit;
  }

  put(text: string): void {
    this.parts.push(text);
    this.length += text.length;
  }

  toString(): string {
    return this.parts.join("");
  }
}

// q's form of a value, with at least limit characters of it when it's longer
export function qText(value: Value, limit?: number): string {
  const text = new Text(limit);
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
// The letters q writes after a null or infinity, or a vector, by type. A
// long has none.
const letters = " bg xhi efcspmdznuvt";

// Which special value an element is, if any. Each integer type keeps its
// smallest value for null and the largest, and its negation, for infinity;
// the floating-point types keep NaN and infinities. Other types have none.
type Special = "null" | "infinity" | "-infinity" | undefined;

function special(type: number, x: unknown): Special {
  switch (Math.abs(type)) {
    case 5:
      return x === -32768
        ? "null"
        : x === 32767
          ? "infinity"
          : x === -32767
            ? "-infinity"
            : undefined;
    case 6:
    case 13:
    case 14:
    case 17:
    case 18:
    case 19:
      return x === -2147483648
        ? "null"
        : x === 2147483647
          ? "infinity"
          : x === -2147483647
            ? "-infinity"
            : undefined;
    case 7:
    case 12:
    case 16:
      return x === -0x8000000000000000n
        ? "null"
        : x === 0x7fffffffffffffffn
          ? "infinity"
          : x === -0x7fffffffffffffffn
            ? "-infinity"
            : undefined;
    case 8:
    case 9:
    case 15:
      return Number.isNaN(x)
        ? "null"
        : x === Number.POSITIVE_INFINITY
          ? "infinity"
          : x === Number.NEGATIVE_INFINITY
            ? "-infinity"
            : undefined;
  }
  return undefined;
}

// A float as C's %.7g writes it, q's default \P 7: seven significant
// digits, trailing zeros dropped, and exponent form for the very large and
// the very small
function float(x: number): string {
  if (x === 0) {
    return Object.is(x, -0) ? "-0" : "0";
  }
  const [mantissa, power] = x.toExponential(6).split("e");
  const exponent = Number(power);
  if (exponent < -4 || exponent >= 7) {
    const sign = exponent < 0 ? "-" : "+";
    return `${trim(mantissa)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return trim(x.toFixed(6 - exponent));
}

function trim(digits: string): string {
  return digits.includes(".") ? digits.replace(/\.?0+$/, "") : digits;
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
function element(vector: Vector, i: number): Atom {
  switch (vector.type) {
    case 2:
      return { type: -2, value: vector.data.subarray(16 * i, 16 * i + 16) };
    case 11:
      return { type: -11, value: utf8.decode(textAt(vector.data, i)) };
  }
  return { type: -vector.type, value: vector.data[i] } as Atom;
}

// An ordinary value of an atom, without its type's suffix
function plain(atom: Atom): string {
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
    case -9:
      return float(atom.value);
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
function floating(type: number): boolean {
  return type === 8 || type === 9 || type === 15;
}

function infinity(type: number, which: "infinity" | "-infinity"): string {
  const w = floating(Math.abs(type)) ? "0w" : "0W";
  return which === "infinity" ? w : `-${w}`;
}

// q's form of an atom
function atom(a: Atom): string {
  const which = special(a.type, a.value);
  if (which) {
    // A float has no letter
    const letter = a.type === -9 ? "" : letters[-a.type].trim();
    return `${which === "null" ? (a.type === -9 ? "0n" : "0N") : infinity(a.type, which)}${letter}`;
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
      return `${float(a.value)}e`;
    case -9: {
      const text = float(a.value);
      return /[.e]/.test(text) ? text : `${text}f`;
    }
    case -10:
      return `"${escaped(a.value)}"`;
    case -11:
      return `\`${a.value}`;
    case -13:
      return `${temporal.month(a.value)}m`;
  }
  return plain(a);
}

// An element as q writes it among a vector's others: a null or infinity
// without its type's letter, which goes once at the end of the vector
function inVector(a: Atom): string {
  const which = special(a.type, a.value);
  if (which === "null") {
    return a.type === -9 ? "0n" : "0N";
  }
  return which ? infinity(a.type, which) : plain(a);
}

// An element as the console shows it in a column: a null is blank, though a
// null guid shows its zeros, and a char that can't be shown is escaped
export function cell(vector: Vector, i: number): string {
  const a = element(vector, i);
  const which = special(a.type, a.value);
  if (which === "null") {
    return "";
  }
  return which ? infinity(a.type, which) : plain(a);
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
    text.put(`,${atom(element(v, 0))}`);
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
    const e = inVector(a);
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

// A dictionary's keys go in brackets when they'd otherwise run into the !,
// as a singleton's comma or a table's flip would
function keys(value: Value, text: Text): void {
  const bracket =
    value.type === 98 ||
    value.type === 99 ||
    value.type === 127 ||
    count(value) === 1;
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
          part.code >= 1 &&
          part.code <= 19
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
    text.put(atom(value as Atom));
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
      keys(
        { type: 11, attribute: Attribute.None, data: symbols(value.columns) },
        text,
      );
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

const encoder = new TextEncoder();

// Column names as a symbol vector's data
function symbols(names: string[]): Texts {
  const encoded = names.map((name) => encoder.encode(name));
  const offsets = new Uint32Array(names.length + 1);
  encoded.forEach((bytes, i) => {
    offsets[i + 1] = offsets[i] + bytes.length;
  });
  const bytes = new Uint8Array(offsets[names.length]);
  encoded.forEach((b, i) => {
    bytes.set(b, offsets[i]);
  });
  return { bytes, offsets };
}
