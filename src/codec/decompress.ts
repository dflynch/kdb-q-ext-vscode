// Ported from KX's Java interface (https://github.com/KxSystems/javakdb,
// c.java, uncompress), Copyright (c) 1998-2017 Kx Systems Inc., under the
// Apache License 2.0: see NOTICE. Changed from the original: TypeScript on a
// Uint8Array, a copy of the header in the result, and checks that the
// compressed data ends where the message does.

// Expand a compressed q message into the message it stands for, header
// included. After the header comes the uncompressed length, then the data:
// a flag byte for every eight items, where a clear bit is a literal byte and
// a set bit is a copy of earlier output. A copy is two bytes: an index into a
// table of recent positions, keyed by the xor of the two bytes found there,
// and how many bytes past two to copy.
export function decompress(message: Uint8Array): Uint8Array {
  if (message.length < 12) {
    throw new Error("the message ends early");
  }
  const length = new DataView(
    message.buffer,
    message.byteOffset,
    message.byteLength,
  ).getUint32(8, true);
  const out = new Uint8Array(length);
  out.set(message.subarray(0, 4));
  out[2] = 0;
  out.set(message.subarray(8, 12), 4);
  const positions = new Int32Array(256);
  let from = 12;
  let to = 8;
  let hashed = to;
  let flags = 0;
  let bit = 0;
  while (to < length && from < message.length) {
    if (bit === 0) {
      flags = message[from++];
      bit = 1;
    }
    const copy = (flags & bit) !== 0;
    let extra = 0;
    if (copy) {
      let start = positions[message[from++]];
      out[to++] = out[start++];
      out[to++] = out[start++];
      extra = message[from++];
      for (let i = 0; i < extra; i++) {
        out[to + i] = out[start + i];
      }
    } else {
      out[to++] = message[from++];
    }
    while (hashed < to - 1) {
      positions[out[hashed] ^ out[hashed + 1]] = hashed++;
    }
    if (copy) {
      to += extra;
      hashed = to;
    }
    bit = bit === 128 ? 0 : bit * 2;
  }
  // Data that runs out early, or runs past the length, isn't q's
  if (to !== length || from !== message.length) {
    throw new Error("the compressed message is malformed");
  }
  return out;
}
