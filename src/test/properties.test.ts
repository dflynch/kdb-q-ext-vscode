// Rules that hold for any input, checked over random q: navigation never
// throws, a hover lists what Go to Definition does for a global, an export
// or a column that may be a global, an outline's spans nest, a call's
// signatures are its name's hover's; and the hover's entries from KX's
// reference cover q's keywords, each form of theirs a call
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
  signatures,
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
  "{[a:`j;b:a+] b}",
  "{[(a;b);([k;c:d])] a}",
  "{[a:f] a}",
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
      // Every definition in each file, as written, and whether it's a
      // module's own: in a file that assigns export before any \d, before
      // it, without a leading dot
      const own = (file: string, at: number, full: string) => {
        const t = files[file];
        const end = annotate(t).namespaces[0]?.at ?? t.length + 1;
        const module = globals(t, annotate(t)).some(
          (d) => d.full === "export" && d.nameSpan.start < end,
        );
        return module && at < end && !full.startsWith(".");
      };
      const every = Object.entries(files).flatMap(([file, t]) =>
        globals(t, annotate(t)).map((d) => ({
          ...d,
          file,
          own: own(file, d.nameSpan.start, d.full),
        })),
      );
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
        // A global, an export or a column that may be a global: what Go to
        // Definition finds, all of it, in its order
        const shown =
          /^(global|export) /.test(inside?.identity ?? "") ||
          inside?.maybe?.startsWith("global ");
        if (shown) {
          assert.deepStrictEqual(
            (found?.defined ?? []).map((d) => `${d.file} ${d.nameSpan.start}`),
            defs.map((d) => `${d.file} ${d.start}`),
            context,
          );
        }
        // A global, or a column that may be one: every definition of it in
        // each file it lists, at top level, or, if no file has one, in a
        // lambda, each file's together, the latest first, and every file
        // that has one; a module's own only in the module. Not one that
        // may be read through a module, as m.f
        const global = inside?.identity.startsWith("global ")
          ? inside.identity
          : inside?.identity.startsWith("column ")
            ? inside.maybe
            : undefined;
        const full = global?.slice(7) ?? "";
        const through = every.some(
          (d) => d.kind === "module" && full.startsWith(`${d.full}.`),
        );
        if (inside && global?.startsWith("global ") && !through) {
          const mine = own("/w/a.q", inside.start, full);
          const of = every.filter(
            (d) =>
              d.full === full && (mine ? d.own && d.file === "/w/a.q" : !d.own),
          );
          const top = of.filter((d) => !d.inLambda);
          const chosen = top.length ? top : of;
          const listed = found?.defined ?? [];
          const order = [...new Set(listed.map((d) => d.file))];
          assert.deepStrictEqual(
            [...order].sort(),
            [...new Set(chosen.map((d) => d.file))].sort(),
            context,
          );
          assert.deepStrictEqual(
            listed.map((d) => `${d.file} ${d.nameSpan.start}`),
            order.flatMap((f) =>
              chosen
                .filter((d) => d.file === f)
                .reverse()
                .map((d) => `${d.file} ${d.nameSpan.start}`),
            ),
            context,
          );
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
      }
    }
  });

  test("signatures are the innermost call's with any in the lambda, as its hover has them", () => {
    const random = randomly(3);
    for (let n = 0; n < 3000; n++) {
      const files: Record<string, string> = {
        "/w/a.q": written(random, 30),
        "/w/m.q": written(random, 20),
      };
      const index = new Map<string, Entry>(
        Object.entries(files).map(([f, t]) => [f, entry(t, annotate(t))]),
      );
      const text = files["/w/a.q"];
      const a = annotate(text);
      // Each call's labels: q's forms, then each definition the hover lists
      // that's a function, as the hover writes them
      const labels = a.calls.map((c) => {
        const h = hover(index, "/w/a.q", a, c.name.start);
        return [
          ...(h?.builtin?.forms ?? []),
          ...(h?.defined ?? [])
            .filter((d) => d.kind === "function")
            .map((d) => `${d.full}${d.detail}`),
        ];
      });
      for (let offset = -1; offset <= text.length + 1; offset++) {
        const context = JSON.stringify({ files, offset });
        const found = signatures(index, "/w/a.q", a, offset);
        // The innermost lambda around the offset, whose code is its own
        const lambda = a.lambdas
          .filter(
            (l) =>
              l.open.end <= offset &&
              offset <= (l.close?.start ?? Number.POSITIVE_INFINITY),
          )
          .at(-1);
        // The innermost call around the offset with any, inside that lambda
        let n = a.calls.length - 1;
        for (; n >= 0; n--) {
          const c = a.calls[n];
          const inside =
            c.open.end <= offset &&
            offset <= c.end &&
            (!lambda || c.open.start > lambda.open.start);
          if (inside && labels[n].length) break;
        }
        if (n < 0) {
          assert.strictEqual(found, undefined, context);
          continue;
        }
        const call = a.calls[n];
        assert.ok(found, context);
        assert.deepStrictEqual(
          found.signatures.map((s) => s.label),
          labels[n],
          context,
        );
        assert.strictEqual(
          found.active,
          call.separators.filter((t) => t.start < offset).length,
          context,
        );
        // Each parameter in its label's brackets, in order
        for (const s of found.signatures) {
          let last = s.label.indexOf("[") + 1;
          for (const [start, end] of s.params) {
            assert.ok(last <= start && start <= end, context);
            last = end;
          }
          assert.ok(last < s.label.length, context);
        }
      }
    }
  })
    // Many workspaces, not a measure of speed: CI's machines are slower
    .timeout(20000);

  test("every form of q's own is one call of its name, all of it", () => {
    for (const [name, b] of builtins) {
      for (const form of b.forms) {
        const { calls } = annotate(form);
        assert.strictEqual(calls.length, 1, form);
        const [call] = calls;
        assert.strictEqual(form.slice(0, call.name.end), name, form);
        assert.strictEqual(call.close?.end, form.length, form);
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
