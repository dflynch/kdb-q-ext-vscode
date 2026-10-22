import { decompress } from "./decompress";
import { badmsg } from "./errors";
import {
  type Atom,
  count,
  type List,
  type QFunction,
  type Table,
  type Texts,
  type Value,
  type Vector,
} from "./types";

// Keeping a leading byte-order mark, which q would show as part of the symbol
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// Decode a q IPC message, as a server sends it or -8! or -18! writes it.
// A message it can't read throws badmsg, as q does; big-endian messages and
// foreign objects, which q can read, throw errors of their own.
export function decode(message: Uint8Array): Value {
  if (message.length < 8) {
    throw badmsg("the message ends early");
  }
  // Every machine VS Code runs on is little-endian, and q writes in its own
  // byte order, so a big-endian message would come from a rare server
  if (message[0] === 0) {
    throw new Error("big-endian messages aren't supported");
  }
  if (message[0] !== 1) {
    throw badmsg(`first byte ${message[0]} isn't 0 or 1`);
  }
  const length = new DataView(
    message.buffer,
    message.byteOffset,
    message.byteLength,
  ).getUint32(4, true);
  if (length !== message.length) {
    throw badmsg(
      `the header says ${length} bytes, but there are ${message.length}`,
    );
  }
  if (message[2] > 1) {
    throw badmsg(`compression flag ${message[2]} isn't one of q's`);
  }
  const data = message[2] ? decompress(message) : message;
  const reader = new Reader(data);
  const value = reader.value();
  if (reader.offset !== data.length) {
    throw badmsg(`${data.length - reader.offset} bytes left after the value`);
  }
  return value;
}

class Reader {
  // Past the header
  offset = 8;
  private view: DataView;

  constructor(private message: Uint8Array) {
    this.view = new DataView(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    );
  }

  value(): Value {
    const type = this.view.getInt8(this.take(1));
    if (type < 0 && type >= -19) {
      return this.atom(type);
    }
    // There's no type 3
    if (type > 0 && type <= 19 && type !== 3) {
      return this.vector(type);
    }
    switch (type) {
      case 0:
        return this.list();
      case 98:
        return this.table();
      case 99:
      case 127:
        return this.dictionary(type);
      case 100:
        return this.lambda();
      case 101:
      case 102:
      case 103:
        return { type, code: this.message[this.take(1)] };
      case 104:
      case 105:
        return { type, parts: this.values(this.uint32(this.take(4))) };
      case 106:
      case 107:
      case 108:
      case 109:
      case 110:
      case 111:
        return { type, value: this.value() };
      case -128:
        return { type, message: utf8.decode(this.symbol()) };
    }
    if (type === 112) {
      throw new Error("foreign objects aren't supported");
    }
    throw badmsg(`unknown type ${type}`);
  }

  private values(count: number): Value[] {
    const values: Value[] = [];
    for (let i = 0; i < count; i++) {
      values.push(this.value());
    }
    return values;
  }

  private list(): List {
    const attribute = this.attribute();
    const count = this.uint32(this.take(4));
    const strings = this.strings(count);
    if (strings) {
      return { type: 0, attribute, strings };
    }
    return { type: 0, attribute, items: this.values(count) };
  }

