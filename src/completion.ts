// What to offer as the user types a name: the innermost lambda's parameters
// and locals, as q has no closures; the workspace's globals, by absolute
// name; q's keywords; and, after a dot, a namespace's members, q's own in
// .Q, .z, .h and .j among them, or a module's exports, as s. for s:use`mod.
// A symbol naming a namespace, as `.ns., offers its members too; any other
// symbol is data. Nothing in a string, a comment, a number, a system command,
// a line for another language, or after the line that ends the script. Pure
// and total, as the index is: no VS Code imports, never throws.

import type { Annotated, Lambda } from "./annotate";
import { type Builtin, builtins } from "./builtins";
import type { Span } from "./navigation";
import type { Token } from "./scanner";
import {
  exported,
  type Index,
  type Listed,
  preferred,
  resolve,
} from "./workspaceIndex";

export type Completion = {
  // As inserted, and as typed text is matched against: the whole name
  label: string;
  kind:
    | "param"
    | "local"
    | "function"
    | "variable"
    | "module"
    | "namespace"
    | "keyword";
  // 0 in scope, 1 the workspace's, 2 q's own, to order a list not yet
  // narrowed by typing
  group: 0 | 1 | 2;
  builtin?: Builtin;
  defined?: Listed;
};

// The completions at the offset, and the text they go in place of: the name
// typed up to it, from its first character, dots and all, inserting, and
// the whole name, replacing, as VS Code's editor.suggest.insertMode chooses
export function completions(
  index: Index,
  file: string,
  text: string,
  a: Annotated,
  offset: number,
): { inserting: Span; replacing: Span; items: Completion[] } | undefined {
  const typed = typing(text, a, offset);
  if (typed === undefined) return undefined;
  const { prefix, symbol, end } = typed;
  const start = offset - prefix.length;
  const namespace = namespaceAt(a, offset);
  const dot = prefix.lastIndexOf(".");
  let items: Completion[];
  if (dot > 0) {
    items = members(index, file, prefix.slice(0, dot), namespace);
  } else if (dot === 0) {
    items = namespaces(index, file);
  } else if (symbol) {
    items = [];
  } else {
    items = bare(index, file, namespace, lambdaAt(text, a, offset));
  }
  return {
    inserting: { start, end: offset },
    replacing: { start, end },
    items,
  };
}

// Nothing typed yet, where a name could start
const nothing = (offset: number) => ({
  prefix: "",
  symbol: false,
  end: offset,
});

// The name being typed up to the offset, and where the whole of it ends;
// an empty one where a name could start; or undefined where nothing's
// offered
function typing(
  text: string,
  a: Annotated,
  offset: number,
): { prefix: string; symbol: boolean; end: number } | undefined {
  if (ended(text, a, offset)) return undefined;
  const t = tokenAt(a, offset);
  if (!t) {
    // Past spaces after a comment, a command, another language's line or a
    // string left open, which run to the end of the line, still in it
    let at = offset;
    while (text[at - 1] === " " || text[at - 1] === "\t") at--;
    const before = at < offset ? tokenAt(a, at) : undefined;
    return before && !open(before) ? undefined : nothing(offset);
  }
  switch (t.kind) {
    case "name":
      return { prefix: text.slice(t.start, offset), symbol: false, end: t.end };
    case "symbol": {
      // The symbol from its last backtick before the offset, if it names a
      // namespace: anything else is data, as `a or `:file
      const from = text.lastIndexOf("`", offset - 1) + 1;
      const prefix = text.slice(from, offset);
      const next = text.indexOf("`", offset);
      const end = next < 0 || next > t.end ? t.end : next;
      return prefix.startsWith(".") ? { prefix, symbol: true, end } : undefined;
    }
    case "operator":
      // A dot alone, as a namespace starts: q's . otherwise, which is rare
      // before a name
      return text.slice(t.start, offset) === "."
        ? { prefix: ".", symbol: false, end: offset }
        : nothing(offset);
    default:
      return open(t) && offset === t.end ? nothing(offset) : undefined;
  }
}

