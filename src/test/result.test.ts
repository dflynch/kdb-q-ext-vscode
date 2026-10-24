import * as assert from "node:assert";
import type { Value } from "../codec/types";
import { QError } from "../connection";
import { defaultSize } from "../format/console";
import { consoleText, sizeSetting, timing } from "../result";

const generic: Value = { type: 101, code: 0 };
const til = (n: number): Value => ({
  type: 7,
  attribute: 0,
  data: BigInt64Array.from({ length: n }, (_, i) => BigInt(i)),
});

suite("result", () => {
  test("a result as the q console shows it", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: til(3), timing: { roundtrip: 0 } } },
        defaultSize,
      ),
      "0 1 2",
    );
  });

  test(":: shows nothing, as an assignment's result", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: generic, timing: { roundtrip: 0 } } },
        defaultSize,
      ),
      "",
    );
  });

  test("an error after a ', with its backtrace", () => {
    const error = new QError(
      "type",
      { roundtrip: 1, execution: 0 },
      "  [0]  1+`a\n        ^\n",
    );
    assert.strictEqual(
      consoleText({ error }, defaultSize),
      "'type\n  [0]  1+`a\n        ^",
    );
  });

  test("an error of ours, the same way", () => {
    assert.strictEqual(
      consoleText({ error: new Error("the result is too big") }, defaultSize),
      "'the result is too big",
    );
  });

  test("the result cut at the console size", () => {
    assert.strictEqual(
      consoleText(
        { result: { value: til(100), timing: { roundtrip: 0 } } },
        { lines: 10, width: 10 },
      ),
      "0 1 2 3 ..",
    );
  });

  test("a result and a q error have a timing, and an error of ours none", () => {
    const took = { roundtrip: 3, execution: 2 };
    assert.strictEqual(
      timing({ result: { value: generic, timing: took } }),
      took,
    );
    assert.strictEqual(timing({ error: new QError("type", took) }), took);
    assert.strictEqual(
      timing({ error: new Error("the connection closed") }),
      undefined,
    );
  });

  test("the console size is lines then width, each from 10 to 2000", () => {
    assert.deepStrictEqual(sizeSetting(undefined), { size: defaultSize });
    assert.deepStrictEqual(sizeSetting([25, 80]), {
      size: { ...defaultSize, lines: 25, width: 80 },
    });
    for (const wrong of [[9, 80], [25, 2001], [25], [25, 80.5], "25 80"]) {
      assert.deepStrictEqual(
        sizeSetting(wrong),
        {
          size: defaultSize,
          problem: "the console size isn't two whole numbers from 10 to 2000",
        },
        JSON.stringify(wrong),
      );
    }
  });
});
