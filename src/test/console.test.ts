import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import type { Value } from "../codec/types";
import { show } from "../format/console";

const fixtures: {
  name: string;
  type: number;
  bytes: string;
  console: string;
}[] = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
    "utf8",
  ),
).values;

function value(name: string): Value {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture, `no fixture .corpus.${name}`);
  return decode(Buffer.from(fixture.bytes, "hex"));
}

const longs = (n: number): Value => ({
  type: 7,
  attribute: 0,
  data: BigInt64Array.from({ length: n }, (_, i) => BigInt(i)),
});

suite("console text", () => {
  // Tables and dictionaries go to the grid, and q cuts the widest values at
  // its own limit of 2000 characters, below ours
  const cut = (text: string) => text.split("\n").some((l) => l.length >= 1999);
  for (const f of fixtures.filter(
    (f) => f.type !== 98 && f.type !== 99 && !cut(f.console),
  )) {
    test(`${f.name} as q shows it`, () => {
      // q ends the last line with a newline
      const want = f.console.replace(/\n$/, "");
      assert.strictEqual(show(decode(Buffer.from(f.bytes, "hex"))), want);
    });
  }

  test("a line wider than the width ends in ..", () => {
    assert.strictEqual(
      show(longs(20), { lines: 10, width: 12 }),
      "0 1 2 3 4 ..",
    );
  });

  test("a line exactly as wide as the width isn't cut", () => {
    assert.strictEqual(show(longs(6), { lines: 10, width: 11 }), "0 1 2 3 4 5");
  });

  test("lines past the limit become ..", () => {
    const rows: Value = {
      type: 0,
      attribute: 0,
      items: [1, 2, 3, 4].map((n) => longs(n)),
    };
    assert.strictEqual(show(rows, { lines: 3, width: 80 }), ",0\n0 1\n..");
    assert.strictEqual(
      show(rows, { lines: 4, width: 80 }),
      ",0\n0 1\n0 1 2\n0 1 2 3",
    );
  });

  test("a matrix's columns stop at the width", () => {
    const rows: Value = {
      type: 0,
      attribute: 0,
      items: [longs(1000), longs(1000)],
    };
    assert.deepStrictEqual(show(rows, { lines: 10, width: 10 }).split("\n"), [
      "0 1 2 3 ..",
      "0 1 2 3 ..",
    ]);
  });

  test("a lambda is cut like any other value", () => {
    const source = `{[x] ${"x+".repeat(5000)}1}`;
    assert.strictEqual(
      show({ type: 100, context: "", source }, { lines: 10, width: 10 }),
      "{[x] x+x..",
    );
  });

  test("a projection is cut like any other value", () => {
    const projection: Value = {
      type: 104,
      parts: [{ type: 100, context: "", source: "{x+y}" }, longs(1000)],
    };
    assert.strictEqual(
      show(projection, { lines: 10, width: 12 }),
      "{x+y}[0 1 ..",
    );
  });

  test("a multi-line lambda's lines count against the limit", () => {
    assert.strictEqual(
      show(value("fn.multiLine"), { lines: 3, width: 10 }),
      ["{[t;n]", "  r:sele..", ".."].join("\n"),
    );
  });

  test("a large vector by default shows 5000 characters", () => {
    const text = show(longs(10_000_000));
    assert.strictEqual(text.length, 5000);
    assert.ok(text.endsWith(".."));
  });

  test("an error shows as q signals it", () => {
    assert.strictEqual(show({ type: -128, message: "type" }), "'type");
  });
});
