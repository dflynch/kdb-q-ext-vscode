// Rules that hold for any input, checked over random q: navigation never
// throws, a hover lists what Go to Definition does, an outline's spans nest;
// and the hover's entries from KX's reference cover q's keywords
import * as assert from "node:assert";
import { annotate, keywords } from "../annotate";
import { builtins } from "../builtins";
import { globals, type Outlined, outline, targets } from "../navigation";
import {
  definitions,
  type Entry,
  entry,
  hover,
  references,
} from "../workspaceIndex";

// The same numbers on every run, from a seed
function randomly(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 16) % n;
  };
}

// Pieces of q: definitions in every form, modules and exports, lambdas,
// queries, comments, \d and every line ending
const pieces = [
  ..."fgx;:[]{}() `",
  "::",
  "\n",
  "\r\n",
  "\r",
  "1",
  "/ c\n",
  " / t",
  "/-\n",
  "/\n",
  "\\\n",
  "f:{x}",
  "f:g:",
  "`f set ",
  "set[`f;",
  "`.a.f set ",
  ".a.f",
  ".a.f:",
  "\\d .a\n",
  "\\d .\n",
  "s:use`m\n",
  "s.mid",
  "mid:{x}",
  "export:([mid:mid])",
  "export:.z.m",
  "{[a] a}",
  "update c:2 from t",
  "select a from t",
  "([k:1])",
  ".z.pg:",
  "count ",
  '"s"',
];

// A random file of up to the given number of pieces
const written = (random: (n: number) => number, most: number) =>
  Array.from(
    { length: random(most) },
    () => pieces[random(pieces.length)],
  ).join("");

suite("properties", () => {
  // For a global, hover() and definitions() read the same list, so this
  // tests an export's mapping, and what a hover shows at all
  test("a hover shows a name's definitions, each named where it is", () => {
    const random = randomly(1);
    for (let n = 0; n < 1500; n++) {
      const files: Record<string, string> = {
        "/w/a.q": written(random, 30),
        "/w/m.q": written(random, 20),
        "/w/b/m.q": written(random, 20),
      };
      const index = new Map<string, Entry>(
        Object.entries(files).map(([f, t]) => [f, entry(t, annotate(t))]),
      );
      const text = files["/w/a.q"];
      const a = annotate(text);
      const all = targets(a);
      for (let offset = -1; offset <= text.length + 1; offset++) {
        const context = JSON.stringify({ files, offset });
        const found = hover(index, "/w/a.q", a, offset);
        const defs = definitions(index, "/w/a.q", a, offset);
        references(index, "/w/a.q", a, offset, true);
        const inside = all.find((t) => t.start <= offset && offset < t.end);
        // Nothing but over a name
        if (!inside) assert.strictEqual(found, undefined, context);
        if (found) {
          // Over the name the offset is in, whole
          assert.deepStrictEqual(
            found.name,
            inside && { start: inside.start, end: inside.end },
            context,
          );
          // Go to Definition's locations, in its order
          assert.deepStrictEqual(
            found.defined.map((d) => `${d.file} ${d.nameSpan.start}`),
            defs.map((d) => `${d.file} ${d.start}`),
            context,
          );
          // Each one's name written where it says, as the last part of it
          for (const d of found.defined) {
            const written = files[d.file].slice(
              d.nameSpan.start,
              d.nameSpan.end,
            );
            const last = d.full.slice(d.full.lastIndexOf(".") + 1);
            assert.ok(
              written.endsWith(last),
              `${context} ${d.full} ${written}`,
            );
          }
        }
        // A global or an export Go to Definition finds has a hover
        if (/^(global|export) /.test(inside?.identity ?? "") && defs.length) {
          assert.ok(found?.defined.length, context);
        }
      }
    }
  })
    // Many workspaces, not a measure of speed: CI's machines are slower
    .timeout(20000);

  test("an outline's names are in their spans, its children in their parents", () => {
    const random = randomly(2);
    const nested = (
      items: Outlined[],
      within: { start: number; end: number },
    ) =>
      items.forEach((o, n) => {
        const context = JSON.stringify(o);
        assert.ok(within.start <= o.span.start, context);
        assert.ok(o.span.end <= within.end, context);
        assert.ok(o.span.start <= o.nameSpan.start, context);
        assert.ok(o.nameSpan.end <= o.span.end, context);
        // In order. Not always apart: g is in f's value in f:g:{x}, and
        // .z.pg starts a .z run inside h's in h:.z.pg:{x}, .z.ps:{x}
        assert.ok(n === 0 || items[n - 1].span.start <= o.span.start, context);
        nested(o.children ?? [], o.span);
      });
    for (let n = 0; n < 5000; n++) {
      const text = written(random, 40);
      const a = annotate(text);
      nested(outline(text, a), { start: 0, end: text.length });
      for (const d of globals(text, a)) {
        const context = JSON.stringify({ text, d });
        assert.ok(d.span.start <= d.nameSpan.start, context);
        assert.ok(d.nameSpan.end <= d.span.end, context);
        assert.notStrictEqual(d.doc, "", context);
      }
    }
  });

  test("every keyword q has an entry from KX's reference", () => {
    // ww is an internal of wj's, undocumented
    const missing = [...keywords].filter((k) => !builtins.has(k) && k !== "ww");
    assert.deepStrictEqual(missing, []);
  });

  test("every entry's syntax names it, and links to code.kx.com", () => {
    for (const [name, b] of builtins) {
      assert.ok(b.syntax.includes(name), name);
      assert.ok(b.summary.trim(), name);
      assert.match(b.url, /^https:\/\/code\.kx\.com\/q\/[\w/.-]+(#[\w-]+)?$/);
    }
  });
});
