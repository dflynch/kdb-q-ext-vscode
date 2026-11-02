import * as assert from "node:assert";
import { defaultSize } from "../format/console";
import { QError } from "../protection";
import {
  precisionSetting,
  rowLimitSetting,
  sizeSetting,
  toView,
} from "../result";

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
      toView({ error: new Error("query cancelled") }, defaultSize),
      { type: "error", text: "'query cancelled" },
    );
    const hinted = new QError("access", { hint: "a hint" });
    assert.deepStrictEqual(toView({ error: hinted }, defaultSize), {
      type: "error",
      text: "'access\na hint",
    });
  });

  test("the row limit is a whole number from 1", () => {
    assert.strictEqual(rowLimitSetting(undefined), 5_000_000);
    assert.strictEqual(rowLimitSetting(10), 10);
    for (const wrong of [0, -1, 2.5, "10"]) {
      assert.throws(() => rowLimitSetting(wrong), {
        message: "invalid rowLimit setting: not a whole number from 1",
      });
    }
  });

  test("the console size is lines then width, each from 10 to 2000", () => {
    assert.deepStrictEqual(sizeSetting(undefined), defaultSize);
    assert.deepStrictEqual(sizeSetting([25, 80]), {
      ...defaultSize,
      lines: 25,
      width: 80,
    });
    for (const wrong of [[9, 80], [25, 2001], [25], [25, 80.5], "25 80"]) {
      assert.throws(
        () => sizeSetting(wrong),
        {
          message:
            "invalid consoleSize setting: not two whole numbers from 10 to 2000",
        },
        JSON.stringify(wrong),
      );
    }
  });

  test("the precision is a whole number from 0 to 17, as q's \\P", () => {
    assert.strictEqual(precisionSetting(undefined), 7);
    assert.strictEqual(precisionSetting(0), 0);
    assert.strictEqual(precisionSetting(17), 17);
    for (const wrong of [-1, 18, 2.5, "7"]) {
      assert.throws(
        () => precisionSetting(wrong),
        {
          message: "invalid precision setting: not a whole number from 0 to 17",
        },
        JSON.stringify(wrong),
      );
    }
  });
});
