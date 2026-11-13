// Navigation across the workspace's q files: what each file defines and
// uses, kept as an entry per file, and the definitions, references,
// symbols and signatures they give together. Each file is read as if loaded
// in the root, as \l runs a file in its loader's namespace, which the file
// can't show. Modules resolve by file name, as use`foo finds foo.q or
// foo/init.q in a directory of QPATH, which the workspace doesn't say; a
// module's own globals are in .m.foo, which only it sees. Pure and total,
// as the annotation pass is: no VS Code imports, never throws.

import { type Annotated, annotate } from "./annotate";
import { type Builtin, builtins } from "./builtins";
import { lineOf, lineStarts } from "./lines";
import {
  at,
  callsAt,
  type Defined,
  defining,
  firsts,
  globals,
  references as inFile,
  type Span,
  targets,
} from "./navigation";

export type Entry = {
  // Where each line starts, to turn offsets into positions
  lines: number[];
  // Each definition of a global, in the order they're written, and the
  // module one binds, as m:use`mod, or is a view of, as m::use`mod at top
  // level
  defined: (Defined & { module?: string; view?: true })[];
  // Each global named, by its absolute name, assigned or read, and each
  // column that may be one; passed if named by a symbol, by a key if read
  // as m`f or m[`f]
  globals: (Span & { full: string; passed: boolean; byKey?: true })[];
  // Each export of a local's module named, as n`f where n:use`foo in a
  // lambda, or of (use`foo)`f
  exports: (Span & { module: string; key: string })[];
  // A module's, a file assigning export in its own namespace: where that
  // ends, at the first \d, as use runs the file in .m.foo until one, and a
  // \d is absolute, \d . the root (q 5.0). Its globals before, but those
  // with a leading dot, are the module's own
  ownEnds?: number;
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
    defined: globals(text, a),
    globals: [],
    exports: [],
  };
  const end = a.namespaces[0]?.at ?? Number.POSITIVE_INFINITY;
  if (out.defined.some((d) => d.full === "export" && d.nameSpan.start < end))
    out.ownEnds = end;
  for (const d of out.defined) {
    if (d.kind !== "module") continue;
    const module = a.modules.get(d.full);
    const view = a.views.get(d.full);
    if (module) d.module = module;
    else if (view) Object.assign(d, { module: view, view: true });
  }
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
        ...(t.byKey && global === t.identity ? { byKey: t.byKey } : {}),
      });
    } else if (t.identity.startsWith("export ")) {
      const [, module, key] = t.identity.split(" ");
      out.exports.push({ start: t.start, end: t.end, module, key });
    }
  }
  // q finds no export outside the module's own namespace
  if (
    a.export &&
    out.ownEnds !== undefined &&
    a.export.at.start < out.ownEnds
  ) {
    const { start, end } = a.export.at;
    out.export = { start, end };
    if (a.export.keys) {
      out.export.keys = a.export.keys.map((k) => {
        const span = { start: k.start, end: k.end };
        const target = k.target;
        const defs =
          target && "full" in target
            ? defining(all, `global ${target.full}`).map(({ start, end }) => ({
                start,
                end,
              }))
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

// The files a \l line may load, if the offset is on the path it names, and
// the path: each file whose path ends with the path's segments, as the
// directory q runs in, which the path is from, isn't known. Without . or
// empty segments, each .. taking back the segment before it, and any .. at
// the start dropped
export function loaded(
  index: Index,
  a: Annotated,
  offset: number,
): { path: Span; files: string[] } | undefined {
  const load = a.loads.find((l) => l.start <= offset && offset <= l.end);
  if (!load) return undefined;
  const segments: string[] = [];
  for (const s of load.path.split("/")) {
    if (s === "..") segments.pop();
    else if (s !== "" && s !== ".") segments.push(s);
  }
  const tail = `/${segments.join("/")}`;
  const files = segments.length
    ? [...index.keys()].filter((k) => decoded(k).endsWith(tail)).sort()
    : [];
  return { path: span(load), files };
}

// A URI as a path, as it's written, to compare with one in q
function decoded(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
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

// A global as named somewhere: its absolute name, and, if a module's own,
// the module's file, as no other file sees it
export type Global = { full: string; own?: string };

// Whether the offset is in the module's own namespace
const inOwn = (e: Entry | undefined, offset: number) =>
  e?.ownEnds !== undefined && offset < e.ownEnds;

// Whether a name at the offset in the file is a module's own global
const ownAt = (e: Entry | undefined, offset: number, full: string) =>
  inOwn(e, offset) && !full.startsWith(".");

// The global named at the offset in the file
export function named(
  index: Index,
  file: string,
  offset: number,
  full: string,
): Global {
  return ownAt(index.get(file), offset, full) ? { full, own: file } : { full };
}

// The module whose own namespace the offset is in: the file, if so
export function moduleAt(
  index: Index,
  file: string,
  offset: number,
): string | undefined {
  return inOwn(index.get(file), offset) ? file : undefined;
}

// Whether a name at the offset in a file is the global
function isGlobal(
  g: Global,
  file: string,
  e: Entry,
  offset: number,
  full: string,
): boolean {
  if (full !== g.full) return false;
  return ownAt(e, offset, full) ? g.own === file : g.own === undefined;
}

// A global bound to a module in a file: the file, the module, as written in
// use, and whether it's a view, m::use`mod at top level
type Binding = { file: string; module: string; view: boolean };

// Whether a read follows the binding: q 5.0 reads m`f and m[`f] through a
// view, but not m.f
const follows = (b: Binding, byKey: boolean) => byKey || !b.view;

// For one request: each global bound to a module in any file, by its name,
// but a module's own, which no other file sees, read on first use; and the
// files a module resolves to from a file, each module's once
type Bindings = {
  names: () => ReadonlyMap<string, Binding[]>;
  files: (file: string, module: string) => string[];
};

function bindings(index: Index): Bindings {
  let names: Map<string, Binding[]> | undefined;
  const resolved = new Map<string, string[]>();
  return {
    names: () => {
      if (names) return names;
      names = new Map();
      for (const [file, e] of index) {
        for (const d of e.defined) {
          if (!d.module || ownAt(e, d.nameSpan.start, d.full)) continue;
          const all = names.get(d.full) ?? [];
          all.push({ file, module: d.module, view: d.view === true });
          names.set(d.full, all);
        }
      }
      return names;
    },
    files: (file, module) => {
      // use`foo resolves alike from any file; a relative use`.bar doesn't
      const known = module.startsWith(".") ? `${file} ${module}` : module;
      let found = resolved.get(known);
      if (!found) {
        found = resolve(index, file, module);
        resolved.set(known, found);
      }
      return found;
    },
  };
}

// How a global is bound in the file, if the file defines it, which wins
// over every other file's: a definition that isn't a binding binds nothing
function boundHere(
  index: Index,
  file: string,
  g: Global,
): Binding[] | undefined {
  const e = index.get(file);
  const own = e?.defined.filter((d) =>
    isGlobal(g, file, e, d.nameSpan.start, d.full),
  );
  if (!own?.length) return undefined;
  return own.flatMap((d) =>
    d.module ? [{ file, module: d.module, view: d.view === true }] : [],
  );
}

// The files of the modules a global may be bound to, as m in m.f, m`f or
// m[`f]: the file's own bindings, if it defines m, else each file's that
// does, the nearest first, as a global defined in several files is; none
// for a module's own
export function moduleFiles(
  index: Index,
  file: string,
  g: Global,
  byKey: boolean,
  all: Bindings = bindings(index),
): string[] {
  const found =
    boundHere(index, file, g) ??
    (g.own ? [] : [...(all.names().get(g.full) ?? [])]).sort((x, y) =>
      nearest(file)(x.file, y.file),
    );
  const out = new Set<string>();
  for (const b of found) {
    if (follows(b, byKey))
      for (const m of all.files(b.file, b.module)) out.add(m);
  }
  return [...out];
}

// The ways q may read a dotted global through a module, as m.f, the longest
// m first, each with its key; by a key, as m`f, only the longest
function* reads(
  g: Global,
  byKey: boolean,
): Generator<{ via: Global; key: string; byKey: boolean }> {
  for (let dot = g.full.lastIndexOf("."); dot > 0; ) {
    const key = g.full.slice(dot + 1).split(".")[0];
    yield { via: { ...g, full: g.full.slice(0, dot) }, key, byKey };
    byKey = false;
    dot = g.full.lastIndexOf(".", dot - 1);
  }
}

// The export a dotted global may be, as m.f, m`f or m[`f], where m is
// bound to a module, as moduleFiles() has it, and its key: the first of
// reads() bound to one
function through(
  index: Index,
  file: string,
  g: Global,
  byKey: boolean,
  all: Bindings,
): { modules: string[]; key: string } | undefined {
  for (const r of reads(g, byKey)) {
    const found = moduleFiles(index, file, r.via, r.byKey, all);
    if (found.length) return { modules: found, key: r.key };
  }
  return undefined;
}

// The key of the file's export the offset is in, else one it's just after,
// as at() has it
function keyAt(index: Index, file: string, offset: number) {
  const keys = index.get(file)?.export?.keys ?? [];
  return (
    keys.find((k) => k.start <= offset && offset < k.end) ??
    keys.find((k) => k.end === offset)
  );
}

// What the name at the offset is, across files: a global; an export, by the
// modules it can be and its key, from a global read through a module, a
// local's module, or the key in the module's own export; or nothing, when
// it's only the file's
type Across =
  | { global: Global }
  | { modules: string[]; key: string }
  | undefined;

function across(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
  all: Bindings = bindings(index),
): Across {
  const here = at(targets(a), offset);
  const id = here?.identity;
  if (here && id?.startsWith("global ")) {
    const global = named(index, file, here.start, id.slice(7));
    const byKey = here.byKey === true;
    return (
      (global.full.includes(".") &&
        through(index, file, global, byKey, all)) || { global }
    );
  }
  if (id?.startsWith("export ")) {
    const [, module, key] = id.split(" ");
    return { modules: all.files(file, module), key };
  }
  const key = keyAt(index, file, offset);
  if (key) return { modules: [file], key: key.key };
  return undefined;
}
// Where the name at the offset is defined. A local or parameter as in the
// file. A global where each file assigns it at top level, or, if none does,
// in a lambda, the file itself first, then the nearest, and each file's the
// latest first; a module's own only in the module. An export where its
// module's export has the key, or where the export is assigned if it's
// built as the module loads
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
      ? defining(all, id).map((d) => ({ file, ...span(d) }))
      : [];
  const found = local(here.identity);
  if (found.length) return found;
  const wanted = across(index, file, a, offset);
  if (wanted && "global" in wanted)
    return definitionsOf(index, file, wanted.global);
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
    ? definitionsOf(
        index,
        file,
        named(index, file, here.start, here.maybe.slice(7)),
      )
    : [];
}

// Where each file assigns a global at top level, or, if none does, in a
// lambda, the file itself first, then the nearest, each file's the latest
// first
function definitionsOf(index: Index, file: string, g: Global): Location[] {
  return defined(index, file, g).map((d) => ({
    file: d.file,
    ...d.nameSpan,
  }));
}

// Each file's definitions of a global, as definitionsOf() orders them
function defined(index: Index, file: string, g: Global): Listed[] {
  const atTop: Listed[] = [];
  const inLambda: Listed[] = [];
  for (const [f, e] of index) {
    for (const d of e.defined) {
      if (isGlobal(g, f, e, d.nameSpan.start, d.full))
        (d.inLambda ? inLambda : atTop).push({ ...d, file: f });
    }
  }
  return (atTop.length ? atTop : inLambda).sort(preferred(file));
}

// The order definitions of a global are listed in: at top level before in a
// lambda, then the file itself, then the nearest, each file's the latest
// first
export function preferred(file: string): (x: Listed, y: Listed) => number {
  const order = nearest(file);
  return (x, y) =>
    Number(x.inLambda) - Number(y.inLambda) ||
    order(x.file, y.file) ||
    y.nameSpan.start - x.nameSpan.start;
}

// What's defined where a module's export gives the key's value: the global
// defined there, else the key itself, a function if a lambda is written in
// it, as ([f:{[a;b] a}])
export function exported(
  index: Index,
  file: string,
  at: Span,
  key: string,
): Listed {
  const e = index.get(file);
  const d = e?.defined.find((d) => d.nameSpan.start === at.start);
  if (d) return { ...d, file };
  const signature = e?.export?.keys?.find(
    (k) => k.start === at.start,
  )?.signature;
  return {
    full: key,
    ...(signature
      ? { kind: "function", detail: `[${signature.join(";")}]`, signature }
      : { kind: "variable" }),
    span: span(at),
    nameSpan: span(at),
    inLambda: false,
    file,
  };
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
  const ofGlobal = (global: Global) => {
    // q's own, only in its namespaces: a keyword is never a global, and
    // from and by are qSQL's only in a query
    const builtin = /^\.[Qzhj]\./.test(global.full)
      ? builtins.get(global.full)
      : undefined;
    const found = defined(index, file, global);
    if (!builtin && !found.length) return undefined;
    return { name, ...(builtin ? { builtin } : {}), defined: found };
  };
  const wanted = across(index, file, a, offset);
  // A column read, as the global it may be, as definitions() takes it
  if (!wanted) {
    return here.maybe?.startsWith("global ")
      ? ofGlobal(named(index, file, here.start, here.maybe.slice(7)))
      : undefined;
  }
  if ("global" in wanted) return ofGlobal(wanted.global);
  const found = definitions(index, file, a, offset).map((l) =>
    exported(index, l.file, l, wanted.key),
  );
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
// an export in every file, a module's own global in the module, anything
// else as in the file; at a key written alone in the module's export, as
// ([f]), both the global and the export. Without its definitions unless
// asked
export function references(
  index: Index,
  file: string,
  a: Annotated,
  offset: number,
  withDefinition: boolean,
): Reference[] {
  const all = bindings(index);
  const wanted = across(index, file, a, offset, all);
  if (!wanted) {
    return inFile(a, offset, withDefinition).map((r) => ({
      file,
      ...span(r),
      passed: false,
    }));
  }
  const key = "global" in wanted ? keyAt(index, file, offset) : undefined;
  const global = "global" in wanted ? wanted.global : undefined;
  const exported =
    "global" in wanted ? key && { modules: [file], key: key.key } : wanted;
  const reach = reaching(index, all, exported ? exported.modules : []);
  const out: Reference[] = [];
  for (const [f, e] of index) {
    if (global) {
      for (const g of e.globals) {
        if (isGlobal(global, f, e, g.start, g.full)) {
          out.push({ file: f, ...span(g), passed: g.passed });
        }
      }
    }
    if (!exported) continue;
    // The key, as the export's declaration
    if (withDefinition && !global && exported.modules.includes(f)) {
      const k = e.export?.keys?.find((k) => k.key === exported.key);
      if (k) out.push({ file: f, ...span(k), passed: false });
    }
    // A local's module's
    for (const x of e.exports) {
      if (x.key !== exported.key) continue;
      const files = all.files(f, x.module);
      if (files.some((m) => exported.modules.includes(m)))
        out.push({ file: f, ...span(x), passed: false });
    }
    // A global read through a module, as through() reads it: one with the
    // key after a dot
    for (const g of e.globals) {
      if (!afterDot(g.full, exported.key)) continue;
      const read = named(index, f, g.start, g.full);
      for (const r of reads(read, g.byKey === true)) {
        const found = reach(f, r.via, r.byKey);
        if (found === "none") continue;
        if (found === "hit" && r.key === exported.key)
          out.push({ file: f, ...span(g), passed: false });
        break;
      }
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

// Whether the key is a part of the name after a dot, as f of m.f or m.f.g
function afterDot(full: string, key: string): boolean {
  for (let at = full.indexOf(`.${key}`); at >= 0; ) {
    const end = at + key.length + 1;
    if (at > 0 && (end === full.length || full[end] === ".")) return true;
    at = full.indexOf(`.${key}`, at + 1);
  }
  return false;
}

// Whether a global, named in a file, is bound to a module, as moduleFiles()
// has it, and to one of the files: none, another, or a hit. Each name's
// other files' bindings checked once, for the many names Find All
// References reads
function reaching(
  index: Index,
  all: Bindings,
  files: string[],
): (file: string, g: Global, byKey: boolean) => "none" | "other" | "hit" {
  const of = (found: Binding[], byKey: boolean) => {
    let out: "none" | "other" | "hit" = "none";
    for (const b of found) {
      const resolved = all.files(b.file, b.module);
      if (!follows(b, byKey) || !resolved.length) continue;
      if (resolved.some((m) => files.includes(m))) return "hit";
      out = "other";
    }
    return out;
  };
  const others = new Map<string, "none" | "other" | "hit">();
  // The latest file's names it binds, and how it binds each name asked, as
  // references() reads each file's names together
  let mine = {
    file: "",
    binds: new Set<string>(),
    bound: new Map<string, Binding[] | undefined>(),
  };
  return (file, g, byKey) => {
    if (mine.file !== file) {
      const defined = index.get(file)?.defined ?? [];
      const binds = new Set(defined.filter((d) => d.module).map((d) => d.full));
      mine = { file, binds, bound: new Map() };
    }
    // Bound nowhere, the most read
    if (!mine.binds.has(g.full) && !all.names().has(g.full)) return "none";
    const own = `${g.own ?? ""} ${g.full}`;
    if (!mine.bound.has(own)) mine.bound.set(own, boundHere(index, file, g));
    const here = mine.bound.get(own);
    if (here) return of(here, byKey);
    if (g.own) return "none";
    const known = `${byKey} ${g.full}`;
    let found = others.get(known);
    if (found === undefined) {
      found = of(all.names().get(g.full) ?? [], byKey);
      others.set(known, found);
    }
    return found;
  };
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
