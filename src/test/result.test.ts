import * as assert from "node:assert";
import { QError } from "../connection";
import { defaultSize } from "../format/console";
import { sizeSetting, timing, toView } from "../result";

const message = Uint8Array.of(1, 2, 0, 0, 10, 0, 0, 0, 101, 0);

suite("result", () => {
  test("a result goes to the view undecoded, with the console size", () => {
    const size = { ...defaultSize, lines: 25, width: 80 };
    assert.deepStrictEqual(
      toView({ result: { message, timing: { roundtrip: 0 } } }, size),
      { type: "result", message, size },
    );
  });

  test("an error after a ', with its backtrace", () => {
    const error = new QError(
      "type",
      { roundtrip: 1, execution: 0 },
      "  [0]  1+`a\n        ^\n",
    );
    assert.deepStrictEqual(toView({ error }, defaultSize), {
      type: "error",
      text: "'type\n  [0]  1+`a\n        ^",
    });
  });

  test("an error's hint on the line after it", () => {
    const error = new QError("type", { roundtrip: 1 }, undefined, "a hint");
    assert.deepStrictEqual(toView({ error }, defaultSize), {
      type: "error",
      text: "'type\na hint",
    });
  });

  test("an error of ours, the same way", () => {
    assert.deepStrictEqual(
      toView({ error: new Error("result too big") }, defaultSize),
      { type: "error", text: "'result too big" },
    );
  });

  test("a result and a q error have a timing, and an error of ours none", () => {
    const took = { roundtrip: 3, execution: 2 };
    assert.strictEqual(timing({ result: { message, timing: took } }), took);
    assert.strictEqual(timing({ error: new QError("type", took) }), took);
    assert.strictEqual(
      timing({ error: new Error("connection closed unexpectedly") }),
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