  // The items of a list of strings end to end, or nothing if the list is
  // empty or any item isn't a char vector without an attribute. Every item's
  // header is checked before anything is copied, so a string column makes no
  // object per string.
  private strings(count: number): Texts | undefined {
    const message = this.message;
    let at = this.offset;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 6 > message.length || message[at] !== 10 || message[at + 1]) {
        return undefined;
      }
      const length = this.uint32(at + 2);
      total += length;
      at += 6 + length;
    }
    if (count === 0 || at > message.length) {
      return undefined;
    }
    const bytes = new Uint8Array(total);
    const offsets = new Uint32Array(count + 1);
    for (let i = 0; i < count; i++) {
      const length = this.uint32(this.take(6) + 2);
      const start = this.take(length);
      // Byte by byte: subarray would make an object per string
      for (let j = 0; j < length; j++) {
        bytes[offsets[i] + j] = message[start + j];
      }
      offsets[i + 1] = offsets[i] + length;
    }
    return { bytes, offsets };
  }

  private dictionary(type: 99 | 127): Value {
    const keys = this.value();
    const values = this.value();
    const length = count(keys);
    if (length === undefined || length !== count(values)) {
      throw badmsg("a dictionary's keys and values don't match in length");
    }
    return { type, keys, values };
  }

  // A table is a flag, then a dictionary from its column names to a list of
  // its columns, or to a symbol for a table on the server's disk
  private table(): Table {
    const attribute = this.attribute();
    if (this.message[this.take(1)] !== 99) {
      throw badmsg("a table without its dictionary");
    }
    const names = this.value();
    if (names.type !== 11) {
      throw badmsg("a table's column names aren't symbols");
    }
    const { bytes, offsets } = names.data;
    const columns = [...offsets.subarray(1)].map((end, i) =>
      utf8.decode(bytes.subarray(offsets[i], end)),
    );
    const kind = this.view.getInt8(this.take(1));
    if (kind === -11) {
      return {
        type: 98,
        attribute,
        columns,
        reference: utf8.decode(this.symbol()),
      };
    }
    if (kind !== 0) {
      throw badmsg(`a table's columns are type ${kind}`);
    }
    this.attribute();
    // Read item by item, so that columns which are all char vectors aren't
    // taken for a list of strings
    const length = this.uint32(this.take(4));
    if (length !== columns.length) {
      throw badmsg(`a table has ${columns.length} names but ${length} columns`);
    }
    const data: (Vector | List)[] = [];
    for (const column of this.values(length)) {
      if (column.type < 0 || column.type > 19) {
        throw badmsg(`a table column is type ${column.type}`);
      }
      data.push(column as Vector | List);
    }
    const rows = new Set(data.map((column) => count(column)));
    if (rows.size > 1) {
      throw badmsg("a table's columns don't match in length");
    }
    return { type: 98, attribute, columns, data };
  }

  // A lambda is the namespace it was defined in, then its source
  private lambda(): QFunction {
    const context = utf8.decode(this.symbol());
    const source = this.value();
    if (source.type !== 10) {
      throw badmsg("a lambda's source isn't a string");
    }
    return { type: 100, context, source: utf8.decode(source.data) };
  }

  private atom(type: number): Atom {
    switch (type) {
      case -1:
      case -4:
      case -10:
        return { type, value: this.message[this.take(1)] };
      case -2:
        return { type, value: this.bytes(16) };
      case -5:
        return { type, value: this.view.getInt16(this.take(2), true) };
      case -6:
      case -13:
      case -14:
      case -17:
      case -18:
      case -19:
        return { type, value: this.view.getInt32(this.take(4), true) };
      case -7:
      case -12:
      case -16:
        return { type, value: this.view.getBigInt64(this.take(8), true) };
      case -8:
        return { type, value: this.view.getFloat32(this.take(4), true) };
      case -9:
      case -15:
        return { type, value: this.view.getFloat64(this.take(8), true) };
      case -11:
        return { type, value: utf8.decode(this.symbol()) };
    }
    throw new Error(`type ${type} isn't an atom`);
  }

  private vector(type: number): Vector {
    const attribute = this.attribute();
    const count = this.uint32(this.take(4));
    switch (type) {
      case 1:
      case 4:
      case 10:
        return { type, attribute, data: this.bytes(count) };
      case 2:
        return { type, attribute, data: this.bytes(count * 16) };
      case 5:
        return {
          type,
          attribute,
          data: new Int16Array(this.buffer(count * 2)),
        };
      case 6:
      case 13:
      case 14:
      case 17:
      case 18:
      case 19:
        return {
          type,
          attribute,
          data: new Int32Array(this.buffer(count * 4)),
        };
      case 7:
      case 12:
      case 16:
        return {
          type,
          attribute,
          data: new BigInt64Array(this.buffer(count * 8)),
        };
      case 8:
        return {
          type,
          attribute,
          data: new Float32Array(this.buffer(count * 4)),
        };
      case 9:
      case 15:
        return {
          type,
          attribute,
          data: new Float64Array(this.buffer(count * 8)),
        };
      case 11:
        return { type, attribute, data: this.symbols(count) };
    }
    throw new Error(`type ${type} isn't a vector`);
  }

  // Symbols end to end without their 0 bytes, and n + 1 offsets
  private symbols(count: number): Texts {
    const start = this.offset;
    for (let i = 0; i < count; i++) {
      this.symbolEnd();
    }
    const message = this.message;
    const bytes = new Uint8Array(this.offset - start - count);
    const offsets = new Uint32Array(count + 1);
    let symbol = 0;
    let length = 0;
    for (let i = start; i < this.offset; i++) {
      if (message[i] === 0) {
        offsets[++symbol] = length;
      } else {
        bytes[length++] = message[i];
      }
    }
    return { bytes, offsets };
  }

  private attribute(): number {
    const attribute = this.message[this.take(1)];
    if (attribute > 4) {
      throw badmsg(`attribute ${attribute} isn't one of q's`);
    }
    return attribute;
  }

  // A symbol's bytes, up to the 0 byte that ends it
  private symbol(): Uint8Array {
    const start = this.offset;
    return this.message.subarray(start, this.symbolEnd());
  }

  // Move past the next symbol, returning where its 0 byte is
  private symbolEnd(): number {
    const end = this.message.indexOf(0, this.offset);
    if (end < 0) {
      throw badmsg("the message ends inside a symbol");
    }
    this.offset = end + 1;
    return end;
  }

  // A copy of the next n bytes, in a buffer of its own: typed arrays need
  // aligned offsets, and a column mustn't keep the whole message alive. Not
  // slice, which on a Node Buffer, as from a socket, returns a view.
  private bytes(n: number): Uint8Array<ArrayBuffer> {
    const start = this.take(n);
    const copy = new Uint8Array(n);
    copy.set(this.message.subarray(start, start + n));
    return copy;
  }

  private buffer(n: number): ArrayBuffer {
    return this.bytes(n).buffer;
  }

  private uint32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  // Claim the next n bytes, returning where they start
  private take(n: number): number {
    const start = this.offset;
    if (start + n > this.message.length) {
      throw badmsg("the message ends early");
    }
    this.offset += n;
    return start;
  }
}
