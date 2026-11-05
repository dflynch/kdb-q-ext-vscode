// Navigation within one file, from its annotations: the outline of what it
// defines, and the occurrences of the name at the cursor. Pure and total, as
// the scanner and the annotation pass are: no VS Code imports, never throws.

import type { Annotated, Lambda, Name } from "./annotate";
import { scan, type Token } from "./scanner";

export type Outlined = {
  name: string;
  kind: "namespace" | "function" | "variable" | "module";
  // A function's parameters, as [x;y], or a module's use`foo
  detail?: string;
  // From the name, or a handle's backtick, to the end of its value; a
  // namespace spans its run of globals
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
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

function placed(text: string): (offset: number) => Placed | undefined {
  const all: Placed[] = [];
  for (const s of scan(text).statements) {
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

// What the file defines at top level: each global once, where it's first
// assigned, under its namespace. A function is a global assigned a lambda,
// as in f:{x} or f:g:{x}; a module, one assigned use`mod. Globals of a
// namespace written apart, with others between, are in a node for each run,
// as a node's range must hold only its own
export function outline(text: string, a: Annotated): Outlined[] {
  const at = placed(text);
  const lambdas = new Map<number, Lambda>(
    a.lambdas.map((l) => [l.open.start, l]),
  );
  const word = (t: Token | undefined) =>
    t ? text.slice(t.start, t.end) : undefined;
  const seen = new Set<string>();
  const top: Outlined[] = [];

  const add = (full: string, start: number, end: number) => {
    if (seen.has(full)) return;
    seen.add(full);
    const p = at(start);
    if (!p) return;
    const item: Outlined = {
      name: full,
      kind: "variable",
      // From the symbol's backtick, for a handle
      start: p.tokens[p.index].start,
      end: Math.max(end, valueEnd(p)),
      nameStart: start,
      nameEnd: end,
    };
    // Past any names assigned along with it, as g in f:g:{x}
    let i = p.index;
    const isAssign = (t: Token | undefined) =>
      word(t) === ":" || word(t) === "::";
    while (p.tokens[i + 2]?.kind === "name" && isAssign(p.tokens[i + 3])) {
      i += 2;
    }
    const [, op, value, after] = p.tokens.slice(i);
    const l = value && lambdas.get(value.start);
    if (isAssign(op) && l?.close && l.close.end === item.end) {
      item.kind = "function";
      item.detail = `[${l.params.join(";")}]`;
    } else if (
      isAssign(op) &&
      word(value) === "use" &&
      after?.kind === "symbol" &&
      after.end === item.end
    ) {
      item.kind = "module";
      item.detail = text.slice(value.start, after.end);
    }
    const dot = full.lastIndexOf(".");
    if (dot <= 0) {
      top.push(item);
      return;
    }
    const space = full.slice(0, dot);
    item.name = full.slice(dot + 1);
    let node = top[top.length - 1];
    if (node?.kind !== "namespace" || node.name !== space) {
      node = {
        name: space,
        kind: "namespace",
        start: item.start,
        end: item.end,
        nameStart: item.nameStart,
        nameEnd: item.nameEnd,
        children: [],
      };
      top.push(node);
    }
    node.children?.push(item);
    node.end = Math.max(node.end, item.end);
  };

  // Names and handles, in the order they're written
  const defined: { full: string; start: number; end: number }[] = [];
  for (const n of a.names) {
    if (n.role === "global" && n.defines && !n.lambda) {
      defined.push({ full: n.full, start: n.token.start, end: n.token.end });
    }
  }
  for (const h of a.handles) {
    if (h.defines && !h.lambda && h.module === undefined) defined.push(h);
  }
  defined.sort((x, y) => x.start - y.start);
  for (const d of defined) add(d.full, d.start, d.end);
  return top;
}

// What a name or handle refers to, so occurrences can be matched: a local or
// parameter by its lambda, a global by its absolute name, an export by its
// module and key, and a column, key or keyword by name
type Target = {
  start: number;
  end: number;
  identity: string;
  // A column's variable, if the table has no such column
  maybe?: string;
  defines: boolean;
};

function targets(a: Annotated): Target[] {
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
    });
  }
  return out;
}

// Where the name at the offset occurs in the file, meaning the same thing.
// The offset may be just after the name, as the cursor is when typing
export function occurrences(a: Annotated, offset: number): Occurrence[] {
  const all = targets(a);
  // A name the offset is in, else one it's just after
  const here =
    all.find((t) => t.start <= offset && offset < t.end) ??
    all.find((t) => t.end === offset);
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
  return out.sort((x, y) => x.start - y.start);
}
