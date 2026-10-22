// What the decoder produces from a q IPC message. Values keep q's type,
// attribute and raw data; turning them into text is the formatter's job, as
// formatting early is where fidelity is lost.
//
// Vector data lives in typed arrays with buffers of their own, outside the
// JavaScript heap, so a large result is never expanded into one object or
// string per element. Nulls and infinities stay as q's raw sentinel values,
// so one type's null can be told from another's, and an infinity from a null.

// q's attributes, numbered as on the wire
export enum Attribute {
  None = 0,
  Sorted = 1,
  Unique = 2,
  Parted = 3,
  Grouped = 4,
}

// Symbols as their UTF-8 bytes, each ending in a 0 byte as on the wire, and
// the offset where each one starts. Symbol columns are where results get big,
// so they're never a string per value.
export interface Symbols {
  bytes: Uint8Array;
  offsets: Uint32Array;
}

// Atoms are negative types. Integers too wide for a JavaScript number are
// bigints. Temporal values are q's own counts, never Date: days, months,
// minutes, seconds and milliseconds since 2000.01.01 or midnight, and
// nanoseconds for timestamps and timespans.
export type Atom =
  | { type: -1; value: number } // boolean, 0 or 1
  | { type: -2; value: Uint8Array } // guid, 16 bytes
  | { type: -4; value: number } // byte
  | { type: -5; value: number } // short
  | { type: -6; value: number } // int
  | { type: -7; value: bigint } // long
  | { type: -8; value: number } // real
  | { type: -9; value: number } // float
  | { type: -10; value: number } // char, a byte: q strings needn't be UTF-8
  | { type: -11; value: string } // symbol
  | { type: -12; value: bigint } // timestamp, nanoseconds since 2000.01.01
  | { type: -13; value: number } // month, months since 2000.01
  | { type: -14; value: number } // date, days since 2000.01.01
  | { type: -15; value: number } // datetime, days since 2000.01.01 as a float
  | { type: -16; value: bigint } // timespan, nanoseconds
  | { type: -17; value: number } // minute, minutes
  | { type: -18; value: number } // second, seconds
  | { type: -19; value: number }; // time, milliseconds

// Vectors are the positive types, with the same element types as atoms
export type Vector = { attribute: Attribute } & (
  | { type: 1; data: Uint8Array } // boolean
  | { type: 2; data: Uint8Array } // guid, 16 bytes each
  | { type: 4; data: Uint8Array } // byte
  | { type: 5; data: Int16Array } // short
  | { type: 6; data: Int32Array } // int
  | { type: 7; data: BigInt64Array } // long
  | { type: 8; data: Float32Array } // real
  | { type: 9; data: Float64Array } // float
  | { type: 10; data: Uint8Array } // char
  | { type: 11; data: Symbols } // symbol
  | { type: 12; data: BigInt64Array } // timestamp
  | { type: 13; data: Int32Array } // month
  | { type: 14; data: Int32Array } // date
  | { type: 15; data: Float64Array } // datetime
  | { type: 16; data: BigInt64Array } // timespan
  | { type: 17; data: Int32Array } // minute
  | { type: 18; data: Int32Array } // second
  | { type: 19; data: Int32Array } // time
);

// A general list: a value per element, so only for mixed or nested data
export interface List {
  type: 0;
  attribute: Attribute;
  items: Value[];
}

// A table's columns in order, each a vector or a general list of equal length
export interface Table {
  type: 98;
  attribute: Attribute;
  columns: string[];
  data: (Vector | List)[];
}

// A dictionary, or a sorted one (127 on the wire). A keyed table is a
// dictionary from a table of keys to a table of values.
export interface Dictionary {
  type: 99 | 127;
  keys: Value;
  values: Value;
}

// The function types. A lambda keeps its source text and the namespace it
// was defined in. Primitives are q's internal codes, and :: is the unary
// primitive 0. Projections and compositions keep their parts, and an
// iterator keeps the value it applies to, so each can be shown as q shows
// it. A foreign object holds a C pointer, so there's nothing to keep.
export type QFunction =
  | { type: 100; context: string; source: string } // lambda
  | { type: 101 | 102 | 103; code: number } // unary, binary, ternary primitive
  | { type: 104 | 105; parts: Value[] } // projection, composition
  | { type: 106 | 107 | 108 | 109 | 110 | 111; value: Value } // ' / \ ': /: \:
  | { type: 112 }; // foreign

// An error the server sent instead of a result, such as 'type
export interface QError {
  type: -128;
  message: string;
}

export type Value =
  | Atom
  | Vector
  | List
  | Table
  | Dictionary
  | QFunction
  | QError;
