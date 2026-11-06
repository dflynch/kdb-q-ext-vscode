// Annotates q source for navigation: the lambdas, what each name is (a
// parameter, a local, a global, a column, a key or a q keyword), the globals
// passed by reference as symbols (handles), and q 5 modules' use and export.
// Globals resolve to the namespace q reads them in. Like the scanner it's pure
// and total: no VS Code or Node imports, and it never throws.

import { scan, type Token } from "./scanner";

export type Role =
  | "param"
  | "local"
  | "global"
  | "column" // a name in a qSQL clause, or a table literal's column
  | "key" // a dictionary literal's key, as f in ([f:1])
  | "builtin" // a q keyword, such as count or select
  | "export"; // m.f, where m:use`mod: an export of a module

export type Lambda = {
  open: Token;
  close?: Token;
  // The explicit list, or x, y and z up to the highest the body uses
  params: string[];
  implicit: boolean;
  locals: Set<string>;
  // Where its globals resolve: "" for the root, else as ".foo"
  namespace: string;
  outer?: Lambda;
};

export type Name = {
  token: Token;
  role: Role;
  // A global's absolute name, as .foo.f, or f in the root; an export's key;
  // otherwise the name as written
  full: string;
  // Assigns or amends it, or declares a parameter
  defines?: true;
  // The innermost lambda it's in
  lambda?: Lambda;
  // A column's name as a variable, if the table has no such column: q reads
  // a column first, then a local or parameter, then a global. Never for i,
  // the virtual column, which q reads even over a column named i
  variable?: { role: "param" | "local" | "global"; full: string };
  // An export's module, as written in use, and the global bound to it
  module?: string;
  via?: string;
};

// A global passed by reference: a symbol, or part of a symbol list, naming it
// where q dereferences it, or any symbol with a leading dot
export type Handle = {
  start: number;
  end: number;
  // Absolute, as for a name, or an export's key with module
  full: string;
  defines?: true;
  lambda?: Lambda;
  module?: string;
  via?: string;
};
export type Use = { token: Token; module: string };

export type Export = {
  key: string;
  start: number;
  end: number;
  // What the key exports, when it's one name or a lambda
  target?: { full: string } | { lambda: Lambda };
};

export type Annotated = {
  names: Name[];
  handles: Handle[];
  lambdas: Lambda[];
  uses: Use[];
  // A module's export: keys when it's a dictionary literal, else only where
  // it's assigned, as it's built when the module loads
  export?: { at: Token; keys?: Export[] };
};

// q's reserved words and .q functions, as q 5.0 lists them in .Q.res and
// key `.q. They resolve before any global, and can't be assigned
const keywords = new Set(
  (
    "abs acos asin atan avg bin binr cor cos cov delete dev div do enlist " +
    "exec exit exp getenv hopen if in insert last like log max min prd " +
    "select setenv sin sqrt ss sum tan update var wavg while within wsum " +
    "xexp from by neg not null string reciprocal floor ceiling signum mod " +
    "xbar xlog and or each scan over prior mmu lsq inv md5 ltime gtime " +
    "count first svar sdev scov med all any rand sums prds mins maxs fills " +
    "deltas ratios avgs differ prev next rank reverse iasc idesc asc desc " +
    "msum mcount mavg mdev xrank mmin mmax xprev rotate ema distinct group " +
    "where flip type key til get value attr cut set upsert raze union inter " +
    "except cross sv vs sublist read0 read1 hclose hdel hsym hcount peach " +
    "system ltrim rtrim trim lower upper ssr view tables views cols xcols " +
    "keys xkey xcol xasc xdesc fkeys meta lj ljf aj aj0 ajf ajf0 ij ijf pj " +
    "asof uj ujf ww wj wj1 fby xgroup ungroup ej save load rsave rload " +
    "dsave show csv parse eval reval use .z.s"
  ).split(" "),
);
const queries = new Set(["select", "exec", "update", "delete"]);
// Keywords only in a query: elsewhere they're names, as (a;from)
const queryWords = new Set(["from", "by"]);

type Group = { open: Token; items: Item[]; close?: Token };
type Item = Token | Group;

const isGroup = (item: Item | undefined): item is Group =>
  item !== undefined && "items" in item;

// Brackets deeper than this stay tokens, so the walk's recursion is bounded
const deepest = 256;

