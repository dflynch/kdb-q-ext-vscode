import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { bytes, OverBudget } from "../codec/errors";

const fixtures: { name: string; bytes: string; compressed?: string }[] =
  JSON.parse(
    readFileSync(
      path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
      "utf8",
    ),
  ).values;

function sized(message: Buffer): Buffer {
  message.writeUInt32LE(message.length, 4);
  return message;
}

// n chars, as a char vector and as a general list of char atoms
function chars(n: number): Buffer {
  const message = Buffer.alloc(14 + n, "a");
  message.set([1, 0, 0, 0, 0, 0, 0, 0, 10, 0]);
  message.writeUInt32LE(n, 10);
  return sized(message);
}

function atoms(n: number): Buffer {
  const message = Buffer.alloc(14 + 2 * n);
  message.set([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  message.writeUInt32LE(n, 10);
  for (let i = 0; i < n; i++) {
    message.set([0xf6, 97], 14 + 2 * i);
  }
  return sized(message);
}

// A general list of n copies of one item's bytes
function list(n: number, item: number[]): Buffer {
  const message = Buffer.alloc(14 + n * item.length);
  message.set([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  message.writeUInt32LE(n, 10);
  for (let i = 0; i < n; i++) {
    message.set(item, 14 + i * item.length);
  }
  return sized(message);
}

function over(pattern: RegExp) {
  return (error: unknown) =>
    error instanceof OverBudget && pattern.test(error.message);
}

suite("budget", () => {
  test("no budget, no limit", () => {
    assert.strictEqual(decode(atoms(1000)).type, 0);
  });

  test("a general list of atoms costs more than its bytes on the wire", () => {
    // 1,000 chars are about 1 KB either way on the wire
    assert.strictEqual(decode(chars(1000), 20_000).type, 10);
    assert.throws(
      () => decode(atoms(1000), 20_000),
      over(/^the result is over the 20 KB limit once decoded$/),
    );
  });

  test("every value counts, whatever its type", () => {
    // What {x;} each til n returns: n of ::, two bytes each on the wire
    assert.throws(() => decode(list(1000, [0x65, 0]), 20_000), over(/decoded/));
  });

  test("a GUID atom counts its buffer", () => {
    const guid = [0xfe, ...new Array(16).fill(0)];
    assert.strictEqual(decode(list(50, guid), 20_000).type, 0);
    assert.throws(() => decode(list(100, guid), 20_000), over(/decoded/));
  });

  test("a table's column names count before they're made", () => {
    // A table on the server's disk, with 1,000 one-letter names
    const names = Buffer.alloc(1000 * 2);
    for (let i = 0; i < 1000; i++) {
      names.set([97, 0], 2 * i);
    }
    const head = Buffer.of(
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      98,
      0,
      99,
      11,
      0,
      0,
      0,
      0,
      0,
    );
    head.writeUInt32LE(1000, 13);
    const message = sized(
      Buffer.concat([head, names, Buffer.from([0xf5, ...Buffer.from("t"), 0])]),
    );
    assert.strictEqual(decode(message).type, 98);
    assert.throws(() => decode(message, 20_000), over(/decoded/));
  });

  test("a compressed result is refused before it's uncompressed", () => {
    const fixture = fixtures.find((f) => f.name === ".corpus.large.longs");
    assert.ok(fixture?.compressed);
    const message = Buffer.from(fixture.compressed, "hex");
    const uncompressed = message.readUInt32LE(8);
    assert.throws(
      () => decode(message, uncompressed - 1),
      (error) =>
        error instanceof OverBudget &&
        error.size === uncompressed &&
        /uncompressed, over the/.test(error.message),
    );
  });

  test("a vector that claims more than the message holds is badmsg", () => {
    // A billion longs, in a message of 14 bytes
    const message = sized(
      Buffer.of(1, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0xca, 0x9a, 0x3b),
    );
    assert.throws(() => decode(message, 1000), { message: "badmsg" });
  });

  test("sizes in the largest unit that keeps them at 1 or more", () => {
    assert.strictEqual(bytes(999), "999 bytes");
    assert.strictEqual(bytes(1000), "1 KB");
    assert.strictEqual(bytes(1_500_000), "1.5 MB");
    assert.strictEqual(bytes(1e9), "1 GB");
    assert.strictEqual(bytes(2_345_678_901), "2.3 GB");
  });
});
