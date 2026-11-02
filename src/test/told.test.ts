import * as assert from "node:assert";
import { Told } from "../told";

suite("told", () => {
  test("a problem's told when it's first found, not again", () => {
    const told = new Told();
    assert.deepStrictEqual(told.news("servers", ["a", "b"]), ["a", "b"]);
    assert.deepStrictEqual(told.news("servers", ["a", "b"]), []);
  });

  test("only a new problem's told, and none when one's fixed", () => {
    const told = new Told();
    told.news("servers", ["a"]);
    assert.deepStrictEqual(told.news("servers", ["a", "b"]), ["b"]);
    assert.deepStrictEqual(told.news("servers", ["b"]), []);
  });

  test("a problem fixed is told again if it comes back", () => {
    const told = new Told();
    told.news("servers", ["a"]);
    told.news("servers", []);
    assert.deepStrictEqual(told.news("servers", ["a"]), ["a"]);
  });

  test("each setting's problems are its own", () => {
    const told = new Told();
    told.news("precision", ["wrong"]);
    assert.deepStrictEqual(told.news("rowLimit", ["wrong"]), ["wrong"]);
  });
});