// A statement's tokens as nested brackets, without comments. A close that
// matches no open stays a token
function tree(text: string, tokens: Token[]): Item[] {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const top: Item[] = [];
  const stack: { group: Group; close: string }[] = [];
  // Opens past the deepest, whose closes stay tokens too
  let over = 0;
  const add = (item: Item) =>
    (stack.length ? stack[stack.length - 1].group.items : top).push(item);
  for (const token of tokens) {
    if (token.kind === "comment") continue;
    if (token.kind === "open" && stack.length >= deepest) over++;
    else if (token.kind === "close" && over > 0) over--;
    else if (token.kind === "open") {
      const group: Group = { open: token, items: [] };
      add(group);
      stack.push({ group, close: pairs[text[token.start]] });
      continue;
    }
    if (token.kind === "close") {
      const at = stack.map((s) => s.close).lastIndexOf(text[token.start]);
      if (at >= 0) {
        stack[at].group.close = token;
        stack.length = at;
        continue;
      }
    }
    add(token);
  }
  return top;
}

// Items split at their separators
function segments(items: Item[]): Item[][] {
  const out: Item[][] = [[]];
  for (const item of items) {
    if (!isGroup(item) && item.kind === "separator") out.push([]);
    else out[out.length - 1].push(item);
  }
  return out;
}

// A name with a dot at its end, as err. in err.:(::), is the global without
// it: q assigns err a dictionary
const bare = (name: string) =>
  name.length > 1 && name.endsWith(".") ? name.slice(0, -1) : name;

const join = (namespace: string, name: string) =>
  name.startsWith(".") || !namespace
    ? bare(name)
    : `${namespace}.${bare(name)}`;

type Assign = ":" | "::" | "amend";

// A name token met on the walk, before its role is known
type Entry = {
  token: Token;
  text: string;
  namespace: string;
  lambda?: Lambda;
  column: boolean;
  key?: "key" | "column";
  assign?: Assign;
  declares?: true;
  // In a qSQL query, where from and by are keywords
  query?: true;
};

type Element = { start: number; end: number; text: string };

