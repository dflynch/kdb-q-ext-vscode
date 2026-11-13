// Navigation within one file, from its annotations: the outline of what it
// defines, the definition and occurrences of the name at the cursor, and
// the calls the cursor is in.
// Pure and total, as the scanner and the annotation pass are: no VS Code
// imports, never throws.

import type { Annotated, Call, Lambda, Name } from "./annotate";
import { lineOf, lineStarts } from "./lines";
import type { Script, Token } from "./scanner";

export type Outlined = {
  name: string;
  kind: "namespace" | "function" | "variable" | "module";
  // A function's signature, each parameter as written, as [x;y] or
  // [a:`j;b], or a module's use`foo
  detail?: string;
  // As a definition's; a namespace spans its run of globals, and is named
  // where its first is
  span: Span;
  nameSpan: Span;
  children?: Outlined[];
};

export type Occurrence = {
  start: number;
  end: number;
  // text: a column that may be the variable, or the variable it may be, as q
  // reads a column first
  kind: "read" | "write" | "text";
};

// Each statement's tokens, without comments, in order, to find a token by
// offset
type Placed = { tokens: Token[]; index: number };

function placed(script: Script): (offset: number) => Placed | undefined {
  const all: Placed[] = [];
  for (const s of script.statements) {
    const tokens = s.tokens.filter((t) => t.kind !== "comment");
    for (let index = 0; index < tokens.length; index++) {
      all.push({ tokens, index });
    }
  }
  return (offset) => {
    let lo = 0;
    let hi = all.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = all[mid].tokens[all[mid].index];
      if (offset < t.start) hi = mid - 1;
      else if (offset >= t.end) lo = mid + 1;
      else return all[mid];
    }
    return undefined;
  };
}

// The end of the value assigned at the token: up to a ; or a close at its
// own depth, or the end of the statement
function valueEnd({ tokens, index }: Placed): number {
  let depth = 0;
  let end = tokens[index].end;
  for (let j = index + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === "open") depth++;
    else if (t.kind === "close" && depth-- === 0) break;
    else if (t.kind === "separator" && depth === 0) break;
    end = t.end;
  }
  return end;
}

// The index of the close of the brackets the token is in
function closing({ tokens, index }: Placed): number | undefined {
  let depth = 0;
  for (let j = index + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind === "open") depth++;
    else if (t.kind === "close" && depth-- === 0) return j;
  }
  return undefined;
}

export type Span = { start: number; end: number };

// A global's definition: where it's assigned, not where an existing value is
// amended. A function is a global assigned a lambda, as in f:{x},
// f:g:{x}, `f set {x} or set[`f;{x}]; a module, one assigned use`mod
export type Defined = {
  full: string;
  kind: "function" | "variable" | "module";
  // A function's signature, each parameter as written, as [x;y] or
  // [a:`j;b], or a module's use`foo
  detail?: string;
  // A function's parameters, each as written
  signature?: string[];
  // The whole definition: from the name, a handle's backtick, or the set
  // of set[`f;x], to the end of its value
  span: Span;
  // The name, without a handle's backtick
  nameSpan: Span;
  inLambda: boolean;
  // The comment lines above it, as written
  doc?: string;
};

