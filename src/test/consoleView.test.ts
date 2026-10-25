import * as assert from "node:assert";
import { defaultSize } from "../format/console";
import { consoleText } from "../webview/console";

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

suite("the Console view", () => {
  test("til makes what q's -8! does", () => {
    assert.strictEqual(
      Buffer.from(til(3)).toString("hex"),
      "0100000026000000070003000000000000000000000001000000000000000200000000000000",
    );
  });

  test("a result as the q console shows it", () => {
    assert.strictEqual(
      consoleText({ type: "result", message: til(3), size: defaultSize }),
      "0 1 2",
    );
  });

  test(":: shows nothing, as an assignment's result", () => {
    const message = Uint8Array.of(1, 0, 0, 0, 10, 0, 0, 0, 101, 0);
    assert.strictEqual(
      consoleText({ type: "result", message, size: defaultSize }),
      "",
    );
  });

  test("the result cut at the console size", () => {
    assert.strictEqual(
      consoleText({
        type: "result",
        message: til(100),
        size: { lines: 10, width: 10 },
      }),
      "0 1 2 3 ..",
    );
  });

  test("a result that can't be decoded shows the decoder's error", () => {
    const message = til(3).subarray(0, 20);
    assert.strictEqual(
      consoleText({ type: "result", message, size: defaultSize }),
      "'badmsg",
    );
  });

  test("an error as the extension gave it", () => {
    assert.strictEqual(
      consoleText({ type: "error", text: "'type\na hint" }),
      "'type\na hint",
    );
  });
});
