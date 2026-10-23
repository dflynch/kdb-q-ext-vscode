import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import type { Value, Vector } from "../codec/types";
import { show } from "../format/console";

// q's text for each value, and the size .Q.s shows it at
const { size, values: fixtures } = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
    "utf8",
  ),
) as {
  size: [number, number];
  values: { name: string; type: number; bytes: string; console: string }[];
};

function value(name: string): Value {
  const fixture = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(fixture, `no fixture .corpus.${name}`);
  return decode(Buffer.from(fixture.bytes, "hex"));
}

const longs = (n: number): Vector => ({
  type: 7,
  attribute: 0,
  data: BigInt64Array.from({ length: n }, (_, i) => BigInt(i)),
});

suite("console text", () => {
  // At the size q showed them, so the widest values are cut as q cuts them
  const [lines, width] = size;
  for (const f of fixtures) {
    test(`${f.name} as q shows it`, () => {
      // q ends the last line with a newline
      const want = f.console.replace(/\n$/, "");
      const value = decode(Buffer.from(f.bytes, "hex"));
      assert.strictEqual(show(value, { lines, width }), want);
    });
  }

  // ,0 then 0 1 and so on, a line each
  const ragged: Value = {
    type: 0,
    attribute: 0,
    items: [1, 2, 3, 4].map((n) => longs(n)),
  };

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
    assert.strictEqual(show(ragged, { lines: 3, width: 80 }), ",0\n0 1\n..");
    assert.strictEqual(
      show(ragged, { lines: 4, width: 80 }),
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

  test("a projection is cut like any other value, quickly", () => {
    const projection: Value = {
      type: 104,
      parts: [{ type: 100, context: "", source: "{x+y}" }, longs(10_000_000)],
    };
    const start = performance.now();
    const text = show(projection);
    assert.ok(performance.now() - start < 100);
    assert.strictEqual(text.length, 5000);
    assert.ok(text.startsWith("{x+y}[0 1 2 "));
    assert.ok(text.endsWith(".."));
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

  // A table of columns c0, c1 and so on, each the longs 0 to rows - 1
  const table = (columns: number, rows: number): Value => {
    const column = longs(rows);
    return {
      type: 98,
      attribute: 0,
      columns: Array.from({ length: columns }, (_, i) => `c${i}`),
      data: Array.from({ length: columns }, () => column),
    };
  };

  test("a table's rows past the limit become .., its header counted", () => {
    assert.deepStrictEqual(
      show(table(2, 10), { lines: 5, width: 80 }).split("\n"),
      ["c0 c1", "-----", "0  0 ", "1  1 ", ".."],
    );
  });

  test("a table's columns stop at the width", () => {
    assert.deepStrictEqual(
      show(table(1000, 2), { lines: 10, width: 12 }).split("\n"),
      ["c0 c1 c2 c..", "----------..", "0  0  0  0..", "1  1  1  1.."],
    );
  });

  test("a large table shows only what fits, quickly", () => {
    const large = table(10, 10_000_000);
    const start = performance.now();
    const lines = show(large).split("\n");
    assert.strictEqual(lines.length, 5000);
    assert.strictEqual(lines.at(-1), "..");
    assert.ok(performance.now() - start < 1000);
  });

  test("lines past the characters in all become ..", () => {
    // ,0 and 0 1 with their newlines are 7
    assert.strictEqual(
      show(ragged, { lines: 10, width: 80, characters: 8 }),
      ",0\n0 1\n..",
    );
  });

  test("a large matrix stops at a million characters", () => {
    const row = longs(5000);
    const rows: Value = {
      type: 0,
      attribute: 0,
      items: Array.from({ length: 6000 }, () => row),
    };
    const start = performance.now();
    const text = show(rows);
    assert.ok(text.length <= 1_000_002);
    assert.ok(text.endsWith("\n.."));
    assert.ok(performance.now() - start < 2000);
  });

  test("an error shows as q signals it", () => {
    assert.strictEqual(show({ type: -128, message: "type" }), "'type");
  });
});
