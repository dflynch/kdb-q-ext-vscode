// Writes src/builtins.ts, the hover's entries for q's keywords and the .Q,
// .z, .h and .j namespaces, from KX's reference at a pinned commit of
// https://github.com/KxSystems/docs (CC BY 4.0): each name's syntax, a line
// saying what it is, and its page on code.kx.com. Run by hand when the
// reference changes, after moving the commit:
//   npm run builtins
// It fails, rather than writing an entry without syntax or a line, or with
// a link to a page or section that doesn't exist, or skipping a heading it
// can't read, and lists each one to fix.
import { writeFileSync } from "node:fs";

const commit = "70279f6b947161c57ef8fe207f796494dc3d8651";
const raw = (path) =>
  `https://raw.githubusercontent.com/KxSystems/docs/${commit}/docs/${path}`;
const site = "https://code.kx.com/q/";

const pages = new Map();
async function page(path) {
  if (!pages.has(path)) {
    const response = await fetch(raw(path));
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    pages.set(path, (await response.text()).split(/\r?\n/));
  }
  return pages.get(path);
}

// The lines of a page's ## section headed by the name in backticks, else of
// the whole page. Headings with nothing between them share the section
// after the last, as .Q.dpft's and .Q.dpfts's do
function section(lines, name) {
  const heading = (l) => /^##\s/.test(l) && l.includes(`\`${name}\``);
  const start = name ? lines.findIndex(heading) : -1;
  if (start < 0) return lines;
  let body = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      if (body) {
        end = i;
        break;
      }
    } else if (lines[i].trim()) body = true;
  }
  return lines.slice(start, end);
}

// The first syntax block in the lines, without its fences or the indent its
// lines share; only the lines naming it, if some do, as one block may give
// several names' syntax
function syntax(lines, name) {
  const open = lines.findIndex((l) => /^```(syntax|\{\.syntax)/.test(l));
  if (open < 0) return undefined;
  const close = lines.findIndex((l, i) => i > open && /^```/.test(l));
  const block = lines.slice(open + 1, close < 0 ? undefined : close);
  const indent = Math.min(
    ...block.filter((l) => l.trim()).map((l) => l.search(/\S/)),
  );
  const all = block.map((l) => l.slice(indent).trimEnd());
  const named = new RegExp(
    `(^|[^\\w.])${name.replace(/\./g, "\\.")}(?![\\w.])`,
  );
  const own = all.filter((l) => named.test(l));
  return (own.length ? own : all).join("\n").trim();
}

// The section's line in italics, as _Ascending sort_
const italic = (lines) =>
  lines
    .find((l) => /^_[^_].*_\s*$/.test(l))
    ?.trim()
    .slice(1, -1);

// Names q has that the reference's index leaves out, and qSQL's templates,
// whose pages write their syntax in HTML. Syntax as the page writes it; a
// page only for a name the reference has no entry for
const overrides = {
  select: {
    syntax: "select [Lexp] [ps] [by pb] from texp [where pw]",
  },
  exec: {
    syntax: "exec [distinct] ps [by pb] from texp [where pw]",
  },
  update: {
    syntax: "update ps [by pb] from texp [where pw]",
  },
  from: {
    page: "ref/select.md",
    summary: "the table a qSQL query reads",
    syntax: "select … from t",
  },
  by: {
    page: "ref/select.md",
    summary: "the groups of a qSQL query",
    syntax: "select … by … from t",
  },
  use: {
    page: "ref/dotm.md",
    anchor: "modules",
    summary: "load a module",
    syntax: "use`module",
  },
  // The page writes z.ws:f, without its dot
  ".z.ws": { syntax: ".z.ws:f" },
  ".Q.addmonths": { summary: "add months" },
};

const entries = new Map();
// Headings naming an entry the script can't read
const unread = [];
const add = (name, entry) => {
  if (!entries.has(name)) entries.set(name, entry);
};

// Keywords: name(s), page#anchor, line, category, kind
for (const row of (await page("ref/ref.csv")).filter(Boolean)) {
  const [names, link, summary] = row.split(",");
  const [file, anchor] = link.split("#");
  const lines = await page(`ref/${file}`);
  for (const name of names.split(" ")) {
    const own = section(
      lines,
      anchor ? name : names.includes(" ") ? undefined : name,
    );
    add(name, {
      syntax: syntax(own, name) ?? syntax(lines, name),
      summary: summary || italic(own),
      url: `${site}ref/${file.replace(/\.md$/, "/")}${anchor ? `#${anchor}` : ""}`,
    });
  }
}

