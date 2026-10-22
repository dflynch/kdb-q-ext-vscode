import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { decompress } from "../codec/decompress";

// The corpus values q compresses, with -18!
const fixtures: { name: string; bytes: string; compressed?: string }[] =
  JSON.parse(
    readFileSync(
      path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
      "utf8",
    ),
  ).values.filter((f: { compressed?: string }) => f.compressed !== undefined);

function compressed(name: string): Buffer {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture?.compressed, `no compressed fixture .corpus.${name}`);
  return Buffer.from(fixture.compressed, "hex");
}

// A message with its header's length set to match
function sized(message: Buffer): Buffer {
  message.writeUInt32LE(message.length, 4);
  return message;
}

suite("decompress", () => {
  test("every compressed value in the corpus", () => {
    assert.ok(fixtures.length > 0);
    for (const fixture of fixtures) {
      const message = Buffer.from(fixture.compressed ?? "", "hex");
      assert.strictEqual(
        Buffer.from(decompress(message)).toString("hex"),
        fixture.bytes,
        fixture.name,
      );
      assert.deepStrictEqual(
        decode(message),
        decode(Buffer.from(fixture.bytes, "hex")),
        fixture.name,
      );
    }
  });

  suite("rejects", () => {
    test("a message too short for its length", () => {
      assert.throws(
        () => decompress(Uint8Array.of(1, 0, 1, 0, 11, 0, 0, 0, 0, 0, 0)),
        /ends early/,
      );
    });
    test("data that ends early", () => {
      const message = sized(compressed("large.longs").subarray(0, -1));
      assert.throws(() => decode(message), /malformed/);
    });
    test("data left over", () => {
      const message = sized(
        Buffer.concat([compressed("large.longs"), Buffer.of(0)]),
      );
      assert.throws(() => decode(message), /malformed/);
    });
    test("a length the data doesn't fill", () => {
      const message = compressed("large.longs");
      message.writeUInt32LE(message.readUInt32LE(8) + 1, 8);
      assert.throws(() => decode(message), /malformed/);
    });
    test("a length the data overruns", () => {
      const message = compressed("large.longs");
      message.writeUInt32LE(message.readUInt32LE(8) - 1, 8);
      assert.throws(() => decode(message), /malformed/);
    });
  });
});
