// Navigation across the workspace's q files: what each file defines and
// uses, kept as an entry per file, and the definitions, references,
// symbols and signatures they give together. Each file is read as if loaded
// in the root, as \l runs a file in its loader's namespace, which the file
// can't show. Modules resolve by file name, as use`foo finds foo.q or
// foo/init.q in a directory of QPATH, which the workspace doesn't say. Pure
// and total, as the annotation pass is: no VS Code imports, never throws.

import { type Annotated, annotate } from "./annotate";
import { type Builtin, builtins } from "./builtins";
import { lineOf, lineStarts } from "./lines";
import {
  at,
  callsAt,
  type Defined,
  defining as definedInFile,
  firsts,
  globals,
  references as inFile,
  type Span,
  targets,
} from "./navigation";

export type Entry = {
  // Where each line starts, to turn offsets into positions
  lines: number[];
  // Each definition of a global, in the order they're written
  defined: Defined[];
  // Each global named, by its absolute name, assigned or read, and each
  // column that may be one; passed if named by a symbol
  globals: (Span & { full: string; passed: boolean })[];
  // Each export of a module named, as m.f where m:use`foo
  exports: (Span & { module: string; key: string })[];
  // The module's own export, if the file assigns one: its keys when it's a
  // dictionary literal, each where its value is defined in the file, as
  // a global's definitions, else the key itself, and, for a lambda written
  // in it, as ([f:{[a;b] a}]), its signature: each parameter as written
  export?: Span & {
    keys?: (Span & { key: string; values: Span[]; signature?: string[] })[];
  };
};

// A file's entry, from its text and annotations
export function entry(text: string, a: Annotated): Entry {
  const lines = lineStarts(text);
  const all = targets(a);
  const out: Entry = {
    lines,
    defined: globals(text, a, true),
    globals: [],
    exports: [],
  };
  for (const t of all) {
    const global = [t.identity, t.maybe].find((id) =>
      id?.startsWith("global "),
    );
    if (global) {
      out.globals.push({
        start: t.start,
        end: t.end,
        full: global.slice(7),
        passed: t.passed,
      });
    } else if (t.identity.startsWith("export ")) {
      const [, module, key] = t.identity.split(" ");
      out.exports.push({ start: t.start, end: t.end, module, key });
    }
  }
  if (a.export) {
    const { start, end } = a.export.at;
    out.export = { start, end };
    if (a.export.keys) {
      out.export.keys = a.export.keys.map((k) => {
        const span = { start: k.start, end: k.end };
        const target = k.target;
        const defs =
          target && "full" in target
            ? definedInFile(all, `global ${target.full}`).map(
                ({ start, end }) => ({ start, end }),
              )
            : [];
        return {
          key: k.key,
          ...span,
          values: defs.length ? defs : [span],
          ...(target && "lambda" in target
            ? { signature: target.lambda.signature }
            : {}),
        };
      });
    }
  }
  return out;
}

// A line and column from 0, as VS Code counts them
export function position(
  e: Entry,
  offset: number,
): { line: number; character: number } {
  const line = lineOf(e.lines, offset);
  return { line, character: offset - e.lines[line] };
}

// Files by their URI, as a string; the current file's entry must be fresh
export type Index = ReadonlyMap<string, Entry>;

export type Location = Span & { file: string };

// An occurrence, and whether it passes a global by reference
export type Reference = Location & { passed: boolean };

// The files a module named in use resolves to: foo.q or foo/init.q for
// use`foo, foo/bar.q or foo/bar/init.q for use`foo.bar, in any directory,
// the file before the directory's init as q looks. A relative use`.bar is
// below an init's directory, or else below the file as if a directory, as
// q looks
export function resolve(index: Index, from: string, module: string): string[] {
  const parts = module.split(".");
  if (parts.some((p, n) => p === "" && n > 0)) return [];
  const found = (path: string) => [`${path}.q`, `${path}/init.q`];
  if (module.startsWith(".")) {
    const base = /\/init\.q$/.test(from)
      ? from.slice(0, from.lastIndexOf("/"))
      : from;
    const [file, init] = found(`${base}/${parts.slice(1).join("/")}`);
    return index.has(file) ? [file] : index.has(init) ? [init] : [];
  }
  const [file, init] = found(`/${parts.join("/")}`);
  const out: string[] = [];
  for (const k of index.keys()) {
    if (k.endsWith(file)) out.push(k);
    else if (k.endsWith(init)) {
      const path = k.slice(0, -"/init.q".length);
      if (!index.has(`${path}.q`)) out.push(k);
    }
  }
  return out.sort();
}

// Nearest the file first: itself, then its directory, then by how many
// directories they share, then by path
function nearest(file: string): (x: string, y: string) => number {
  const directories = (f: string) => f.split("/").slice(0, -1);
  const mine = directories(file);
  const shared = (other: string) => {
    if (other === file) return Number.POSITIVE_INFINITY;
    const theirs = directories(other);
    let n = 0;
    while (n < mine.length && mine[n] === theirs[n]) n++;
    const same = n === mine.length && n === theirs.length;
    return 2 * n + (same ? 1 : 0);
  };
  return (x, y) => shared(y) - shared(x) || (x < y ? -1 : x > y ? 1 : 0);
}

