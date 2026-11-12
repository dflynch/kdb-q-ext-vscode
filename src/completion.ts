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
import { type Index, type Listed, nearest, resolve } from "./workspaceIndex";

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

// The completions at the offset, and the text they replace: the name typed
// up to it, from its first character, dots and all
export function completions(
  index: Index,
  file: string,
  text: string,
  a: Annotated,
  offset: number,
): { range: Span; items: Completion[] } | undefined {
  const typed = typing(text, a, offset);
  if (typed === undefined) return undefined;
  const { prefix, symbol } = typed;
  const range = { start: offset - prefix.length, end: offset };
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
  return { range, items };
}

// The name being typed, or an empty one where a name could start, or
// undefined where nothing's offered
function typing(
  text: string,
  a: Annotated,
  offset: number,
): { prefix: string; symbol: boolean } | undefined {
  if (ended(text, a, offset)) return undefined;
  const t = tokenAt(a, offset);
  if (!t) return { prefix: "", symbol: false };
  switch (t.kind) {
    case "name":
      return { prefix: text.slice(t.start, offset), symbol: false };
    case "symbol": {
      // The symbol from its last backtick before the offset, if it names a
      // namespace: anything else is data, as `a or `:file
      const from = text.lastIndexOf("`", offset - 1) + 1;
      const prefix = text.slice(from, offset);
      return prefix.startsWith(".") ? { prefix, symbol: true } : undefined;
    }
    case "operator":
      // A dot alone, as a namespace starts: q's . otherwise, which is rare
      // before a name
      return text.slice(t.start, offset) === "."
        ? { prefix: ".", symbol: false }
        : { prefix: "", symbol: false };
    case "string":
      // Just after a string's close is outside it
      return t.unterminated || offset < t.end
        ? undefined
        : { prefix: "", symbol: false };
    case "open":
    case "close":
    case "separator":
    case "iterator":
      return { prefix: "", symbol: false };
    default:
      // A comment, a number, a command, k or another language's line
      return undefined;
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
// or, if there's none yet, the end of its statement's last line
function lambdaAt(
  text: string,
  a: Annotated,
  offset: number,
): Lambda | undefined {
  let found: Lambda | undefined;
  for (const l of a.lambdas) {
    if (l.open.end > offset) continue;
    const end = l.close?.start ?? statementEnd(text, a, l.open.start);
    if (offset <= end && (!found || l.open.start > found.open.start)) {
      found = l;
    }
  }
  return found;
}

// The end of the statement's last line, past spaces after it, as a call's
// end is
function statementEnd(text: string, a: Annotated, at: number): number {
  const s = a.script.statements.find((s) => s.start <= at && at < s.end);
  let end = s ? s.end : at;
  while (text[end] === " " || text[end] === "\t") end++;
  return end;
}

// Each global's definition the hover would show first: at top level before
// in a lambda, then the nearest file's, then the latest
function globals(index: Index, file: string): Map<string, Listed> {
  const order = nearest(file);
  const out = new Map<string, Listed>();
  for (const [f, e] of index) {
    for (const d of e.defined) {
      const had = out.get(d.full);
      const better =
        !had ||
        (had.inLambda && !d.inLambda) ||
        (had.inLambda === d.inLambda &&
          (order(f, had.file) < 0 ||
            (f === had.file && d.nameSpan.start > had.nameSpan.start)));
      if (better) out.set(d.full, { ...d, file: f });
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

// A bare name: the lambda's parameters and locals, the globals in the root,
// or, after \d, the namespace's by their names in it, and q's keywords
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
  const all = globals(index, file);
  if (namespace) {
    for (const [full, d] of all) {
      const name = full.slice(namespace.length + 1);
      if (full.startsWith(`${namespace}.`) && !name.includes(".")) {
        add(ofDefined(name, d, 1));
      }
    }
  }
  for (const [full, d] of all) {
    if (!full.includes(".")) add(ofDefined(full, d, 1));
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
  const all = globals(index, file);
  // As q reads it: a name without a leading dot is in the file's namespace
  const absolute =
    written.startsWith(".") || !namespace ? written : `${namespace}.${written}`;
  const global = all.get(absolute);
  const module =
    global?.kind === "module"
      ? global.detail?.match(/^use\s*`([^`]*)$/)?.[1]
      : undefined;
  if (module !== undefined) return exportsOf(index, file, written, module);

  const out = new Map<string, Completion>();
  const child = (full: string) => {
    const rest = full.slice(absolute.length + 1);
    const dot = rest.indexOf(".");
    return {
      label: `${written}.${dot < 0 ? rest : rest.slice(0, dot)}`,
      leaf: dot < 0,
    };
  };
  for (const [full, d] of all) {
    if (!full.startsWith(`${absolute}.`)) continue;
    const { label, leaf } = child(full);
    if (leaf) out.set(label, ofDefined(label, d, 1));
    else if (!out.has(label)) {
      out.set(label, { label, kind: "namespace", group: 1 });
    }
  }
  for (const [name, b] of builtins) {
    if (!name.startsWith(`${absolute}.`)) continue;
    const { label, leaf } = child(name);
    if (!leaf) continue;
    // Your own definition of it, as .z.pg, beside q's entry
    const had = out.get(label);
    out.set(label, {
      ...ofBuiltin(label, b),
      ...(had?.defined ? { defined: had.defined } : {}),
    });
  }
  return [...out.values()];
}

// A module's exports, from each file use`mod may be, by their keys in its
// export, as the hover has them
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
      const value = k.values[0];
      const d = e?.defined.find((d) => d.nameSpan.start === value?.start);
      const defined: Listed = d
        ? { ...d, full: k.key, file: m }
        : {
            full: k.key,
            ...(k.signature
              ? {
                  kind: "function",
                  detail: `[${k.signature.join(";")}]`,
                  signature: k.signature,
                }
              : { kind: "variable" }),
            span: { start: k.start, end: k.end },
            nameSpan: { start: k.start, end: k.end },
            inLambda: false,
            file: m,
          };
      out.set(label, ofDefined(label, defined, 1));
    }
  }
  return [...out.values()];
}
