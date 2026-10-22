import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { count, type Value, type Vector } from "../codec/types";

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
  test("every value in the corpus", () => {
    for (const fixture of fixtures) {
      const value = decode(Buffer.from(fixture.bytes, "hex"));
      // q's type says 99 for a sorted dictionary, which is 127 on the wire
      const type = value.type === 127 ? 99 : value.type;
      assert.strictEqual(type, fixture.type, fixture.name);
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

  // Shorthands for expected values
  const long = (value: bigint): Value => ({ type: -7, value });
  const longs = (...values: bigint[]): Vector => ({
    type: 7,
    attribute: 0,
    data: BigInt64Array.of(...values),
  });
  const texts = (...values: string[]) => {
    const offsets = [0];
    for (const value of values) {
      offsets.push(offsets[offsets.length - 1] + Buffer.byteLength(value));
    }
    return {
      bytes: new Uint8Array(Buffer.from(values.join(""))),
      offsets: Uint32Array.from(offsets),
    };
  };
  const symbols = (...values: string[]): Vector => ({
    type: 11,
    attribute: 0,
    data: texts(...values),
  });
  const chars = (value: string): Vector => ({
    type: 10,
    attribute: 0,
    data: new Uint8Array(Buffer.from(value)),
  });
  const lambda = (source: string): Value => ({
    type: 100,
    context: "corpus",
    source,
  });

  const structures: [string, Value][] = [
    [
      "list.mixed",
      {
        type: 0,
        attribute: 0,
        items: [
          long(1n),
          { type: -11, value: "a" },
          { type: -10, value: 98 },
          { type: -9, value: 2.5 },
        ],
      },
    ],
    ["list.empty", { type: 0, attribute: 0, items: [] }],
    [
      "dict.simple",
      { type: 99, keys: symbols("a", "b", "c"), values: longs(1n, 2n, 3n) },
    ],
    [
      "dict.sorted",
      {
        type: 127,
        keys: { type: 11, attribute: 1, data: texts("a", "b") },
        values: longs(1n, 2n),
      },
    ],
    [
      "table.stringColumn",
      {
        type: 98,
        attribute: 0,
        columns: ["s", "n"],
        data: [
          { type: 0, attribute: 0, strings: texts("ab", "c", "") },
          longs(1n, 2n, 3n),
        ],
      },
    ],
    [
      "table.charColumns",
      {
        type: 98,
        attribute: 0,
        columns: ["a", "b"],
        data: [chars("ab"), chars("cd")],
      },
    ],
    [
      "table.keyed",
      {
        type: 99,
        keys: {
          type: 98,
          attribute: 0,
          columns: ["sym"],
          data: [symbols("a", "b")],
        },
        values: {
          type: 98,
          attribute: 0,
          columns: ["price"],
          data: [{ type: 9, attribute: 0, data: Float64Array.of(1.5, 2.5) }],
        },
      },
    ],
    ["null.generic", { type: 101, code: 0 }],
    ["fn.implicit", lambda("{x+y}")],
    ["fn.builtin", { type: 101, code: 13 }],
    ["fn.operator", { type: 102, code: 1 }],
    ["fn.iterator", { type: 103, code: 1 }],
    ["fn.projection", { type: 104, parts: [lambda("{x+y}"), long(1n)] }],
    [
      "fn.elided",
      {
        type: 104,
        parts: [lambda("{x+y+z}"), { type: 101, code: 255 }, long(1n)],
      },
    ],
    [
      "fn.composition",
      {
        type: 105,
        parts: [
          { type: 101, code: 2 },
          { type: 101, code: 31 },
        ],
      },
    ],
    ["fn.each", { type: 106, value: { type: 101, code: 13 } }],
    ["fn.iterated", { type: 107, value: { type: 102, code: 1 } }],
  ];
  for (const [name, expected] of structures) {
    test(name, () => {
      assert.deepStrictEqual(decode(bytes(name)), expected);
    });
  }

  test("counts rows, entries and elements", () => {
    const counted = (name: string) => count(decode(bytes(name)));
    assert.strictEqual(counted("table.trades"), 3);
    assert.strictEqual(counted("table.empty"), 0);
    assert.strictEqual(counted("table.multiKeyed"), 2);
    assert.strictEqual(counted("dict.simple"), 3);
    assert.strictEqual(counted("vector.guid"), 2);
    assert.strictEqual(counted("vector.symbol"), 3);
    assert.strictEqual(counted("table.stringColumn"), 3);
    assert.strictEqual(counted("atom.long"), undefined);
  });

  test("table attributes and column attributes", () => {
    const value = decode(bytes("table.attributes"));
    assert.ok(value.type === 98 && "data" in value);
    assert.deepStrictEqual(
      value.data.map((column) => column.attribute),
      [3, 1, 2, 4],
    );
  });

  // From q 5: a splayed table returned as itself, ([] s:`a`b; v:1 2) at
  // `:db/t/, and responses captured from a server over a socket
  test("a reference to a table on the server's disk", () => {
    assert.deepStrictEqual(
      decode(message("6200630b000200000073007600f53a64622f742f00")),
      { type: 98, attribute: 0, columns: ["s", "v"], reference: ":db/t/" },
    );
  });

  test("an error from a server", () => {
    const response = Buffer.from("010200000e000000807479706500", "hex");
    assert.deepStrictEqual(decode(response), { type: -128, message: "type" });
  });

  test("a result from a server", () => {
    const response = Buffer.from(
      "0102000023000000680200000064000a00050000007b782b797df90100000000000000",
      "hex",
    );
    assert.deepStrictEqual(decode(response), {
      type: 104,
      parts: [{ type: 100, context: "", source: "{x+y}" }, long(1n)],
    });
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
    // ([] a:1 2), with the column swapped for other values
    const table = (column: string) =>
      message(`6200630b00010000006100000001000000${column}`);
    test("a malformed table", () => {
      assert.throws(() => decode(message("620001")), /without its dictionary/);
      assert.throws(
        () => decode(message("620063070001000000010000000000000007")),
        /names aren't symbols/,
      );
      assert.throws(
        () => decode(message("6200630b00010000006100070000000000")),
        /columns are type 7/,
      );
      assert.throws(
        () =>
          decode(message("6200630b0001000000610000000200000007000000000000")),
        /1 names but 2 columns/,
      );
      assert.throws(
        () => decode(table("f90100000000000000")),
        /column is type -7/,
      );
    });
    test("lengths that don't match", () => {
      const ragged =
        "6200630b0002000000610062000000020000000700020000000100000000000000" +
        "02000000000000000700010000000300000000000000";
      assert.throws(() => decode(message(ragged)), /columns don't match/);
      const dictionary = "630b0002000000610062000700010000000100000000000000";
      assert.throws(() => decode(message(dictionary)), /don't match in length/);
      const atoms = "63f90100000000000000f90200000000000000";
      assert.throws(() => decode(message(atoms)), /don't match in length/);
    });
    test("a lambda without its source", () => {
      assert.throws(
        () => decode(message("6400f90100000000000000")),
        /source isn't a string/,
      );
    });
    test("a list of strings that ends early", () => {
      const strings = "0000020000000a000200000061620a000200";
      assert.throws(() => decode(message(strings)), /ends early/);
    });
    test("a value nested too deep", () => {
      const nested = `${"000001000000".repeat(1001)}f90100000000000000`;
      assert.throws(() => decode(message(nested)), /nested more than 1000/);
    });
    test("types it can't decode", () => {
      assert.throws(() => decode(message("70")), /type 112 isn't supported/);
      assert.throws(() => decode(message("1400")), /type 20 isn't supported/);
    });
  });
});
