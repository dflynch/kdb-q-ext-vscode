// The names a lambda owns, its parameters and locals: where they are, for
// semantic highlighting, and renaming one within its lambda. q has no
// closures, so a lambda inside another owns its own names, and a name it
// reads from outside is a global. A dotted name is a global wherever it is.

import { type Annotated, keywords, type Lambda, type Name } from "./annotate";

export type Span = { start: number; end: number };

// A parameter or local, or a query's name that may be one, as
// `{[t;p] select from t where price>p}` reads p as the column if t has
// one, else the parameter
export type Owned = Span & { lambda: Lambda; name: string; param: boolean };

function owned(n: Name): Owned | undefined {
  const v =
    n.role === "param" || n.role === "local"
      ? { role: n.role, full: n.full }
      : n.role === "column"
        ? n.variable
        : undefined;
  if (!v || v.role === "global" || !n.lambda) return undefined;
  return {
    start: n.token.start,
    end: n.token.end,
    lambda: n.lambda,
    name: v.full,
    param: v.role === "param",
  };
}

// Each parameter and local, in order
export function locals(a: Annotated): Owned[] {
  return a.names.flatMap((n) => owned(n) ?? []);
}

// The name the offset is in, else one it's just after, as the cursor is
// when typing
function nameAt(a: Annotated, offset: number): Name | undefined {
  return (
    a.names.find((n) => n.token.start <= offset && offset < n.token.end) ??
    a.names.find((n) => n.token.end === offset)
  );
}

// The local or parameter at the offset, to rename, or why it can't be
export function renameable(
  a: Annotated,
  offset: number,
): Owned | { refused: string } {
  const n = nameAt(a, offset);
  const o = n && owned(n);
  return o ?? { refused: "only locals and parameters can be renamed" };
}

const valid = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// The edits that rename the local or parameter at the offset, as Find
// References lists it, or why they can't: an implicit parameter gets a
// parameter list, as {[price;y] price*y} for x in {x*y}, which q reads as
// before. A new name is refused if q would read the lambda differently:
// dotted, as q assigns it as a global; a keyword, as q can't assign it; a
// name the lambda already has, of any kind, as it would become the renamed
// one; or x, y or z in a lambda without a parameter list, as that would
// change the parameters
export function rename(
  text: string,
  a: Annotated,
  offset: number,
  to: string,
): { edits: (Span & { text: string })[] } | { refused: string } {
  const found = renameable(a, offset);
  if ("refused" in found) return found;
  const { lambda, name } = found;
  if (!valid.test(to)) return { refused: `invalid name: ${to}` };
  if (keywords.has(to)) return { refused: `assign: ${to}` };
  if (to === name) return { edits: [] };
  const inLambda = a.names.filter((n) => n.lambda === lambda);
  const all = inLambda.flatMap((n) => {
    const o = owned(n);
    return o && o.name === name ? [o] : [];
  });
  if (inLambda.some((n) => text.slice(n.token.start, n.token.end) === to)) {
    return { refused: `name in use: ${to}` };
  }
  const listed = lambda.implicit && lambda.params.includes(name);
  if (lambda.implicit && !listed && ["x", "y", "z"].includes(to)) {
    return { refused: `implicit parameter: ${to}` };
  }
  const edits = all.map(({ start, end }) => ({ start, end, text: to }));
  // The list replaces the brace, so no edit meets another, then a space
  // before code on the same line
  if (listed) {
    const params = lambda.params.map((p) => (p === name ? to : p));
    const { start, end } = lambda.open;
    const space = /\s/.test(text[end] ?? "") ? "" : " ";
    edits.unshift({ start, end, text: `{[${params.join(";")}]${space}` });
  }
  return { edits };
}