// What the name at the offset is, across files: a global, by its absolute
// name; an export, by the modules it can be and its key, from a use of it or
// the key in the module's own export; or nothing, when it's only the file's
type Across =
  | { global: string }
  | { modules: string[]; key: string }
  | undefined;

function across(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
): Across {
  const here = at(targets(a), offset);
  const id = here?.identity;
  if (id?.startsWith("global ")) return { global: id.slice(7) };
  if (id?.startsWith("export ")) {
    const [, module, key] = id.split(" ");
    return { modules: resolve(index, file, module), key };
  }
  // The key the offset is in, else one it's just after, as at() has it
  const keys = index.get(file)?.export?.keys ?? [];
  const key =
    keys.find((k) => k.start <= offset && offset < k.end) ??
    keys.find((k) => k.end === offset);
  if (key) return { modules: [file], key: key.key };
  return undefined;
}

// Where the name at the offset is defined. A local or parameter as in the
// file. A global where each file assigns it at top level, or, if none does,
// in a lambda, the file itself first, then the nearest, and each file's the
// latest first. An export where its module's export has the key, or where
// the export is assigned if it's built as the module loads
export function definitions(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
): Location[] {
  const all = targets(a);
  const here = at(all, offset);
  if (!here) return [];
  const local = (id: string | undefined) =>
    id?.startsWith("variable ")
      ? definedInFile(all, id).map((d) => ({ file, ...span(d) }))
      : [];
  const found = local(here.identity);
  if (found.length) return found;
  const wanted = across(index, file, a, offset);
  if (wanted && "global" in wanted) return defining(index, file, wanted.global);
  if (wanted) {
    const out: Location[] = [];
    for (const m of wanted.modules) {
      const ex = index.get(m)?.export;
      if (!ex) continue;
      if (!ex.keys) out.push({ file: m, ...span(ex) });
      const k = ex.keys?.find((k) => k.key === wanted.key);
      for (const v of k?.values ?? []) out.push({ file: m, ...v });
    }
    return out;
  }
  // A column read, as the variable it may be
  const maybe = local(here.maybe);
  if (maybe.length) return maybe;
  return here.maybe?.startsWith("global ")
    ? defining(index, file, here.maybe.slice(7))
    : [];
}

// Where each file assigns a global at top level, or, if none does, in a
// lambda, the file itself first, then the nearest, each file's the latest
// first
function defining(index: Index, file: string, global: string): Location[] {
  return defined(index, file, global).map((d) => ({
    file: d.file,
    ...d.nameSpan,
  }));
}

// Each file's definitions of a global, as defining() orders them
function defined(index: Index, file: string, global: string): Listed[] {
  const atTop: Listed[] = [];
  const inLambda: Listed[] = [];
  for (const [f, e] of index) {
    for (const d of e.defined) {
      if (d.full === global)
        (d.inLambda ? inLambda : atTop).push({ ...d, file: f });
    }
  }
  const order = nearest(file);
  return (atTop.length ? atTop : inLambda).sort(
    (x, y) => order(x.file, y.file) || y.nameSpan.start - x.nameSpan.start,
  );
}

// What a hover over the offset says, and the name it's over: q's own entry
// for a keyword or a name in .Q, .z, .h or .j, and a global's or an export's
// definitions, as definitions() gives them, each the global defined there.
// An export's key whose value is written in the export, as ([f:{[a;b] a}]),
// as itself, a function if a lambda. A column read, as the global it may
// be. Nothing for a local, a parameter, another column, a key or anything
// but a name, as a glyph just after one
export function hover(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
): { name: Span; builtin?: Builtin; defined: Listed[] } | undefined {
  // The name the offset is in, not one it's just after: VS Code asks at the
  // start of the character under the mouse, which may be a glyph after it
  const here = targets(a).find((t) => t.start <= offset && offset < t.end);
  if (!here) return undefined;
  const name = span(here);
  if (here.identity.startsWith("builtin ")) {
    const builtin = builtins.get(here.identity.slice(8));
    return builtin && { name, builtin, defined: [] };
  }
  const ofGlobal = (global: string) => {
    // q's own, only in its namespaces: a keyword is never a global, and
    // from and by are qSQL's only in a query
    const builtin = /^\.[Qzhj]\./.test(global)
      ? builtins.get(global)
      : undefined;
    const found = defined(index, file, global);
    if (!builtin && !found.length) return undefined;
    return { name, ...(builtin ? { builtin } : {}), defined: found };
  };
  const wanted = across(index, file, a, offset);
  // A column read, as the global it may be, as definitions() takes it
  if (!wanted) {
    return here.maybe?.startsWith("global ")
      ? ofGlobal(here.maybe.slice(7))
      : undefined;
  }
  if ("global" in wanted) return ofGlobal(wanted.global);
  const found = definitions(index, file, a, offset).map((l): Listed => {
    const d = index
      .get(l.file)
      ?.defined.find((d) => d.nameSpan.start === l.start);
    if (d) return { ...d, file: l.file };
    const signature = index
      .get(l.file)
      ?.export?.keys?.find((k) => k.start === l.start)?.signature;
    return {
      full: wanted.key,
      ...(signature
        ? { kind: "function", detail: `[${signature.join(";")}]`, signature }
        : { kind: "variable" }),
      span: span(l),
      nameSpan: span(l),
      inLambda: false,
      file: l.file,
    };
  });
  return found.length ? { name, defined: found } : undefined;
}