// Whether a name can follow the token: not in a comment, a number, a
// command, k, another language's line or a string left open
function open(t: Token): boolean {
  switch (t.kind) {
    case "string":
      return !t.unterminated;
    case "open":
    case "close":
    case "separator":
    case "iterator":
    case "operator":
    case "name":
    case "symbol":
      return true;
    default:
      return false;
  }
}

// The token the offset is in or just after, as when typing it
function tokenAt(a: Annotated, offset: number): Token | undefined {
  const within = (t: { start: number; end: number }) =>
    t.start < offset && offset <= t.end;
  for (const s of a.script.statements) {
    if (s.start >= offset) break;
    if (!within(s)) continue;
    const t = s.tokens.find(within);
    if (t) return t;
  }
  return a.script.comments.find(within);
}

// After the lone \ that ends the script, which q doesn't read
function ended(text: string, a: Annotated, offset: number): boolean {
  const line = a.script.end;
  if (line === undefined) return false;
  // Lines as the scanner counts them: at \n or \r\n
  let start = 0;
  for (let n = 0; n < line; n++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return false;
    start = next + 1;
  }
  return offset >= start;
}

// The namespace q reads names in at the offset, as \d left it
function namespaceAt(a: Annotated, offset: number): string {
  let out = "";
  for (const n of a.namespaces) {
    if (n.at > offset) break;
    out = n.namespace;
  }
  return out;
}

// The innermost lambda the offset is in: after its open, up to its close,
// or, if there's none yet, its statement, with the indented lines after it
// that q would join on, blank so far
function lambdaAt(
  text: string,
  a: Annotated,
  offset: number,
): Lambda | undefined {
  let found: Lambda | undefined;
  for (const l of a.lambdas) {
    if (l.open.end > offset) continue;
    const inside = l.close
      ? offset <= l.close.start
      : continues(text, a, l.open.start, offset);
    if (inside && (!found || l.open.start > found.open.start)) found = l;
  }
  return found;
}

// Whether the offset is in the statement at, or after it on its last line,
// or on an indented line after it with only spaces between
function continues(
  text: string,
  a: Annotated,
  at: number,
  offset: number,
): boolean {
  const s = a.script.statements.find((s) => s.start <= at && at < s.end);
  if (!s || offset <= s.end) return true;
  const between = text.slice(s.end, offset);
  if (!/^\s*$/.test(between)) return false;
  // Lines break at \n, as q's do: a lone \r is a space
  const line = between.slice(between.lastIndexOf("\n") + 1);
  return !between.includes("\n") || line.length > 0;
}

// Each global's definition the hover would show first
function globals(index: Index, file: string): Map<string, Listed> {
  const better = preferred(file);
  const out = new Map<string, Listed>();
  for (const [f, e] of index) {
    for (const d of e.defined) {
      const had = out.get(d.full);
      const listed = { ...d, file: f };
      if (!had || better(listed, had) < 0) out.set(d.full, listed);
    }
  }
  return out;
}

const ofDefined = (
  label: string,
  defined: Listed,
  group: 0 | 1 | 2,
): Completion => ({ label, kind: defined.kind, group, defined });

const ofBuiltin = (label: string, builtin: Builtin): Completion => ({
  label,
  kind: label.includes(".")
    ? builtin.forms.length
      ? "function"
      : "variable"
    : "keyword",
  group: 2,
  builtin,
});

// A bare name: the lambda's parameters and locals; the globals in the root,
// or, after \d, the namespace's, by their names in it, and its namespaces,
// as q reads names there and nowhere else; and q's keywords
function bare(
  index: Index,
  file: string,
  namespace: string,
  lambda: Lambda | undefined,
): Completion[] {
  const out = new Map<string, Completion>();
  const add = (c: Completion) => {
    if (!out.has(c.label)) out.set(c.label, c);
  };
  if (lambda) {
    for (const p of lambda.params) {
      if (p) add({ label: p, kind: "param", group: 0 });
    }
    for (const l of lambda.locals) add({ label: l, kind: "local", group: 0 });
  }
  if (namespace) {
    for (const c of children(globals(index, file), namespace, "")) add(c);
  } else {
    for (const [full, d] of globals(index, file)) {
      if (!full.includes(".")) add(ofDefined(full, d, 1));
    }
  }
  for (const [name, b] of builtins) {
    if (!name.includes(".")) add(ofBuiltin(name, b));
  }
  return [...out.values()];
}

