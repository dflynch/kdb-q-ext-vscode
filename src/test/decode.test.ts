import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import type { Value } from "../codec/types";

const fixtures: { name: string; type: number; bytes: string }[] = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
    "utf8",
  ),
).values;

function bytes(name: string): Uint8Array {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture, `no fixture .corpus.${name}`);
  return Buffer.from(fixture.bytes, "hex");
}

function hex(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}

const nullLong = -(2n ** 63n);
const infinityLong = 2n ** 63n - 1n;

suite("decode", () => {
  test("every atom and vector in the corpus", () => {
    const simple = fixtures.filter(
      (f) => f.type !== 0 && f.type >= -19 && f.type <= 19,
    );
    assert.ok(simple.length > 100);
    for (const fixture of simple) {
      const value = decode(Buffer.from(fixture.bytes, "hex"));
      assert.strictEqual(value.type, fixture.type, fixture.name);
    }
  });

  // Raw values from q: "j"$ or "i"$ of each one, and nulls and infinities
  // as their sentinels
  const atoms: [string, Value][] = [
    ["atom.boolean", { type: -1, value: 1 }],
    ["atom.byte", { type: -4, value: 42 }],
    ["atom.short", { type: -5, value: 42 }],
    ["atom.int", { type: -6, value: 42 }],
    ["atom.long", { type: -7, value: 42n }],
    ["atom.real", { type: -8, value: Math.fround(4.2) }],
    ["atom.float", { type: -9, value: 4.2 }],
    ["atom.char", { type: -10, value: "q".charCodeAt(0) }],
    ["atom.symbol", { type: -11, value: "kdb" }],
    ["atom.timestamp", { type: -12, value: 845987696123456789n }],
    ["atom.month", { type: -13, value: 321 }],
    ["atom.date", { type: -14, value: 9791 }],
    ["atom.datetime", { type: -15, value: 9791.5242606828706 }],
    ["atom.timespan", { type: -16, value: 45296123456789n }],
    ["atom.minute", { type: -17, value: 754 }],
    ["atom.second", { type: -18, value: 45296 }],
    ["atom.time", { type: -19, value: 45296123 }],
    ["temporal.negativeTime", { type: -19, value: -45296789 }],
    ["temporal.longTimespan", { type: -16, value: 1123199999999999n }],
    ["temporal.preEpochDate", { type: -14, value: -1 }],
    ["null.short", { type: -5, value: -32768 }],
    ["null.int", { type: -6, value: -(2 ** 31) }],
    ["null.long", { type: -7, value: nullLong }],
    ["null.date", { type: -14, value: -(2 ** 31) }],
    ["null.symbol", { type: -11, value: "" }],
    ["infinity.long", { type: -7, value: infinityLong }],
    ["infinity.negativeLong", { type: -7, value: -infinityLong }],
    ["infinity.negativeInt", { type: -6, value: -(2 ** 31 - 1) }],
    ["infinity.float", { type: -9, value: Infinity }],
    ["symbol.utf8", { type: -11, value: "été" }],
  ];
  for (const [name, expected] of atoms) {
    test(name, () => {
      assert.deepStrictEqual(decode(bytes(name)), expected);
    });
  }

  test("float null is NaN", () => {
    const value = decode(bytes("null.float"));
    assert.ok(value.type === -9 && Number.isNaN(value.value));
  });

  test("guid atom and vector", () => {
    const atom = decode(bytes("atom.guid"));
    assert.ok(atom.type === -2);
    assert.strictEqual(hex(atom.value), "0a36903775d3b24d67215a1d44d4bed5");
    const vector = decode(bytes("vector.guid"));
    assert.ok(vector.type === 2);
    assert.strictEqual(
      hex(vector.data),
      "0a36903775d3b24d67215a1d44d4bed500000000000000000000000000000001",
    );
  });

  const vectors: [string, Value][] = [
    ["vector.boolean", { type: 1, attribute: 0, data: Uint8Array.of(1, 0, 1) }],
    ["vector.short", { type: 5, attribute: 0, data: Int16Array.of(1, 2, 3) }],
    [
      "vector.long",
      { type: 7, attribute: 0, data: BigInt64Array.of(1n, 2n, 3n) },
    ],
    [
      "vector.real",
      { type: 8, attribute: 0, data: Float32Array.of(1, 2.5, 3) },
    ],
    [
      "vector.time",
      { type: 19, attribute: 0, data: Int32Array.of(43200000, 43200001) },
    ],
    [
      "special.timestamp",
      {
        type: 12,
        attribute: 0,
        data: BigInt64Array.of(
          nullLong,
          infinityLong,
          -infinityLong,
          845942400000000000n,
        ),
      },
    ],
    ["empty.long", { type: 7, attribute: 0, data: new BigInt64Array(0) }],
    [
      "attribute.sorted",
      { type: 7, attribute: 1, data: BigInt64Array.of(1n, 2n, 3n) },
    ],
    [
      "attribute.parted",
      { type: 7, attribute: 3, data: BigInt64Array.of(1n, 1n, 2n, 2n) },
    ],
    [
      "string.utf8",
      { type: 10, attribute: 0, data: new Uint8Array(Buffer.from("été")) },
    ],
  ];
  for (const [name, expected] of vectors) {
    test(name, () => {
      assert.deepStrictEqual(decode(bytes(name)), expected);
    });
  }

  test("symbol vectors keep their bytes and offsets", () => {
    const symbols = (name: string) => {
      const value = decode(bytes(name));
      assert.ok(value.type === 11);
      const { bytes: data, offsets } = value.data;
      return [value.attribute, Buffer.from(data).toString(), [...offsets]];
    };
    assert.deepStrictEqual(symbols("vector.symbol"), [0, "abc", [0, 1, 2, 3]]);
    assert.deepStrictEqual(symbols("attribute.unique"), [
      2,
      "abc",
      [0, 1, 2, 3],
    ]);
    assert.deepStrictEqual(symbols("attribute.grouped"), [
      4,
      "aba",
      [0, 1, 2, 3],
    ]);
    assert.deepStrictEqual(symbols("special.symbol"), [0, "ac", [0, 1, 1, 2]]);
    assert.deepStrictEqual(symbols("empty.symbol"), [0, "", [0]]);
  });

  test("vectors own their buffers", () => {
    const value = decode(bytes("vector.int"));
    assert.ok(value.type === 6);
    assert.strictEqual(value.data.buffer.byteLength, 12);
  });

  // A message around the bytes of one value, for shapes q won't write
  function message(hex: string): Buffer {
    const bytes = Buffer.from(`0100000000000000${hex}`, "hex");
    bytes.writeUInt32LE(bytes.length, 4);
    return bytes;
  }

  test("symbol atoms keep a leading byte-order mark", () => {
    const value = decode(message("f5efbbbf61626300"));
    assert.deepStrictEqual(value, { type: -11, value: "\ufeffabc" });
  });

  suite("rejects", () => {
    const long = () => Buffer.from(bytes("atom.long"));
    test("a count larger than the message", () => {
      assert.throws(() => decode(message("0700ffffffff")), /ends early/);
      assert.throws(
        () => decode(message("0b00ffffffff6100")),
        /inside a symbol/,
      );
    });
    test("an attribute q doesn't have", () => {
      assert.throws(() => decode(message("070901000000")), /attribute 9/);
    });
    test("something that isn't a q message", () => {
      const notQ = long();
      notQ[0] = 2;
      assert.throws(() => decode(notQ), /isn't a q message/);
    });
    test("a message shorter than its header", () => {
      assert.throws(() => decode(Uint8Array.of(1, 0, 0)), /ends early/);
    });
    test("a message that ends early", () => {
      const message = long().subarray(0, 12);
      message.writeUInt32LE(12, 4);
      assert.throws(() => decode(message), /ends early/);
    });
    test("a header that disagrees with the length", () => {
      assert.throws(() => decode(long().subarray(0, 12)), /header says 17/);
    });
    test("bytes left after the value", () => {
      const message = Buffer.concat([long(), Buffer.of(0)]);
      message.writeUInt32LE(18, 4);
      assert.throws(() => decode(message), /1 bytes left/);
    });
    test("a symbol without its 0 byte", () => {
      const message = Buffer.from(bytes("atom.symbol")).subarray(0, 12);
      message.writeUInt32LE(12, 4);
      assert.throws(() => decode(message), /inside a symbol/);
    });
    test("big-endian and compressed messages", () => {
      const message = long();
      message[0] = 0;
      assert.throws(() => decode(message), /big-endian/);
      assert.throws(
        () => decode(bytes("large.longs").fill(1, 2, 3)),
        /compressed/,
      );
    });
    test("types it can't decode yet", () => {
      assert.throws(
        () => decode(bytes("list.mixed")),
        /type 0 isn't supported/,
      );
    });
  });
});