const span = ({ start, end }: Span): Span => ({ start, end });

// A form a call can take: its label, as .foo.f[a;b] or count[x], each
// parameter's place in it, start to end, and what it's the form of
export type Signature = {
  label: string;
  params: [number, number][];
} & ({ builtin: Builtin } | { defined: Listed });

// The signatures for the innermost call the offset is in that has any, and
// the parameter it's at: a call's are the hover's for its name, q's forms
// first, then each definition it lists that's a function. A call with none,
// as an index, a local or a variable, gives way to the next call out
export function signatures(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
): { signatures: Signature[]; active: number } | undefined {
  for (const { call, active } of callsAt(a, offset)) {
    const shown = hover(index, file, a, call.name.start);
    if (!shown) continue;
    const out: Signature[] = [];
    const { builtin, defined } = shown;
    if (builtin) {
      for (const form of builtin.forms) out.push({ ...parsed(form), builtin });
    }
    for (const d of defined) {
      if (d.kind !== "function" || !d.signature) continue;
      let label = `${d.full}[`;
      const params: [number, number][] = [];
      d.signature.forEach((p, n) => {
        if (n > 0) label += ";";
        params.push([label.length, label.length + p.length]);
        label += p;
      });
      out.push({ label: `${label}]`, params, defined: d });
    }
    if (out.length) return { signatures: out, active };
  }
  return undefined;
}

// A form of q's own read as a call: its parameters between its brackets'
// separators, without the spaces around them, as in aj  [c; t1; t2]
const forms = new Map<string, { label: string; params: [number, number][] }>();
function parsed(form: string) {
  let found = forms.get(form);
  if (found) return found;
  const call = annotate(form).calls[0];
  const params: [number, number][] = [];
  if (call) {
    const starts = [call.open, ...call.separators].map((t) => t.end);
    const ends = [...call.separators.map((t) => t.start), call.end];
    for (let n = 0; n < starts.length; n++) {
      let start = starts[n];
      let end = ends[n];
      while (start < end && /\s/.test(form[start])) start++;
      while (end > start && /\s/.test(form[end - 1])) end--;
      params.push([start, end]);
    }
  }
  found = { label: form, params };
  forms.set(form, found);
  return found;
}

// Where the name at the offset occurs, meaning the same thing: a global or
// an export in every file, anything else as in the file. Without its
// definitions unless asked
export function references(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
  withDefinition: boolean,
): Reference[] {
  const wanted = across(index, file, a, offset);
  if (!wanted) {
    return inFile(a, offset, withDefinition).map((r) => ({
      file,
      ...span(r),
      passed: false,
    }));
  }
  const out: Reference[] = [];
  for (const [f, e] of index) {
    if ("global" in wanted) {
      for (const g of e.globals) {
        if (g.full === wanted.global) {
          out.push({ file: f, ...span(g), passed: g.passed });
        }
      }
      continue;
    }
    // The key, as the export's declaration
    if (withDefinition && wanted.modules.includes(f)) {
      const k = e.export?.keys?.find((k) => k.key === wanted.key);
      if (k) out.push({ file: f, ...span(k), passed: false });
    }
    const resolved = new Map<string, boolean>();
    for (const x of e.exports) {
      if (x.key !== wanted.key) continue;
      let hit = resolved.get(x.module);
      if (hit === undefined) {
        hit = resolve(index, f, x.module).some((m) =>
          wanted.modules.includes(m),
        );
        resolved.set(x.module, hit);
      }
      if (hit) out.push({ file: f, ...span(x), passed: false });
    }
  }
  const skip = withDefinition
    ? []
    : definitions(index, file, a, offset).map((d) => `${d.file} ${d.start}`);
  const order = nearest(file);
  return out
    .filter((o) => !skip.includes(`${o.file} ${o.start}`))
    .sort((x, y) => order(x.file, y.file) || x.start - y.start);
}

export type Listed = Defined & { file: string };

// The globals defined across files whose names have the query's
// characters in order, ignoring case: where each file first assigns it at
// top level, or first in a lambda if it has none
export function symbols(index: Index, query: string): Listed[] {
  const q = query.toLowerCase().replace(/\s/g, "");
  const matches = (name: string) => {
    const n = name.toLowerCase();
    let i = 0;
    for (const c of n) if (c === q[i]) i++;
    return i === q.length;
  };
  const out: Listed[] = [];
  for (const [file, e] of index) {
    const defined = firsts(e.defined);
    const top = new Set(defined.filter((d) => !d.inLambda).map((d) => d.full));
    for (const d of defined) {
      if (d.inLambda && top.has(d.full)) continue;
      if (matches(d.full)) out.push({ ...d, file });
    }
  }
  return out;
}
