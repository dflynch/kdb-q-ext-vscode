import * as assert from "node:assert";
import { defaultSize } from "../format/console";
import { QError } from "../protection";
import { sizeSetting, toView } from "../result";

const message = Uint8Array.of(1, 2, 0, 0, 10, 0, 0, 0, 101, 0);

suite("result", () => {
  test("a response goes to the view as it arrived, with the console size", () => {
    const size = { ...defaultSize, lines: 25, width: 80 };
    assert.deepStrictEqual(
      toView({ result: { message, wrapped: true, roundtrip: 0 } }, size),
      { type: "result", message, wrapped: true, size },
    );
  });

  test("an error of ours after a ', with any hint on the line after it", () => {
    assert.deepStrictEqual(
      toView({ error: new Error("result too big") }, defaultSize),
      { type: "error", text: "'result too big" },
    );
    const hinted = new QError("access", { hint: "a hint" });
    assert.deepStrictEqual(toView({ error: hinted }, defaultSize), {
      type: "error",
      text: "'access\na hint",
    });
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