export function annotate(
  text: string,
  options: { namespace?: string } = {},
): Annotated {
  const out: Annotated = { names: [], handles: [], lambdas: [], uses: [] };
  const entries: Entry[] = [];
  const byToken = new Map<Token, Entry>();
  const lambdaAt = new Map<Token, Lambda>();
  // Symbols already read as handles, or as an export's key
  const done = new Set<Token>();
  // m:use`mod, to resolve m.f, m`f and m[`f] once roles are known
  const bindings: { entry: Entry; module: string }[] = [];
  const reached: { entry: Entry; element: Element }[] = [];

  const word = (item: Item | undefined) =>
    item && !isGroup(item) ? text.slice(item.start, item.end) : "";
  const isName = (item: Item | undefined, ...words: string[]) =>
    item !== undefined &&
    !isGroup(item) &&
    item.kind === "name" &&
    (words.length === 0 || words.includes(word(item)));
  // The name token, if the item is one (isName can't narrow: words may differ)
  const nameOf = (item: Item | undefined) =>
    isName(item) ? (item as Token) : undefined;
  const isSymbol = (item: Item | undefined): item is Token =>
    item !== undefined && !isGroup(item) && item.kind === "symbol";
  const opens = (item: Item | undefined, c: string): item is Group =>
    isGroup(item) && text[item.open.start] === c;
  const single = (segment: Item[] | undefined) =>
    segment?.length === 1 ? segment[0] : undefined;

  const elements = (token: Token): Element[] => {
    const out: Element[] = [];
    let start = token.start;
    for (let i = token.start + 1; i <= token.end; i++) {
      if (i === token.end || text[i] === "`") {
        out.push({ start: start + 1, end: i, text: text.slice(start + 1, i) });
        start = i;
      }
    }
    return out;
  };
  // The root namespace as a symbol, ` . Any other, as ` .foo, can as well be
  // a dictionary or a function, so is a handle itself
  const isRoot = (item: Item | undefined) =>
    isSymbol(item) && word(item) === "`.";

  type Context = { namespace: string; lambda?: Lambda; column: boolean };

  const push = (
    element: Element,
    full: string,
    context: Context,
    defines?: boolean,
  ) => {
    if (keywords.has(full)) return;
    out.handles.push({
      start: element.start,
      end: element.end,
      full: bare(full),
      ...(defines ? { defines: true as const } : {}),
      ...(context.lambda ? { lambda: context.lambda } : {}),
    });
  };
  // An unqualified handle resolves where the code runs: the file's namespace
  // at top level, and the root in a lambda, as \d is set as a file loads
  const handle = (element: Element, context: Context, defines?: boolean) =>
    push(
      element,
      join(context.lambda ? "" : context.namespace, element.text),
      context,
      defines,
    );
  // A symbol where q dereferences it: a list from a namespace is a path, as
  // `.`t or `.foo`t, and otherwise its first item names the global
  const dereference = (token: Token, context: Context, defines?: boolean) => {
    done.add(token);
    const els = elements(token).filter((e) => !e.text.startsWith(":"));
    if (els.length === 0 || !els[0].text) return;
    if (els.length > 1 && els[0].text.startsWith(".")) {
      const path = els[0].text === "." ? els.slice(1) : els;
      const full = path.map((e) => e.text).join(".");
      // A path is absolute; its range is the name at its end
      const last = path[path.length - 1];
      if (path.every((e) => e.text)) push(last, full, context, defines);
      return;
    }
    handle(els[0], context, defines);
    for (const e of els.slice(1)) {
      if (e.text.length > 1 && e.text.startsWith(".")) handle(e, context);
    }
  };
  // A name in the root given as a symbol: ` . `t, `.[`t], @[`.;`t;...]
  const inRoot = (token: Token, context: Context, defines?: boolean) => {
    done.add(token);
    const els = elements(token);
    if (els.length !== 1 || !els[0].text || els[0].text.startsWith(":")) {
      return;
    }
    push(els[0], els[0].text, context, defines);
  };

  // How the name at i is assigned: x:, x::, or amended, as x+: or x[i]:
  const assignment = (items: Item[], i: number): Assign | undefined => {
    let next = items[i + 1];
    let indexed = false;
    if (opens(next, "[")) {
      next = items[i + 2];
      indexed = true;
    }
    if (!next || isGroup(next) || next.kind !== "operator") return undefined;
    const op = word(next);
    if (!op.endsWith(":") || (op[0] >= "0" && op[0] <= "9")) return undefined;
    if (indexed || (op !== ":" && op !== "::")) return "amend";
    return op;
  };

  const enter = (token: Token, context: Context, extra: Partial<Entry>) => {
    const entry: Entry = {
      token,
      text: text.slice(token.start, token.end),
      namespace: context.namespace,
      column: context.column,
      ...(context.lambda ? { lambda: context.lambda } : {}),
      ...extra,
    };
    entries.push(entry);
    byToken.set(token, entry);
    return entry;
  };

  // A dictionary or table literal: ([a:1]), ([] a:1 2), ([k:1] v:2)
  const literal = (group: Group, context: Context) => {
    const [keys, ...rest] = group.items as [Group, ...Item[]];
    const kind = rest.length === 0 ? "key" : "column";
    const parts = [...segments(keys.items), ...segments(rest)];
    for (const segment of parts) {
      const [name, op] = segment;
      const key = nameOf(name);
      if (key && word(op) === ":") {
        enter(key, context, { key: kind, assign: ":" });
        walk(segment.slice(2), context);
      } else {
        walk(segment, context);
      }
    }
  };

  const lambda = (group: Group, context: Context) => {
    const l: Lambda = {
      open: group.open,
      ...(group.close ? { close: group.close } : {}),
      params: [],
      implicit: true,
      locals: new Set(),
      namespace: context.namespace,
      ...(context.lambda ? { outer: context.lambda } : {}),
    };
    out.lambdas.push(l);
    lambdaAt.set(group.open, l);
    const inner: Context = {
      namespace: context.namespace,
      lambda: l,
      column: false,
    };
    let body = group.items;
    if (opens(body[0], "[")) {
      l.implicit = false;
      for (const item of body[0].items) {
        const name = nameOf(item);
        if (name) {
          l.params.push(word(name));
          enter(name, inner, { declares: true });
        }
      }
      body = body.slice(1);
    }
    walk(body, inner);
  };

  // Arguments of @[...] and .[...]: the first is a handle, or the root with
  // the second, as @[`.;`t;...]; an amend, with three or more, defines it
  const applied = (group: Group, context: Context) => {
    const args = segments(group.items);
    const amends = args.length >= 3;
    const first = single(args[0]);
    const second = single(args[1]);
    if (isSymbol(first)) {
      if (isRoot(first) && isSymbol(second)) {
        done.add(first);
        inRoot(second, context, amends);
      } else {
        dereference(first, context, amends);
      }
    } else if (isName(first, "value", "get") && isSymbol(second)) {
      dereference(second, context);
    }
  };

  const symbol = (
    items: Item[],
    i: number,
    context: Context,
    called: boolean,
    inPlace: boolean,
  ) => {
    const token = items[i] as Token;
    if (done.has(token)) return;
    const prev = items[i - 1];
    const next = items[i + 1];
    if (isRoot(token)) {
      // ` . `t, `.[`t]
      if (isSymbol(next)) {
        done.add(token);
        inRoot(next, context);
        return;
      }
      const inside = opens(next, "[")
        ? single(segments(next.items)[0])
        : undefined;
      if (isSymbol(inside)) {
        done.add(token);
        inRoot(inside, context);
        return;
      }
    }
    if (isName(prev, "value", "get", "key")) {
      dereference(token, context);
    } else if (isName(prev, "from")) {
      // update and delete from `t amend it in place
      dereference(token, context, inPlace);
    } else if (isName(next, "set", "upsert", "insert")) {
      // Only an atom: on a list they assign nothing
      if (elements(token).length === 1) dereference(token, context, true);
    } else if (
      (opens(next, "[") && next.open.start === token.end) ||
      (isName(next) && !keywords.has(word(next))) ||
      (!isGroup(next) && next?.kind === "number")
    ) {
      // `t[0], `t 0, `t i: indexes the global
      if (elements(token).length === 1) dereference(token, context);
    } else if (
      called &&
      i === 0 &&
      !isGroup(next) &&
      next?.kind === "separator"
    ) {
      // h(`f;x), value(`f;x): a call by name
      dereference(token, context);
    }
    if (done.has(token)) return;
    for (const e of elements(token)) {
      if (e.text.length > 1 && e.text.startsWith(".")) handle(e, context);
    }
  };

  // (a;b) or (a;(b;c)), assigned all at once: its names, or undefined
  const pattern = (group: Group): Token[] | undefined => {
    const names: Token[] = [];
    for (const s of segments(group.items)) {
      const item = single(s);
      const name = nameOf(item);
      if (name) names.push(name);
      else if (opens(item, "(")) {
        const inner = pattern(item);
        if (!inner) return undefined;
        names.push(...inner);
      } else return undefined;
    }
    return names.length > 0 ? names : undefined;
  };

  const walk = (items: Item[], context: Context, called = false) => {
    // Within a qSQL query: columns before from and after where
    let query = false;
    // update and delete, which amend a table named by a symbol in place
    let inPlace = false;
    let column = context.column;
    // Whether the query is itself in a clause, so all of it is
    let outer = column;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prev = items[i - 1];
      const next = items[i + 1];
      const here: Context = { ...context, column };
      if (isGroup(item)) {
        const c = text[item.open.start];
        if (c === "{") {
          lambda(item, here);
        } else if (c === "(" && opens(item.items[0], "[")) {
          literal(item, here);
        } else if (
          c === "(" &&
          (word(next) === ":" || word(next) === "::") &&
          pattern(item)
        ) {
          // (a;b):1 2, (a;(b;c)):(1;2 3), (a;b)::1 2
          const assign = word(next) as Assign;
          for (const t of pattern(item) ?? []) enter(t, here, { assign });
        } else {
          if (c === "[" && (word(prev) === "@" || word(prev) === ".")) {
            applied(item, here);
          }
          // A list applied: to a handle, as h(`f;x) or neg[h](`f;x), or to
          // value or eval
          const call =
            c === "(" &&
            (isName(prev, "value", "eval", "reval") ||
              (isName(prev) && !keywords.has(word(prev))) ||
              (opens(prev, "[") && prev.close?.end === item.open.start));
          walk(item.items, here, call);
          // (use`mod)`f and (use`mod)[`f]
          const [u, s] = item.items;
          if (c === "(" && item.items.length === 2 && isName(u, "use")) {
            const module = isSymbol(s) ? elements(s)[0].text : "";
            const inner = opens(next, "[")
              ? single(segments(next.items)[0])
              : next;
            if (module && isSymbol(inner) && elements(inner).length === 1) {
              done.add(inner);
              const e = elements(inner)[0];
              out.handles.push({
                start: e.start,
                end: e.end,
                full: e.text,
                module,
                ...(context.lambda ? { lambda: context.lambda } : {}),
              });
            }
          }
        }
        continue;
      }
      if (item.kind === "separator") {
        query = false;
        column = context.column;
        continue;
      }
      if (item.kind === "symbol") {
        symbol(items, i, here, called, query && inPlace);
        continue;
      }
      if (item.kind !== "name") continue;
      const w = word(item);
      if (queries.has(w)) {
        outer = column;
        query = true;
        inPlace = w === "update" || w === "delete";
        column = true;
      }
      // value[`a], set[`a;1], insert[`t;x]
      if (
        ["value", "get", "key", "set", "upsert", "insert"].includes(w) &&
        opens(next, "[") &&
        next.open.start === item.end
      ) {
        const s = single(segments(next.items)[0]);
        const sets = ["set", "upsert", "insert"].includes(w);
        if (isSymbol(s) && (!sets || elements(s).length === 1)) {
          dereference(s, here, sets);
        }
      }
      const entry = enter(item, here, query ? { query: true } : {});
      const assign = assignment(items, i);
      if (assign) entry.assign = assign;
      if (query && w === "from") {
        column = outer;
      } else if (query && w === "where") {
        column = true;
      }
      // m:use`mod
      if (w === "use" && isSymbol(next)) {
        const module = elements(next)[0].text;
        done.add(next);
        if (module) {
          out.uses.push({ token: next, module });
          const target = items[i - 2];
          const after = items[i + 2];
          // At top level, :: defines a view, not a binding
          if (
            (word(prev) === ":" || (word(prev) === "::" && here.lambda)) &&
            isName(target) &&
            (after === undefined ||
              (!isGroup(after) && after.kind === "separator"))
          ) {
            const bound = byToken.get(target as Token);
            if (bound) bindings.push({ entry: bound, module });
          }
        }
      }
      // m`f and m[`f], for a module bound to m
      const key =
        isSymbol(next) && next.start === item.end
          ? next
          : opens(next, "[") && next.open.start === item.end
            ? single(segments(next.items)[0])
            : undefined;
      if (isSymbol(key) && elements(key).length === 1) {
        reached.push({ entry, element: elements(key)[0] });
      }
    }
  };

  const script = scan(text);
  let namespace = options.namespace ?? "";
  const setNamespace = (arg: string) => {
    if (arg === ".") namespace = "";
    else if (arg.startsWith(".")) namespace = arg;
  };
  for (const statement of script.statements) {
    const first = statement.tokens[0];
    if (first.kind === "command") {
      const m = /^\\d\s+(\S+)/.exec(text.slice(first.start, first.end));
      if (m) setNamespace(m[1]);
      continue;
    }
    if (first.kind === "k") continue;
    const items = tree(text, statement.tokens);
    const context: Context = { namespace, column: false };
    walk(items, context);
    // system "d .foo"
    const call = segments(items)[0];
    const [command, s] = call;
    if (isName(command, "system") && call.length === 2) {
      if (!isGroup(s) && s.kind === "string") {
        const m = /^"d\s+(\S+)"$/.exec(text.slice(s.start, s.end));
        if (m) setNamespace(m[1]);
      }
    }
    if (isName(items[0], "export")) exported(items, namespace);
  }

  // A module's export: a literal export:([f:h]) or export:`f!(h), or else
  // only where it's assigned
  function exported(items: Item[], namespace: string) {
    const at = items[0] as Token;
    const op = word(items[1]);
    if (isGroup(items[1]) || !op.endsWith(":")) return;
    if (out.export !== undefined || op !== ":") {
      out.export = { at: out.export?.at ?? at };
      return;
    }
    const target = (value: Item[]): Export["target"] => {
      const v = single(value);
      if (nameOf(v)) return { full: join(namespace, word(v)) };
      const l = isGroup(v) ? lambdaAt.get(v.open) : undefined;
      return l ? { lambda: l } : undefined;
    };
    const keys: Export[] = [];
    const [, , value, bang, values] = items;
    if (items.length === 3 && isGroup(value) && opens(value.items[0], "[")) {
      if (value.items.length !== 1) {
        out.export = { at };
        return;
      }
      for (const s of segments(value.items[0].items)) {
        const [k, op] = s;
        const name = nameOf(k);
        if (!name || word(op) !== ":") continue;
        const t = target(s.slice(2));
        keys.push({
          key: word(name),
          start: name.start,
          end: name.end,
          ...(t ? { target: t } : {}),
        });
      }
      out.export = { at, keys };
    } else if (
      items.length === 5 &&
      isSymbol(value) &&
      word(bang) === "!" &&
      opens(values, "(")
    ) {
      const els = elements(value);
      const vs = segments(values.items);
      if (els.length !== vs.length) {
        out.export = { at };
        return;
      }
      els.forEach((e, n) => {
        const t = target(vs[n]);
        keys.push({
          key: e.text,
          start: e.start,
          end: e.end,
          ...(t ? { target: t } : {}),
        });
      });
      out.export = { at, keys };
    } else {
      out.export = { at };
    }
  }

  // Parameters and locals, now every lambda's names are known
  for (const e of entries) {
    const l = e.lambda;
    if (!l || e.declares || e.column || e.key || e.assign !== ":") continue;
    if (e.text.includes(".") || keywords.has(e.text)) continue;
    l.locals.add(e.text);
  }
  // Implicit parameters: x, y and z up to the highest used, but not as a
  // column or a key, which q compiles to symbols
  const highest = new Map<Lambda, number>();
  for (const e of entries) {
    if (!e.lambda || e.column || e.key) continue;
    const n = ["x", "y", "z"].indexOf(e.text) + 1;
    if (n > (highest.get(e.lambda) ?? 0)) highest.set(e.lambda, n);
  }
  for (const l of out.lambdas) {
    if (l.implicit) {
      l.params = ["x", "y", "z"].slice(0, Math.max(highest.get(l) ?? 0, 1));
    }
    for (const p of l.params) l.locals.delete(p);
  }

  const scoped = (e: Entry, name: string) => {
    const l = e.lambda;
    if (!l || name.includes(".")) return undefined;
    if (l.params.includes(name)) return "param" as const;
    if (l.locals.has(name)) return "local" as const;
    return undefined;
  };
  // Modules bound to globals, by full name, and to locals, by lambda
  const globalModules = new Map<string, string>();
  const localModules = new Map<Lambda, Map<string, string>>();
  for (const { entry, module } of bindings) {
    if (scoped(entry, entry.text) && entry.lambda) {
      const m = localModules.get(entry.lambda) ?? new Map<string, string>();
      m.set(entry.text, module);
      localModules.set(entry.lambda, m);
    } else {
      globalModules.set(join(entry.namespace, entry.text), module);
    }
  }
  // The module bound to the name, local or global, and the global's name
  const boundTo = (e: Entry) => {
    if (scoped(e, e.text)) {
      const module = e.lambda && localModules.get(e.lambda)?.get(e.text);
      return module ? { module } : undefined;
    }
    const via = join(e.namespace, e.text);
    const module = globalModules.get(via);
    return module ? { module, via } : undefined;
  };
  // A dotted name's export: m.f, where m, a global, is bound. q never reads
  // a dotted name through a local
  const exportOf = (e: Entry) => {
    const full = join(e.namespace, e.text);
    for (let dot = full.lastIndexOf("."); dot > 0; ) {
      const module = globalModules.get(full.slice(0, dot));
      if (module) {
        const via = full.slice(0, dot);
        return { module, via, key: full.slice(dot + 1).split(".")[0] };
      }
      dot = full.lastIndexOf(".", dot - 1);
    }
    return undefined;
  };

  for (const e of entries) {
    const w = e.text;
    const base = {
      token: e.token,
      ...(e.lambda ? { lambda: e.lambda } : {}),
    };
    const defines = e.assign || e.declares ? { defines: true as const } : {};
    const local = scoped(e, w);
    const exported = w.includes(".") ? exportOf(e) : undefined;
    let name: Name;
    if (e.declares) {
      name = { ...base, role: "param", full: w, ...defines };
    } else if (keywords.has(w) && (e.query || !queryWords.has(w))) {
      name = { ...base, role: "builtin", full: w };
    } else if (e.key) {
      name = { ...base, role: e.key, full: w, ...defines };
    } else if (e.column) {
      name = {
        ...base,
        role: "column",
        full: w,
        ...(w === "i"
          ? {}
          : {
              variable: local
                ? { role: local, full: w }
                : { role: "global", full: join(e.namespace, w) },
            }),
        ...defines,
      };
    } else if (exported) {
      name = {
        ...base,
        role: "export",
        full: exported.key,
        module: exported.module,
        via: exported.via,
      };
    } else if (local) {
      name = { ...base, role: local, full: w, ...defines };
    } else {
      name = {
        ...base,
        role: "global",
        full: join(e.namespace, w),
        ...defines,
      };
    }
    out.names.push(name);
  }

  for (const { entry, element } of reached) {
    const bound = boundTo(entry);
    if (!bound) continue;
    out.handles.push({
      start: element.start,
      end: element.end,
      full: element.text,
      ...bound,
      ...(entry.lambda ? { lambda: entry.lambda } : {}),
    });
  }
  out.handles.sort((a, b) => a.start - b.start);
  return out;
}
