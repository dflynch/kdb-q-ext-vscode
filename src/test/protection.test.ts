import * as assert from "node:assert";
import { type Hinted, QError, reply } from "../protection";

// q's -8! of each value, as a hex string
const bytes = (hex: string) => Buffer.from(hex, "hex");
// 42
const long = bytes("0100000011000000f92a00000000000000");
// 'type, as a server signals it
const signalled = bytes("010000000e000000807479706500");

const unrecognised = (error: unknown) =>
  error instanceof Error &&
  error.message === "unrecognised response" &&
  /turn off protect/.test(String((error as Hinted).hint));

suite("protected evaluation", () => {
  test("not protected, the value, with no server time", () => {
    assert.deepStrictEqual(reply(long, false), {
      value: { type: -7, value: 42n },
    });
  });

  test("not protected, an error signalled is q's text", () => {
    assert.throws(
      () => reply(signalled, false),
      (error) =>
        error instanceof QError &&
        error.message === "type" &&
        error.hint === undefined,
    );
  });

  test("the result, and how long the server took", () => {
    // ``result`elapsed!(::;42;7)
    const message = bytes(
      "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f90700000000000000",
    );
    assert.deepStrictEqual(reply(message, true), {
      value: { type: -7, value: 42n },
      execution: 7,
    });
  });

  test("an error caught is q's text, with the backtrace and the server's time", () => {
    // ``error`backtrace`elapsed!(::;"type";"  [0]  1+`a\n        ^\n";3)
    const message = bytes(
      "010000005f000000630b0004000000006572726f72006261636b747261636500656c61707365640000000400000065000a0004000000747970650a001600000020205b305d2020312b60610a20202020202020205e0af90300000000000000",
    );
    assert.throws(
      () => reply(message, true),
      (error) =>
        error instanceof QError &&
        error.message === "type" &&
        error.backtrace === "  [0]  1+`a\n        ^\n" &&
        error.execution === 3,
    );
  });

  test("an error signalled says how to turn it off", () => {
    assert.throws(
      () => reply(signalled, true),
      (error) =>
        error instanceof QError &&
        error.message === "type" &&
        error.backtrace === undefined &&
        /turn off protect/.test(String(error.hint)),
    );
  });

  test("a reply that isn't its dictionary says how to turn it off", () => {
    for (const message of [
      long,
      // ``error`backtrace`elapsed!(::;`type;"bt";3), where the error
      // should be a string
      bytes(
        "0100000047000000630b0004000000006572726f72006261636b747261636500656c6170736564000000040000006500f574797065000a00020000006274f90300000000000000",
      ),
      // ``result!(::;42), with no elapsed time
      bytes(
        "0100000028000000630b000200000000726573756c74000000020000006500f92a00000000000000",
      ),
      // ``result`elapsed!(::;42;0D00:00:01), where the time should be a
      // long
      bytes(
        "0100000039000000630b000300000000726573756c7400656c6170736564000000030000006500f92a00000000000000f000ca9a3b00000000",
      ),
    ]) {
      assert.throws(() => reply(message, true), unrecognised);
    }
  });

  test("a name it doesn't know is ignored", () => {
    // ``result`elapsed`later!(::;42;7;1b)
    const message = bytes(
      "0100000041000000630b000400000000726573756c7400656c6170736564006c61746572000000040000006500f92a00000000000000f90700000000000000ff01",
    );
    assert.deepStrictEqual(reply(message, true), {
      value: { type: -7, value: 42n },
      execution: 7,
    });
  });

  test("a message that can't be decoded throws the decoder's error", () => {
    assert.throws(() => reply(long.subarray(0, 12), true), {
      message: "badmsg",
    });
  });
});