// Each global's definitions, not where an existing value is amended, in the
// order they're written; firsts() keeps each one's first
export function globals(text: string, a: Annotated): Defined[] {
  const at = placed(a.script);
  const lambdas = new Map<number, Lambda>(
    a.lambdas.map((l) => [l.open.start, l]),
  );
  const word = (t: Token | undefined) =>
    t ? text.slice(t.start, t.end) : undefined;
  const isAssign = (t: Token | undefined) =>
    word(t) === ":" || word(t) === "::";

  const described = (
    full: string,
    nameSpan: Span,
    inLambda: boolean,
  ): Defined | undefined => {
    const p = at(nameSpan.start);
    if (!p) return undefined;
    const { tokens, index } = p;
    const beside = (k: number) => word(tokens[index + k]);
    const handle = tokens[index].kind === "symbol";
    // set[`f;x], to its ]
    const close =
      handle && beside(-2) === "set" && beside(-1) === "[" && beside(1) === ";"
        ? closing(p)
        : undefined;
    const span =
      close === undefined
        ? {
            start: tokens[index].start,
            end: Math.max(nameSpan.end, valueEnd(p)),
          }
        : { start: tokens[index - 2].start, end: tokens[close].end };
    const item: Defined = { full, kind: "variable", span, nameSpan, inLambda };
    const doc = documented(span.start);
    if (doc !== undefined) item.doc = doc;
    // Past any names assigned along with it, as g in f:g:{x}
    let i = index;
    while (tokens[i + 2]?.kind === "name" && isAssign(tokens[i + 3])) {
      i += 2;
    }
    const [op, value, then] = [tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    const l = value && lambdas.get(value.start);
    // The lambda is the whole value: to the end of the definition, or to
    // set's ]
    const whole =
      close === undefined
        ? (isAssign(op) || (handle && word(op) === "set")) &&
          l?.close?.end === span.end
        : l?.close?.start === tokens[close - 1].start;
    if (l && whole) {
      item.kind = "function";
      item.detail = `[${l.signature.join(";")}]`;
      item.signature = l.signature;
    } else if (
      isAssign(op) &&
      word(value) === "use" &&
      then?.kind === "symbol" &&
      then.end === span.end
    ) {
      item.kind = "module";
      item.detail = text.slice(value.start, then.end);
    }
    return item;
  };

  // Names and handles, in the order they're written
  const defined: { full: string; nameSpan: Span; inLambda: boolean }[] = [];
  for (const n of a.names) {
    if (n.role === "global" && n.defines && !n.amends) {
      defined.push({
        full: n.full,
        nameSpan: { start: n.token.start, end: n.token.end },
        inLambda: n.lambda !== undefined,
      });
    }
  }
  for (const h of a.handles) {
    if (h.defines && !h.amends && h.module === undefined) {
      defined.push({
        full: h.full,
        nameSpan: { start: h.start, end: h.end },
        inLambda: h.lambda !== undefined,
      });
    }
  }
  defined.sort((x, y) => x.nameSpan.start - y.nameSpan.start);
  const documented = docs(text, a.script);
  const out: Defined[] = [];
  for (const d of defined) {
    const item = described(d.full, d.nameSpan, d.inLambda);
    if (item) out.push(item);
  }
  return out;
}

// Each global's first definition at top level and its first in a lambda
export function firsts(all: Defined[]): Defined[] {
  const seen = new Set<string>();
  return all.filter((d) => {
    const key = `${d.inLambda} ${d.full}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The comment documenting a definition starting at the offset, if it starts
// its line, at its first column: the comment lines, or a block comment,
// ending directly above it, each starting its line too, as written. Not a
// comment indented, as one in a lambda, which is about the code it's in, nor
// one trailing a line, as which definition it's about can't be told
function docs(
  text: string,
  script: Script,
): (offset: number) => string | undefined {
  const starts = lineStarts(text);
  const line = (offset: number) => lineOf(starts, offset);
  // Each comment at a line's first column, by the line it ends on
  const ending = new Map<number, Token>();
  for (const s of [
    script.comments,
    ...script.statements.map((s) => s.tokens),
  ]) {
    for (const t of s) {
      if (t.kind === "comment" && starts[line(t.start)] === t.start) {
        ending.set(line(t.end), t);
      }
    }
  }
  return (offset) => {
    const own = line(offset);
    if (starts[own] !== offset) return undefined;
    let first: Token | undefined;
    for (let n = own; n > 0; ) {
      const c = ending.get(n - 1);
      if (!c) break;
      first = c;
      n = line(c.start);
    }
    if (!first) return undefined;
    return text
      .slice(starts[line(first.start)], starts[own])
      .split(/\r\n|\r|\n/)
      .slice(0, -1)
      .join("\n");
  };
}

// What the file defines at top level: each global once, where it's first
// assigned, under its namespace. Globals of a namespace written apart, with
// others between, are in a node for each run, as a node's range must hold
// only its own
export function outline(text: string, a: Annotated): Outlined[] {
  const top: Outlined[] = [];
  for (const d of firsts(globals(text, a))) {
    if (d.inLambda) continue;
    const item: Outlined = {
      name: d.full,
      kind: d.kind,
      ...(d.detail === undefined ? {} : { detail: d.detail }),
      span: d.span,
      nameSpan: d.nameSpan,
    };
    const dot = d.full.lastIndexOf(".");
    if (dot <= 0) {
      top.push(item);
      continue;
    }
    const space = d.full.slice(0, dot);
    item.name = d.full.slice(dot + 1);
    let node = top[top.length - 1];
    if (node?.kind !== "namespace" || node.name !== space) {
      node = {
        name: space,
        kind: "namespace",
        span: { ...item.span },
        nameSpan: item.nameSpan,
        children: [],
      };
      top.push(node);
    }
    node.children?.push(item);
    node.span.end = Math.max(node.span.end, item.span.end);
  }
  return top;
}

// What a name or handle refers to, so occurrences can be matched: a local or
// parameter by its lambda, a global by its absolute name, as m.f, m`f or
// m[`f], which q reads alike, an export of a local's module by the module
// and key, and a column, key or keyword by name
export type Target = {
  start: number;
  end: number;
  identity: string;
  // A column's variable, if the table has no such column
  maybe?: string;
  defines: boolean;
  // Sets its whole value, so is where it's defined, as an amend isn't
  sets: boolean;
  // In a lambda, rather than run as the file loads
  inLambda: boolean;
  // A global named by a symbol, as `t in `t insert x
  passed: boolean;
  // A global read by a key, as m`f or m[`f], which q 5.0 reads through a
  // view, m::use`mod, as it doesn't m.f
  byKey?: true;
};

// Each annotation's, once: every request reads them, several times over
const targeted = new WeakMap<Annotated, readonly Target[]>();

export function targets(a: Annotated): readonly Target[] {
  let found = targeted.get(a);
  if (!found) {
    found = targetsOf(a);
    targeted.set(a, found);
  }
  return found;
}

function targetsOf(a: Annotated): Target[] {
  const ids = new Map<Lambda, number>(a.lambdas.map((l, i) => [l, i]));
  const scoped = (role: string, full: string, l: Lambda | undefined) =>
    role === "param" || role === "local"
      ? `variable ${ids.get(l as Lambda)} ${full}`
      : `global ${full}`;
  const identity = (n: Name) => {
    switch (n.role) {
      case "param":
      case "local":
      case "global":
        return scoped(n.role, n.full, n.lambda);
      default:
        return `${n.role} ${n.full}`;
    }
  };
  const out: Target[] = a.names.map((n) => ({
    start: n.token.start,
    end: n.token.end,
    identity: identity(n),
    ...(n.variable
      ? { maybe: scoped(n.variable.role, n.variable.full, n.lambda) }
      : {}),
    defines: n.defines === true,
    sets: n.defines === true && !n.amends,
    inLambda: n.lambda !== undefined,
    passed: false,
  }));
  for (const h of a.handles) {
    out.push({
      start: h.start,
      end: h.end,
      identity:
        h.module === undefined
          ? `global ${h.full}`
          : `export ${h.module} ${h.full}`,
      defines: h.defines === true,
      sets: h.defines === true && !h.amends,
      inLambda: h.lambda !== undefined,
      passed: h.module === undefined,
    });
  }
  for (const k of a.keyReads) {
    out.push({
      start: k.start,
      end: k.end,
      identity: `global ${k.via}.${k.key}`,
      defines: false,
      sets: false,
      inLambda: false,
      passed: false,
      byKey: true,
    });
  }
  return out.sort((x, y) => x.start - y.start);
}

// The name the offset is in, else one it's just after, as the cursor is when
// typing
export function at(all: readonly Target[], offset: number): Target | undefined {
  return (
    all.find((t) => t.start <= offset && offset < t.end) ??
    all.find((t) => t.end === offset)
  );
}

// Where the name at the offset is defined in the file, as defining() has
// it. A column read is the variable it may be. Nothing for a keyword, an
// export, an implicit parameter never assigned, or a name defined in another
// file
function definitions(a: Annotated, offset: number): Target[] {
  const all = targets(a);
  const here = at(all, offset);
  if (!here) return [];
  const found = defining(all, here.identity);
  return found.length ? found : defining(all, here.maybe);
}

// Where a variable or global is defined in the file, the latest first: a
// parameter where it's declared, each assignment, not where an existing
// value is amended, as d[k]:1. For a global, its assignments at top level,
// or, if there's none, its assignments in lambdas, as the outline has it,
// wherever the lambda is
export function defining(
  all: readonly Target[],
  identity: string | undefined,
): Target[] {
  if (!identity?.startsWith("variable ") && !identity?.startsWith("global "))
    return [];
  const defs = all.filter((t) => t.identity === identity && t.sets);
  const top = defs.filter((t) => !t.inLambda);
  return (top.length ? top : defs).reverse();
}

// The occurrences, for find references, without the definitions unless
// asked
export function references(
  a: Annotated,
  offset: number,
  withDefinition: boolean,
): { start: number; end: number }[] {
  const skip = withDefinition ? [] : definitions(a, offset);
  return occurrences(a, offset).filter(
    (o) => !skip.some((d) => d.start === o.start),
  );
}

// Where the name at the offset occurs in the file, meaning the same thing
export function occurrences(a: Annotated, offset: number): Occurrence[] {
  const all = targets(a);
  const here = at(all, offset);
  if (!here) return [];
  const out: Occurrence[] = [];
  for (const t of all) {
    if (t.identity === here.identity) {
      out.push({
        start: t.start,
        end: t.end,
        kind: t.defines ? "write" : "read",
      });
    } else if (t.maybe === here.identity || t.identity === here.maybe) {
      out.push({ start: t.start, end: t.end, kind: "text" });
    }
  }
  return out;
}

// The calls whose brackets the offset is in, innermost first, each with the
// parameter it's at: how many of the call's own separators are before it.
// In is after the open, up to the close, or the end of the statement's last
// line if there's none yet. A lambda in a call's arguments is code of its
// own, so only calls inside the lambda count there
export function callsAt(
  a: Annotated,
  offset: number,
): { call: Call; active: number }[] {
  const inLambda = (c: Call) =>
    a.lambdas.some(
      (l) =>
        c.open.end <= l.open.start &&
        l.open.end <= offset &&
        offset <= (l.close?.start ?? Number.POSITIVE_INFINITY),
    );
  return a.calls
    .filter((c) => c.open.end <= offset && offset <= c.end && !inLambda(c))
    .reverse()
    .map((call) => ({
      call,
      active: call.separators.filter((t) => t.start < offset).length,
    }));
}
