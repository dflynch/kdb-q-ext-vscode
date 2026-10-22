import type { Atom, Attribute, Texts, Value, Vector } from "./types";

const utf8 = new TextDecoder();

// Decode a q IPC message, as a server sends it or -8! writes it. So far this
// covers atoms and vectors; any other type throws.
export function decode(message: Uint8Array): Value {
  if (message.length < 8) {
    throw new Error("the message ends early");
  }
  // Every machine VS Code runs on is little-endian, and q writes in its own
  // byte order, so a big-endian message would come from a rare server
  if (message[0] !== 1) {
    throw new Error("big-endian messages aren't supported");
  }
  if (message[2] !== 0) {
    throw new Error("compressed messages aren't supported yet");
  }
  const reader = new Reader(message);
  const length = reader.uint32(4);
  if (length !== message.length) {
    throw new Error(
      `the header says ${length} bytes, but there are ${message.length}`,
    );
  }
  reader.offset = 8;
  const value = reader.value();
  if (reader.offset !== length) {
    throw new Error(`${length - reader.offset} bytes left after the value`);
  }
  return value;
}

class Reader {
  offset = 0;
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
    if (type > 0 && type <= 19) {
      return this.vector(type);
    }
    throw new Error(`type ${type} isn't supported yet`);
  }

  private atom(type: number): Atom {
    switch (type) {
      case -1:
      case -4:
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
      case -10:
        return { type, value: this.message[this.take(1)] };
      case -11:
        return { type, value: utf8.decode(this.symbol()) };
    }
    throw new Error(`type ${type} isn't an atom`);
  }

  private vector(type: number): Vector {
    const attribute = this.message[this.take(1)] as Attribute;
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

  // Symbols end to end without their 0 bytes, and n + 1 offsets. Copied a
  // byte at a time, so a column makes no object per symbol.
  private symbols(count: number): Texts {
    const start = this.offset;
    for (let i = 0; i < count; i++) {
      this.symbolEnd();
    }
    const wire = this.message.subarray(start, this.offset);
    const bytes = new Uint8Array(wire.length - count);
    const offsets = new Uint32Array(count + 1);
    let symbol = 0;
    let length = 0;
    for (const byte of wire) {
      if (byte === 0) {
        offsets[++symbol] = length;
      } else {
        bytes[length++] = byte;
      }
    }
    return { bytes, offsets };
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
      throw new Error("the message ends inside a symbol");
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

  uint32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  // Claim the next n bytes, returning where they start
  private take(n: number): number {
    const start = this.offset;
    if (start + n > this.message.length) {
      throw new Error("the message ends early");
    }
    this.offset += n;
    return start;
  }
}
