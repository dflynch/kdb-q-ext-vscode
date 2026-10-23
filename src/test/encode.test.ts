import * as assert from "node:assert";
import { decode } from "../codec/decode";
import { encode } from "../codec/encode";

function hex(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}

// Each is q's -8! of the query, with the second byte set to 1 for a
// synchronous message
suite("encode", () => {
  test("a query", () => {
    assert.strictEqual(
      hex(encode("1+1")),
      "01010000110000000a0003000000312b31",
    );
  });
  test("an empty query", () => {
    assert.strictEqual(hex(encode("")), "010100000e0000000a0000000000");
  });
  test("a query with characters beyond ASCII, as UTF-8", () => {
    assert.strictEqual(hex(encode("`é")), "01010000110000000a000300000060c3a9");
  });
  test("a query with a wrapper, as a list of the wrapper as a lambda and the query", () => {
    assert.strictEqual(
      hex(encode("1+1", "{x}")),
      "010100002200000000000200000064000a00030000007b787d0a0003000000312b31",
    );
    assert.strictEqual(
      hex(encode("", "{x}")),
      "010100001f00000000000200000064000a00030000007b787d0a0000000000",
    );
  });
  test("decodes to the query's text", () => {
    const value = decode(encode("select from t where x>0"));
    assert.ok(value.type === 10);
    assert.strictEqual(
      Buffer.from(value.data).toString(),
      "select from t where x>0",
    );
  });
});
