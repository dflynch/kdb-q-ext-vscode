// Navigation within one file, from its annotations: the outline of what it
// defines, and the definition and occurrences of the name at the cursor.
// Pure and total, as the scanner and the annotation pass are: no VS Code
// imports, never throws.

import type { Annotated, Lambda, Name } from "./annotate";
import { lineOf, lineStarts } from "./lines";
import { type Script, scan, type Token } from "./scanner";

export type Outlined = {
  name: string;
  kind: "namespace" | "function" | "variable" | "module";
  // A function's parameters, as [x;y], or a module's use`foo
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

// A global's definition: where it's first assigned at top level, or first
// in a lambda. A function is a global assigned a lambda, as in f:{x},
// f:g:{x}, `f set {x} or set[`f;{x}]; a module, one assigned use`mod
export type Defined = {
  full: string;
  kind: "function" | "variable" | "module";
  // A function's parameters, as [x;y], or a module's use`foo
  detail?: string;
  // The whole definition: from the name, a handle's backtick, or the set
  // of set[`f;x], to the end of its value
  span: Span;
  // The name, without a handle's backtick
  nameSpan: Span;
  inLambda: boolean;
  // The comment lines above it, as written, without the indent they share
  doc?: string;
};

// Each global's first definition at top level and its first in a lambda,
// not where an existing value is amended, in the order they're written
export function globals(text: string, a: Annotated): Defined[] {
  const script = scan(text);
  const at = placed(script);
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
    const doc = documented(span.start, inLambda);
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
      item.detail = `[${l.params.join(";")}]`;
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
  const documented = docs(text, script);
  const seen = new Set<string>();
  const out: Defined[] = [];
  for (const d of defined) {
    const key = `${d.inLambda} ${d.full}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = described(d.full, d.nameSpan, d.inLambda);
    if (item) out.push(item);
  }
  return out;
}

// The comment documenting a definition starting at the offset, if it
// starts its line: the comment lines, or a block comment, ending directly
// above it, as written, without the indent they share. In a lambda, one
// character of it stays, as q reads a line there only indented: a lone /
// is a comment line, not a block comment's start. A comment trailing a
// line documents nothing, as which definition it's about can't be told
function docs(
  text: string,
  script: Script,
): (offset: number, inLambda: boolean) => string | undefined {
  const starts = lineStarts(text);
  const line = (offset: number) => lineOf(starts, offset);
  // Where each line's text starts, past its spaces, found once a line
  const indents = new Map<number, number>();
  const indent = (n: number) => {
    let at = indents.get(n);
    if (at === undefined) {
      const end = starts[n + 1] ?? text.length;
      at = starts[n];
      while (at < end && (text[at] === " " || text[at] === "\t")) at++;
      indents.set(n, at);
    }
    return at;
  };
  // Each comment that starts its line, by the line it ends on
  const ending = new Map<number, Token>();
  for (const s of [
    script.comments,
    ...script.statements.map((s) => s.tokens),
  ]) {
    for (const t of s) {
      if (t.kind === "comment" && indent(line(t.start)) === t.start) {
        ending.set(line(t.end), t);
      }
    }
  }
  return (offset, inLambda) => {
    const own = line(offset);
    if (indent(own) !== offset) return undefined;
    let first: Token | undefined;
    for (let n = own; n > 0; ) {
      const c = ending.get(n - 1);
      if (!c) break;
      first = c;
      n = line(c.start);
    }
    if (!first) return undefined;
    const lines = text
      .slice(starts[line(first.start)], starts[own])
      .split(/\r\n|\r|\n/)
      .slice(0, -1)
      .map((l) => l.trimEnd());
    // The spaces and tabs every line but a blank one starts with, alike
    let shared: string | undefined;
    for (const l of lines) {
      if (!l) continue;
      const lead = l.slice(0, l.length - l.trimStart().length);
      if (shared === undefined) shared = lead;
      else {
        let k = 0;
        while (k < shared.length && shared[k] === lead[k]) k++;
        shared = shared.slice(0, k);
      }
    }
    const cut = Math.max(0, (shared?.length ?? 0) - (inLambda ? 1 : 0));
    return lines.map((l) => l.slice(cut)).join("\n");
  };
}

// What the file defines at top level: each global once, where it's first
// assigned, under its namespace. Globals of a namespace written apart, with
// others between, are in a node for each run, as a node's range must hold
// only its own
export function outline(text: string, a: Annotated): Outlined[] {
  const top: Outlined[] = [];
  for (const d of globals(text, a)) {
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
// parameter by its lambda, a global by its absolute name, an export by its
// module and key, and a column, key or keyword by name
export type Target = {
  start: number;
  end: number;
  identity: string;
  // A column's variable, if the table has no such column
  maybe?: string;
  defines: boolean;
  // Can create it, as an amend of an existing value can't
  creates: boolean;
  // In a lambda, rather than run as the file loads
  inLambda: boolean;
  // A global named by a symbol, as `t in `t insert x
  passed: boolean;
};

export function targets(a: Annotated): Target[] {
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
      case "export":
        return `export ${n.module} ${n.full}`;
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
    creates: n.defines === true && !n.amends,
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
      creates: h.defines === true && !h.amends,
      inLambda: h.lambda !== undefined,
      passed: h.module === undefined,
    });
  }
  return out.sort((x, y) => x.start - y.start);
}

// The name the offset is in, else one it's just after, as the cursor is when
// typing
export function at(all: Target[], offset: number): Target | undefined {
  return (
    all.find((t) => t.start <= offset && offset < t.end) ??
    all.find((t) => t.end === offset)
  );
}

// Where the name at the offset is defined in the file: a parameter where
// it's declared, a local or global where it's first assigned, not where an
// existing value is amended, as d[k]:1. For a global, an assignment at top
// level comes before any in a lambda, as the outline has it, wherever the
// lambda is. A column read is the variable it may be. Nothing for a keyword,
// an export, an implicit parameter never assigned, or a name defined in
// another file
function definition(
  a: Annotated,
  offset: number,
): { start: number; end: number } | undefined {
  const all = targets(a);
  const here = at(all, offset);
  if (!here) return undefined;
  const d = first(all, here.identity) ?? first(all, here.maybe);
  return d && { start: d.start, end: d.end };
}

// Where a variable or global is first defined in the file, at top level
// before any lambda
export function first(
  all: Target[],
  identity: string | undefined,
): Target | undefined {
  if (!identity?.startsWith("variable ") && !identity?.startsWith("global "))
    return undefined;
  const defs = all.filter((t) => t.identity === identity && t.creates);
  return defs.find((t) => !t.inLambda) ?? defs[0];
}

// The occurrences, for find references, without the definition unless asked
export function references(
  a: Annotated,
  offset: number,
  withDefinition: boolean,
): { start: number; end: number }[] {
  const d = withDefinition ? undefined : definition(a, offset);
  return occurrences(a, offset).filter((o) => o.start !== d?.start);
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
