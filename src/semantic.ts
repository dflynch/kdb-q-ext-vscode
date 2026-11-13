// Semantic tokens for q, where the grammar can't tell what a name is: a
// lambda's parameters and locals, and where used as the function, which the
// grammar colours as a query's clause, as it can't follow a query across
// lines or brackets

import type { Annotated } from "./annotate";
import { locals } from "./locals";

export type Kind = "parameter" | "variable" | "function";

export type Semantic = { start: number; end: number; kind: Kind };

// Each, in order
export function semanticTokens(a: Annotated): Semantic[] {
  const out: Semantic[] = locals(a).map(({ start, end, param }) => ({
    start,
    end,
    kind: param ? "parameter" : "variable",
  }));
  for (const n of a.names) {
    if (n.role === "builtin" && n.full === "where" && !n.clause) {
      out.push({ start: n.token.start, end: n.token.end, kind: "function" });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}
