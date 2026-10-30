import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { decode } from "../codec/decode";
import { Attribute, type Value } from "../codec/types";
import { defaultSize, type Size } from "../format/console";
import { present, presented } from "../webview/present";

// q's -8! of til n
function til(n: number): Uint8Array {
  const message = new Uint8Array(14 + 8 * n);
  const view = new DataView(message.buffer);
  message.set([1, 0, 0, 0, 0, 0, 0, 0, 7]);
  view.setUint32(4, message.length, true);
  view.setUint32(10, n, true);
  for (let i = 0; i < n; i++) {
    view.setBigInt64(14 + 8 * i, BigInt(i), true);
  }
  return message;
}

const bytes = (hex: string) => Buffer.from(hex, "hex");

const { values: fixtures } = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../test/fixtures/corpus.ipc.json"),
    "utf8",
  ),
) as { values: { name: string; bytes: string }[] };

function fixture(name: string): Value {
  const found = fixtures.find((f) => f.name === `.corpus.${name}`);
  assert.ok(found, `no fixture .corpus.${name}`);
  return decode(bytes(found.bytes));
}

// A response as the extension posts it
const result = (
  message: Uint8Array,
  wrapped = false,
  size: Size = defaultSize,
) => ({ type: "result" as const, message, wrapped, size });

suite("the Console view", () => {
  test("til makes what q's -8! does", () => {
    assert.strictEqual(
      Buffer.from(til(3)).toString("hex"),
      "0100000026000000070003000000000000000000000001000000000000000200000000000000",
    );
  });

  test("a result as the q console shows it", () => {
    const { text, sheet } = present(result(til(3)));
    assert.strictEqual(text, "0 1 2");
    // A list shows in the Grid too, an item to a row
    assert.strictEqual(sheet?.rows, 3);
  });

  test(":: shows nothing, as an assignment's result", () => {
    const message = Uint8Array.of(1, 0, 0, 0, 10, 0, 0, 0, 101, 0);
    assert.deepStrictEqual(present(result(message)), { text: "" });
  });

  test("the result cut at the console size", () => {
    assert.strictEqual(
      present(result(til(100), false, { lines: 10, width: 10, precision: 7 }))
        .text,
      "0 1 2 3 ..",
    );
  });

  test("protected, the result and how long the server took", () => {
    // ``result`elapsed!(::;42;7)
    const message = bytes(
      "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f90700000000000000",
    );
    assert.deepStrictEqual(present(result(message, true)), {
      text: "42",
      execution: 7,
    });
  });

  test("protected, an error after a ', with its backtrace and the server's time", () => {
    // ``error`backtrace`elapsed!(::;"type";"  [0]  1+`a\n        ^\n";3)
    const message = bytes(
      "010000005f000000630b0004000000006572726f72006261636b747261636500656c61707365640000000400000065000a0004000000747970650a001600000020205b305d2020312b60610a20202020202020205e0af90300000000000000",
    );
    assert.deepStrictEqual(present(result(message, true)), {
      text: "'type\n  [0]  1+`a\n        ^",
      execution: 3,
    });
  });

  test("an error signalled under protection, with its hint on the line after", () => {
    const signalled = bytes("010000000e000000807479706500");
    assert.deepStrictEqual(present(result(signalled, true)), {
      text: "'type\nprotected evaluation may have been refused: turn off protect when the server enforces an allowlist",
    });
  });

  test("a result of more rows than the row limit is refused, and one at it shown", () => {
    const limited = { ...defaultSize, rowLimit: 3 };
    assert.deepStrictEqual(present(result(til(4), false, limited)), {
      text: "'row limit: the result exceeds 3 rows",
    });
    assert.strictEqual(present(result(til(3), false, limited)).sheet?.rows, 3);
    // A cell's value drilled into too, and an atom, which has no rows
    const longs: Value = {
      type: 7,
      attribute: Attribute.None,
      data: BigInt64Array.of(1n, 2n, 3n, 4n),
    };
    assert.deepStrictEqual(presented(longs, limited), {
      text: "'row limit: the result exceeds 3 rows",
    });
    assert.strictEqual(presented({ type: -7, value: 5n }, limited).text, "5");
    // A keyed table's rows, or a dictionary's, are its keys'
    const one = { ...defaultSize, rowLimit: 1 };
    for (const name of ["table.multiKeyed", "dict.simple"]) {
      assert.deepStrictEqual(presented(fixture(name), one), {
        text: "'row limit: the result exceeds 1 rows",
      });
      assert.ok(presented(fixture(name), { ...one, rowLimit: 3 }).sheet);
    }
  });

  test("a result that can't be decoded shows the decoder's error", () => {
    assert.deepStrictEqual(present(result(til(3).subarray(0, 20))), {
      text: "'badmsg",
    });
  });

  test("an error of the extension's, as it gave it", () => {
    assert.deepStrictEqual(
      present({ type: "error", text: "'query cancelled" }),
      { text: "'query cancelled" },
    );
  });
});
