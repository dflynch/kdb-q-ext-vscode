// The names a lambda owns, its parameters and locals, for semantic
// highlighting. q has no closures, so a lambda inside another owns its own
// names, and a name it reads from outside is a global.

import type { Annotated, Lambda, Name } from "./annotate";

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