// A dot at the start: each namespace, q's and the workspace's
function namespaces(index: Index, file: string): Completion[] {
  const out = new Map<string, Completion>();
  // The first part of the name, as .foo of .foo.bar.f; one defined
  // without parts, as .foo:1, shows as itself
  const add = (full: string, d?: Listed) => {
    const dot = full.indexOf(".", 1);
    const ns = dot < 0 ? full : full.slice(0, dot);
    if (dot < 0 && d) out.set(ns, ofDefined(ns, d, 1));
    else if (!out.has(ns)) {
      out.set(ns, { label: ns, kind: "namespace", group: 1 });
    }
  };
  for (const [full, d] of globals(index, file)) {
    if (full.startsWith(".")) add(full, d);
  }
  for (const name of builtins.keys()) {
    if (name.startsWith(".")) add(name);
  }
  return [...out.values()];
}

// After a dot: the members of the namespace written before it, each as
// written up to its own name, and its namespaces; or a module's exports,
// for a global bound to one, as q never reads a dotted name through a local
function members(
  index: Index,
  file: string,
  written: string,
  namespace: string,
): Completion[] {
  // As q reads it: a name without a leading dot is in the file's namespace
  const absolute =
    written.startsWith(".") || !namespace ? written : `${namespace}.${written}`;
  // A module bound in this file, as Go to Definition follows only those
  const module = index
    .get(file)
    ?.defined.findLast((d) => d.full === absolute && d.kind === "module")
    ?.detail?.match(/^use\s*`([^`]*)$/)?.[1];
  if (module !== undefined) return exportsOf(index, file, written, module);

  const out = new Map<string, Completion>();
  for (const c of children(globals(index, file), absolute, `${written}.`)) {
    out.set(c.label, c);
  }
  for (const [name, b] of builtins) {
    const rest = name.slice(absolute.length + 1);
    if (!name.startsWith(`${absolute}.`) || rest.includes(".")) continue;
    // Your own definition of it, as .z.pg, beside q's entry
    const label = `${written}.${rest}`;
    const had = out.get(label);
    out.set(label, {
      ...ofBuiltin(label, b),
      ...(had?.defined ? { defined: had.defined } : {}),
    });
  }
  return [...out.values()];
}

// The globals directly in a namespace, and the namespaces in it, each
// labelled by its name in it after the written prefix
function children(
  all: Map<string, Listed>,
  namespace: string,
  written: string,
): Completion[] {
  const out = new Map<string, Completion>();
  for (const [full, d] of all) {
    if (!full.startsWith(`${namespace}.`)) continue;
    const rest = full.slice(namespace.length + 1);
    const dot = rest.indexOf(".");
    const label = written + (dot < 0 ? rest : rest.slice(0, dot));
    if (dot < 0) out.set(label, ofDefined(label, d, 1));
    else if (!out.has(label)) {
      out.set(label, { label, kind: "namespace", group: 1 });
    }
  }
  return [...out.values()];
}

// A module's exports, from each file use`mod may be, by their keys in its
// export, as the hover has them, of a module bound in the file
function exportsOf(
  index: Index,
  file: string,
  written: string,
  module: string,
): Completion[] {
  const out = new Map<string, Completion>();
  for (const m of resolve(index, file, module)) {
    const e = index.get(m);
    for (const k of e?.export?.keys ?? []) {
      const label = `${written}.${k.key}`;
      if (out.has(label)) continue;
      out.set(
        label,
        ofDefined(label, exported(index, m, k.values[0], k.key), 1),
      );
    }
  }
  return [...out.values()];
}
