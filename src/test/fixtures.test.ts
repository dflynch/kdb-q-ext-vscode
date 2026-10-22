import * as assert from "node:assert";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

const fixtures = path.join(__dirname, "../../test/fixtures");

interface Fixture {
  name: string;
  type: number;
  bytes: string;
  compressed?: string;
  show: string;
}

// The header of a q IPC message: little-endian, compression flag, length
function assertHeader(name: string, hex: string, compressed: boolean) {
  const message = Buffer.from(hex, "hex");
  assert.strictEqual(message.toString("hex"), hex, `${name}: not hex`);
  assert.strictEqual(message[0], 1, `${name}: not little-endian`);
  assert.strictEqual(message[2], compressed ? 1 : 0, `${name}: compression`);
  assert.strictEqual(message.readUInt32LE(4), message.length, `${name}: size`);
}

suite("corpus fixtures", () => {
  let corpus: Buffer;
  let ipc: { corpus: string; values: Fixture[] };

  suiteSetup(async () => {
    corpus = await readFile(path.join(fixtures, "corpus.q"));
    ipc = JSON.parse(
      await readFile(path.join(fixtures, "corpus.ipc.json"), "utf8"),
    );
  });

  test("were written from the current corpus", () => {
    assert.strictEqual(
      ipc.corpus,
      createHash("md5").update(corpus).digest("hex"),
      "corpus.q changed: run npm run fixtures (needs q)",
    );
  });

  test("have well-formed messages", () => {
    assert.ok(ipc.values.length > 0);
    for (const value of ipc.values) {
      assertHeader(value.name, value.bytes, false);
      if (value.compressed !== undefined) {
        assertHeader(value.name, value.compressed, true);
        assert.ok(value.compressed.length < value.bytes.length);
      }
    }
  });
});
