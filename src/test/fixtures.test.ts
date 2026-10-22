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
}

// The header of a q IPC message from -8!: little-endian, async, the
// compression flag, then the message's length
function parse(name: string, hex: string, compressed: boolean) {
  const message = Buffer.from(hex, "hex");
  assert.strictEqual(message.toString("hex"), hex, `${name}: not hex`);
  assert.strictEqual(message[0], 1, `${name}: not little-endian`);
  assert.strictEqual(message[1], 0, `${name}: not async`);
  assert.strictEqual(message[2], compressed ? 1 : 0, `${name}: compression`);
  assert.strictEqual(message[3], 0, `${name}: reserved byte`);
  assert.strictEqual(message.readUInt32LE(4), message.length, `${name}: size`);
  return message;
}

async function md5(file: string) {
  const text = await readFile(path.join(fixtures, file));
  return createHash("md5").update(text).digest("hex");
}

suite("corpus fixtures", () => {
  let corpus: string;
  let ipc: { corpus: string; script: string; values: Fixture[] };

  suiteSetup(async () => {
    corpus = await readFile(path.join(fixtures, "corpus.q"), "utf8");
    ipc = JSON.parse(
      await readFile(path.join(fixtures, "corpus.ipc.json"), "utf8"),
    );
  });

  test("were written from the current corpus and script", async () => {
    const stale = "changed: run npm run fixtures (needs q)";
    assert.strictEqual(ipc.corpus, await md5("corpus.q"), `corpus.q ${stale}`);
    assert.strictEqual(
      ipc.script,
      await md5("fixtures.q"),
      `fixtures.q ${stale}`,
    );
  });

  test("hold every value assigned in the corpus, once", () => {
    const names = ipc.values.map((value) => value.name);
    assert.strictEqual(new Set(names).size, names.length, "duplicate names");
    // Assignments at column 0 under \d .corpus, such as atom.int:42i
    const assigned = [...corpus.matchAll(/^([a-z]\w*\.\w+):/gm)];
    assert.ok(assigned.length > 0);
    for (const [, name] of assigned) {
      assert.ok(names.includes(`.corpus.${name}`), `missing .corpus.${name}`);
    }
  });

  test("have well-formed messages", () => {
    for (const value of ipc.values) {
      const message = parse(value.name, value.bytes, false);
      // A sorted dictionary or keyed table is type 99 in q, 127 on the wire
      const wire = message.readInt8(8);
      assert.ok(
        wire === value.type || (wire === 127 && value.type === 99),
        `${value.name}: type ${value.type} but ${wire} on the wire`,
      );
      if (value.compressed !== undefined) {
        const compressed = parse(value.name, value.compressed, true);
        assert.ok(compressed.length < message.length);
        assert.strictEqual(
          compressed.readUInt32LE(8),
          message.length,
          `${value.name}: uncompressed size`,
        );
      }
    }
  });
});
