import * as assert from "node:assert";
import { decode } from "../codec/decode";
import { csv, tsv } from "../webview/delimited";
import { type Sheet, sheet } from "../webview/table";

// A sheet of a value from q's -8!
function sheetOf(hex: string): Sheet {
  const s = sheet(decode(Buffer.from(hex, "hex")), 7);
  assert.ok(s);
  return s;
}

// Every row and column, as they came
function all(s: Sheet): ReturnType<typeof csv> {
  return csv(
    s,
    Array.from({ length: s.rows }, (_, i) => i),
    s.columns.map((_, j) => j),
  );
}

suite("Export to CSV", () => {
  test("each type as q's csv 0: writes it", () => {
    // From q: a table of every type, a value then a null or an infinity
    // biome-ignore format: q's bytes
    const s = sheetOf("01000000780100006200630b0013000000620067007800680069006a00650066006300730070006d0064007a006e007500760074007374720000001300000001000200000001000200020000008c680a015a495aab5a65d4bfddb6a661000000000000000000000000000000000400020000000aff050002000000010000800600020000000100008000000080070002000000ffffffffffffff7f00000000000000800800020000000000c03f0000c07f090002000000b6f37d54346f9d41000000000000f87f0a000200000061200b0002000000616200000c00020000000180540abec5be0b00000000000000800d000200000041010000000000800e000200000043260000ffffff7f0f000200000000000000c021c340000000000000f87f10000200000004ae17d4620300000000000000000080110002000000ee02000000000080120002000000d7af000000000080130002000000002e9302000000800000020000000a0005000000636166c3a90a0000000000");
    // q's "\n" sv csv 0: of it
    assert.deepStrictEqual(all(s), {
      text: [
        "b,g,x,h,i,j,e,f,c,s,p,m,d,z,n,u,v,t,str",
        "1,8c680a01-5a49-5aab-5a65-d4bfddb6a661,0a,1,-0W,0W,1.5,1.234568e+08,a,ab,2026-10-26D12:00:00.000000001,2026-10,2026-10-26,2026-10-26 12:00:00.000,0D01:02:03.000000004,12:30,12:30:15,12:00:00.000,café",
        "0,00000000-0000-0000-0000-000000000000,ff,,,,,, ,,,,0W,,,,,,",
        "",
      ].join("\n"),
    });
  });

  test("a cell with a comma, a quote or a line break is quoted, as RFC 4180 has it", () => {
    // ([]s:`$("a,b";"x");str:("say \"hi\"";"two\nlines"))
    const s = sheetOf(
      "010000004c0000006200630b00020000007300737472000000020000000b0002000000612c620078000000020000000a000800000073617920226869220a000900000074776f0a6c696e6573",
    );
    assert.deepStrictEqual(all(s), {
      text: 's,str\n"a,b","say ""hi"""\nx,"two\nlines"\n',
    });
  });

  test("the rows and columns in the order given", () => {
    const s = sheetOf(
      "010000004c0000006200630b00020000007300737472000000020000000b0002000000612c620078000000020000000a000800000073617920226869220a000900000074776f0a6c696e6573",
    );
    assert.deepStrictEqual(csv(s, [1], [1, 0]), {
      text: 'str,s\n"two\nlines",x\n',
    });
    assert.deepStrictEqual(csv(s, [], [0]), { text: "s\n" });
  });

  test("a keyed table is flat, keys first", () => {
    // ([k:`a`b]n:1 2)
    const s = sheetOf(
      "010000004b000000636200630b00010000006b000000010000000b0002000000610062006200630b00010000006e0000000100000007000200000001000000000000000200000000000000",
    );
    assert.deepStrictEqual(all(s), { text: "k,n\na,1\nb,2\n" });
  });

  test("mixed lists aren't written, as q's csv 0: won't: their names instead", () => {
    // ([k:`a`b]n:(1 2;3 4);t:(([]a:1 2);([]a:enlist 3)))
    const s = sheetOf(
      "01000000b5000000636200630b00010000006b000000010000000b0002000000610062006200630b00020000006e00740000000200000000000200000007000200000001000000000000000200000000000000070002000000030000000000000004000000000000000000020000006200630b00010000006100000001000000070002000000010000000000000002000000000000006200630b000100000061000000010000000700010000000300000000000000",
    );
    assert.deepStrictEqual(all(s), { mixed: ["n", "t"] });
    // Only the columns shown count
    assert.deepStrictEqual(csv(s, [0, 1], [0]), { text: "k\na\nb\n" });
    assert.deepStrictEqual(csv(s, [0, 1], [2, 0]), { mixed: ["t"] });
    // (1 2;`a), a list as a value column
    const list = sheetOf(
      "010000002700000000000200000007000200000001000000000000000200000000000000f56100",
    );
    assert.deepStrictEqual(all(list), { mixed: ["value"] });
  });
});

suite("Copy", () => {
  // ([]s:`$("a,b";"x");str:("say \"hi\"";"two\nlines"))
  const quoted =
    "010000004c0000006200630b00020000007300737472000000020000000b0002000000612c620078000000020000000a000800000073617920226869220a000900000074776f0a6c696e6573";

  test("cells as CSV writes them, tab-separated, a line to a row and none after", () => {
    // ([k:`a`b]n:1 2)
    const s = sheetOf(
      "010000004b000000636200630b00010000006b000000010000000b0002000000610062006200630b00010000006e0000000100000007000200000001000000000000000200000000000000",
    );
    assert.deepStrictEqual(tsv(s, [0, 1], [0, 1], false), {
      text: "a\t1\nb\t2",
    });
    assert.deepStrictEqual(tsv(s, [1], [1], false), { text: "2" });
  });

  test("the header only when asked for", () => {
    const s = sheetOf(quoted);
    assert.deepStrictEqual(tsv(s, [1], [1, 0], true), {
      text: 'str\ts\n"two\nlines"\tx',
    });
  });

  test("a cell with a tab or a line break, or starting with a quote, is quoted, as a spreadsheet would read it otherwise", () => {
    const s = sheetOf(quoted);
    assert.deepStrictEqual(tsv(s, [0, 1], [0, 1], false), {
      text: 'a,b\tsay "hi"\nx\t"two\nlines"',
    });
    // ([]s:enlist`$"a\tb")
    const tab = sheetOf(
      "01000000230000006200630b000100000073000000010000000b000100000061096200",
    );
    assert.deepStrictEqual(tsv(tab, [0], [0], false), { text: '"a\tb"' });
    // ([]s:enlist`$"\"a\" b")
    const opening = sheetOf(
      "01000000250000006200630b000100000073000000010000000b0001000000226122206200",
    );
    assert.deepStrictEqual(tsv(opening, [0], [0], false), {
      text: '"""a"" b"',
    });
  });

  test("mixed lists aren't copied, as they aren't exported: their names instead", () => {
    // ([k:`a`b]n:(1 2;3 4);t:(([]a:1 2);([]a:enlist 3)))
    const s = sheetOf(
      "01000000b5000000636200630b00010000006b000000010000000b0002000000610062006200630b00020000006e00740000000200000000000200000007000200000001000000000000000200000000000000070002000000030000000000000004000000000000000000020000006200630b00010000006100000001000000070002000000010000000000000002000000000000006200630b000100000061000000010000000700010000000300000000000000",
    );
    assert.deepStrictEqual(tsv(s, [0, 1], [0, 1, 2], false), {
      mixed: ["n", "t"],
    });
    assert.deepStrictEqual(tsv(s, [0, 1], [0], true), { text: "k\na\nb" });
  });
});