// The namespaces: a ## section for each name, or names sharing it, headed
// `name` (what it is) or `name` `name` (what they are)
const namespaces = [
  ["ref/dotq.md", ".Q."],
  ["ref/dotz.md", ".z."],
  ["ref/doth.md", ".h."],
  ["ref/dotj.md", ".j."],
];
for (const [file, prefix] of namespaces) {
  const lines = await page(file);
  for (const heading of lines) {
    if (!/^## `/.test(heading)) continue;
    const m = heading.match(/^## ((?:`[^`]+`\s*)+)(?:\((.*)\))?\s*$/);
    if (!m) {
      unread.push(`${file}: ${heading}`);
      continue;
    }
    for (const [, written] of m[1].matchAll(/`([^`]+)`/g)) {
      const name = written.startsWith(".") ? written : `${prefix}${written}`;
      if (!name.startsWith(prefix)) continue;
      const own = section(lines, written);
      add(name, {
        // A value, as .z.a, has none: it's its name
        syntax: syntax(own, name) ?? name,
        summary: m[2] ?? italic(own),
        url: `${site}${file.replace(/\.md$/, "/")}#${anchorOf(heading)}`,
      });
    }
  }
}

// MkDocs' anchor for a heading, as Python-Markdown's slugify makes it:
// without anything but letters, digits, underscores, dashes and spaces,
// trimmed, lower case, each run of dashes and spaces one dash
function anchorOf(heading) {
  return heading
    .replace(/^#+\s*/, "")
    .normalize("NFKD")
    .replace(/\P{ASCII}/gu, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-");
}

// A page's headings, without lines in a fenced code block
function headings(lines) {
  const out = [];
  let fence;
  for (const l of lines) {
    const f = l.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = undefined;
    } else if (f) fence = f;
    else if (/^#+\s/.test(l)) out.push(l);
  }
  return out;
}

// Each override's fields in place of the reference's; one that changes
// nothing, or a new entry without a page, is a mistake
const overridden = [];
for (const [name, o] of Object.entries(overrides)) {
  const known = entries.get(name);
  const url =
    o.page &&
    `${site}${o.page.replace(/\.md$/, "/")}${o.anchor ? `#${o.anchor}` : ""}`;
  const e = {
    syntax: o.syntax ?? known?.syntax,
    summary: o.summary ?? known?.summary,
    url: url ?? known?.url,
  };
  if (!e.url) overridden.push(`${name}: no page`);
  for (const field of ["syntax", "summary", "url"]) {
    if (
      known &&
      known[field] &&
      e[field] === known[field] &&
      (field === "url" ? url : o[field])
    ) {
      overridden.push(`${name}: its ${field} is the reference's`);
    }
  }
  entries.set(name, e);
}

// Each entry's page must exist, and its anchor be one of the page's headings
const broken = [];
for (const [name, e] of entries) {
  const [path, anchor] = e.url.slice(site.length).split("#");
  const lines = await page(`${path.replace(/\/$/, "")}.md`).catch(
    () => undefined,
  );
  if (!lines) broken.push(`${name}: no page ${path}`);
  else if (anchor && !headings(lines).some((l) => anchorOf(l) === anchor)) {
    broken.push(`${name}: no #${anchor} on ${path}`);
  }
}

const missing = [
  ...unread.map((h) => `unread heading ${h}`),
  ...overridden,
  ...broken,
  ...[...entries]
    .filter(([, e]) => !e.syntax || !e.summary)
    .map(([name, e]) => `${name}: no ${e.syntax ? "line" : "syntax"}`),
];
if (missing.length) {
  console.error(missing.join("\n"));
  process.exit(1);
}

const sorted = [...entries].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
writeFileSync(
  new URL("../src/builtins.ts", import.meta.url),
  `// Generated by scripts/builtins.mjs from KX's reference, KxSystems/docs at
// ${commit}, under CC BY 4.0, excerpted: don't edit
// by hand. See NOTICE.

export type Builtin = { syntax: string; summary: string; url: string };

export const builtins: ReadonlyMap<string, Builtin> = new Map([
${sorted.map(([name, e]) => `  [${JSON.stringify(name)}, ${JSON.stringify(e)}],`).join("\n")}
]);
`,
);
console.log(`${entries.size} entries`);
