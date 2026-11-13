// Part A: navigation scored against q's own `value f` on TorQ.
// Run inside VS Code's test host with the TorQ deploy as the workspace; asks
// our providers through VS Code's commands, as a user's keystrokes would.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const EVAL = process.env.EVALUATION_DIR;
const RESULTS = path.join(EVAL, "results");
const ROOT = path.join(EVAL, "deploy");

const BUILTIN_NS = /^\.(q|Q|h|j|o|z)\./;

// --- reading q's answers -------------------------------------------------

// q names an inner lambda after its parent with a trailing @: not a name in source
const plainName = (s) =>
  typeof s !== "string" || s.endsWith("@")
    ? ""
    : s.startsWith("..")
      ? s.slice(2)
      : s;

// a global as written, in the lambda's context, to its full name
function resolveName(written, context) {
  if (written.startsWith(".")) return written;
  return context ? `.${context}.${written}` : written;
}

function loadTruth() {
  const rows = JSON.parse(
    fs.readFileSync(path.join(RESULTS, "truth.json"), "utf8"),
  );
  const lambdas = new Map(); // file|line|source -> lambda
  for (const r of rows) {
    const key = `${r.file}|${r.line}|${r.source}`;
    let l = lambdas.get(key);
    if (!l) {
      l = {
        file: r.file,
        line: Number(r.line),
        source: r.source,
        context: r.context || "",
        name: plainName(r.name),
        globals: (r.globals || []).filter((g) => g !== ""),
        paths: new Set(),
        procs: new Set(),
      };
      lambdas.set(key, l);
    }
    l.paths.add(r.path);
    l.procs.add(r.procname);
  }
  return [...lambdas.values()];
}

// --- reading the files as q does, enough to find tokens ------------------

const texts = new Map();
function text(file) {
  if (!texts.has(file)) texts.set(file, fs.readFileSync(file, "utf8"));
  return texts.get(file);
}
function lineStarts(t) {
  const s = [0];
  for (let i = 0; i < t.length; i++) if (t[i] === "\n") s.push(i + 1);
  return s;
}
const starts = new Map();
function lineOf(file, offset) {
  if (!starts.has(file)) starts.set(file, lineStarts(text(file)));
  const s = starts.get(file);
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - s[lo] }; // 0-based
}
function offsetOf(file, line0) {
  if (!starts.has(file)) starts.set(file, lineStarts(text(file)));
  return starts.get(file)[line0] ?? text(file).length;
}

// Where the lambda's source sits in its file. q keeps the source from the
// `{` on q's line, with trailing whitespace stripped and each continuation
// line's first character made a space (checked on all of TorQ's lambdas), so
// a source offset maps to the file line by line, column for column.
function locate(l) {
  if (l.file.endsWith(".k")) return null;
  const lines = l.source.split("\n");
  const L = l.line - 1;
  const first = text(l.file).slice(
    offsetOf(l.file, L),
    offsetOf(l.file, L + 1),
  );
  const shift = first.indexOf(lines[0].trimEnd());
  if (shift < 0) return null;
  const lineStart = [];
  let o = 0;
  for (const s of lines) {
    lineStart.push(o);
    o += s.length + 1;
  }
  const map = (off) => {
    let i = lineStart.length - 1;
    while (lineStart[i] > off) i--;
    return (
      offsetOf(l.file, L + i) + (off - lineStart[i]) + (i === 0 ? shift : 0)
    );
  };
  return {
    start: map(0),
    end: map(l.source.length - 1) + 1,
    map,
    line: l.line,
  };
}

// Code spans of a lambda's own source: skip strings, comments and inner
// lambdas (q lists their globals with them, scored on their own)
function codeMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "/" && (i === 0 || /\s/.test(src[i - 1]))) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "{") depth++;
    if (depth <= 1) mask[i] = 1;
    if (c === "}") depth--;
    i++;
  }
  return mask;
}

function literal(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Every place `name` stands as a token in code (not a symbol, string or comment)
function tokens(src, name, mask) {
  const re = new RegExp(
    `(?<![A-Za-z0-9_.\`])${literal(name)}(?![A-Za-z0-9_]|\\.[A-Za-z])`,
    "g",
  );
  const out = [];
  for (const m of src.matchAll(re)) if (mask[m.index]) out.push(m.index);
  return out;
}

// --- asking VS Code ------------------------------------------------------

const uri = (f) => vscode.Uri.file(f);
function norm(locs) {
  if (!locs) return [];
  const arr = Array.isArray(locs) ? locs : [locs];
  return arr.map((x) => {
    const u = x.targetUri ?? x.uri;
    const r = x.targetSelectionRange ?? x.targetRange ?? x.range;
    return {
      file: u.fsPath,
      line: r.start.line + 1,
      character: r.start.character,
    };
  });
}
async function timed(fn) {
  const t0 = performance.now();
  const v = await fn();
  return { v, ms: performance.now() - t0 };
}
const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    median: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
};

// A definition we give matches q's if it's in the same file, on q's line or
// up to three lines above (q's line is the lambda's; the name may sit above)
const matches = (ours, truth) =>
  ours.file === truth.file &&
  ours.line <= truth.line &&
  ours.line >= truth.line - 3;

const rel = (f) => path.relative(ROOT, f);

// Does the line assign the name (in full, or its last part under \d)?
function assigns(file, line, name) {
  const t = text(file).slice(offsetOf(file, line - 1), offsetOf(file, line));
  const last = name.split(".").pop();
  const n = `(${literal(name)}|${literal(last)})`;
  return (
    new RegExp(`(?<![A-Za-z0-9_.\`])${n}\\s*::?(?!:)`).test(t) ||
    new RegExp(`\`${n}\\s+set\\b|(?<![A-Za-z0-9_.])set\\s*\\[\\s*\`${n}`).test(
      t,
    )
  );
}

suite("TorQ navigation, scored against q", function () {
  this.timeout(0);
  const out = {
    versions: { vscode: vscode.version },
    timing: {},
    definition: {},
    references: {},
    symbols: {},
    hover: {},
  };
  const cases = { definition: [], references: [], symbols: [], hover: [] };
  let lambdas;
  const defs = new Map(); // full name -> [{file,line}]
  const boundTo = new Map(); // namespace path -> lambdas bound there
  const entries = new Set(); // dictionaries of lambdas
  const runtime = new Set(); // names q bound while running

  suiteSetup(async () => {
    lambdas = loadTruth();
    for (const l of lambdas) {
      l.at = locate(l);
      // an entry of a dictionary of lambdas (err[`func]:{…}): q names it
      // after the dictionary, but it's an amend, not the dictionary's definition
      l.entry = l.name && [...l.paths].every((p) => p.startsWith(`${l.name}.`));
      if (l.entry) entries.add(l.name);
      // q gives the name a lambda was first bound to, also when it was bound
      // while running (.dotz.ws.ORIG:@[.:;…], .stplg.updmsg:.stplg.upd[b]):
      // a definition only where q's line assigns that name in source
      l.runtime = l.name && !l.entry && !assigns(l.file, l.line, l.name);
      if (l.runtime) runtime.add(l.name);
      if (l.name && !l.entry && !l.runtime) {
        if (!defs.has(l.name)) defs.set(l.name, []);
        if (
          !defs.get(l.name).some((d) => d.file === l.file && d.line === l.line)
        )
          defs.get(l.name).push({ file: l.file, line: l.line });
      }
      for (const p of l.paths) {
        if (!boundTo.has(p)) boundTo.set(p, []);
        boundTo.get(p).push(l);
      }
    }
    out.truth = {
      lambdas: lambdas.length,
      files: new Set(lambdas.map((l) => l.file)).size,
      named: defs.size,
      boundWhileRunning: runtime.size,
      sourceNotFound: lambdas.filter((l) => !l.at).length,
      kFiles: lambdas.filter((l) => l.file.endsWith(".k")).length,
    };
    // Time to an index of the whole workspace: first workspace-symbol answer
    const t0 = performance.now();
    for (;;) {
      const s = await vscode.commands.executeCommand(
        "vscode.executeWorkspaceSymbolProvider",
        ".lg.o",
      );
      if (s?.length) break;
      if (performance.now() - t0 > 120000)
        throw new Error("index not ready in 120 s");
      await new Promise((r) => setTimeout(r, 50));
    }
    out.timing.indexReadyMs = Math.round(performance.now() - t0);
  });

  test("definition", async () => {
    const tally = {};
    const bump = (k) => (tally[k] = (tally[k] || 0) + 1);
    const lat = [];
    for (const l of lambdas) {
      if (!l.at) continue;
      const src = l.source;
      const mask = codeMask(src);
      for (const g of new Set(l.globals)) {
        const full = resolveName(g, l.context);
        const c = { lambda: `${rel(l.file)}:${l.line}`, written: g, full };
        const truth = defs.get(full);
        if (!truth) {
          if (runtime.has(full))
            c.bucket = "bound while running (scored by hand)";
          else if (entries.has(full))
            c.bucket = "a dictionary of lambdas (scored by hand)";
          else if (boundTo.has(full))
            c.bucket = "runtime alias (bound under another name)";
          else if (BUILTIN_NS.test(full) || /^\.(q|Q|h|j|o|z)$/.test(full))
            c.bucket = "q built-in";
          else c.bucket = "not a lambda (variable or table)";
        }
        const at = tokens(src, g, mask);
        if (!at.length) {
          c.bucket = c.bucket ?? "name not found as a token in the source";
          bump(c.bucket);
          cases.definition.push(c);
          continue;
        }
        const pos = lineOf(l.file, l.at.map(at[0]));
        pos.character += Math.floor(g.length / 2);
        c.at = `${rel(l.file)}:${pos.line + 1}:${pos.character + 1}`;
        const { v, ms } = await timed(() =>
          vscode.commands.executeCommand(
            "vscode.executeDefinitionProvider",
            uri(l.file),
            new vscode.Position(pos.line, pos.character),
          ),
        );
        lat.push(ms);
        const ours = norm(v);
        c.ours = ours.map((o) => `${rel(o.file)}:${o.line}`);
        if (!truth) {
          c.got = ours.length ? "some" : "none";
          bump(`${c.bucket}: ${c.got}`);
          cases.definition.push(c);
          continue;
        }
        c.truth = truth.map((t) => `${rel(t.file)}:${t.line}`);
        const allFound = truth.every((t) => ours.some((o) => matches(o, t)));
        const anyFound = truth.some((t) => ours.some((o) => matches(o, t)));
        const extras = ours.filter((o) => !truth.some((t) => matches(o, t)));
        if (!ours.length) c.score = "none";
        else if (allFound && !extras.length) c.score = "exact";
        else if (allFound) {
          // extra definitions: are they assignments of the same name in source?
          const last = full.split(".").pop();
          const real = extras.every((o) => {
            const ln = text(o.file).slice(
              offsetOf(o.file, o.line - 1),
              offsetOf(o.file, o.line),
            );
            return (
              new RegExp(`(?<![A-Za-z0-9_])${literal(last)}\\s*:`).test(ln) ||
              /\bset\b/.test(ln)
            );
          });
          c.score = real
            ? "q's, plus other definitions in source"
            : "q's, plus wrong ones";
        } else if (anyFound) c.score = "some of q's";
        else c.score = "wrong";
        bump(c.score);
        cases.definition.push(c);
      }
    }
    out.definition = tally;
    out.timing.definition = stats(lat);
  });

  test("references", async () => {
    // innermost truth lambda containing an offset
    const byFile = new Map();
    for (const l of lambdas) {
      if (!l.at) continue;
      if (!byFile.has(l.file)) byFile.set(l.file, []);
      byFile.get(l.file).push(l);
    }
    const inner = (file, off) => {
      let best = null;
      for (const l of byFile.get(file) ?? [])
        if (
          l.at.start <= off &&
          off < l.at.end &&
          (!best || l.at.end - l.at.start < best.at.end - best.at.start)
        )
          best = l;
      return best;
    };
    // who lists whom
    const usedBy = new Map();
    for (const l of lambdas)
      for (const g of new Set(l.globals)) {
        const full = resolveName(g, l.context);
        if (!usedBy.has(full)) usedBy.set(full, new Set());
        usedBy.get(full).add(l);
      }
    const tally = {
      names: 0,
      expected: 0,
      found: 0,
      missing: 0,
      extra: {},
      outsideLoaded: 0,
    };
    const lat = [];
    for (const [name, ds] of defs) {
      // ask from the definition's own line: the name as written there
      const d = ds[0];
      const last = name.split(".").pop();
      const ln0 = d.line - 1;
      const lineText = text(d.file).slice(
        offsetOf(d.file, ln0),
        offsetOf(d.file, ln0 + 1),
      );
      const m = new RegExp(
        `(?<![A-Za-z0-9_\`])(${literal(name)}|${literal(last)})\\s*:`,
      ).exec(lineText);
      if (!m) {
        cases.references.push({ name, skipped: "name not on q's line" });
        continue;
      }
      const pos = new vscode.Position(
        ln0,
        m.index + Math.floor(m[1].length / 2),
      );
      const { v, ms } = await timed(() =>
        vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",
          uri(d.file),
          pos,
        ),
      );
      lat.push(ms);
      tally.names++;
      const ours = norm(v);
      // a location that is the defined name on its own line, as `name:`
      const named = (o) => {
        const t = text(o.file).slice(
          offsetOf(o.file, o.line - 1) + o.character,
        );
        return new RegExp(`^(${literal(name)}|${literal(last)})\\s*:`).test(t);
      };
      const expected = [...(usedBy.get(name) ?? [])].filter((l) => l.at);
      const hit = new Set();
      const c = { name, missing: [], extra: [] };
      for (const o of ours) {
        const off = offsetOf(o.file, o.line - 1) + o.character;
        // q's definitions themselves: the name as written on q's line
        if (ds.some((t) => o.file === t.file && o.line === t.line && named(o)))
          continue;
        const l = byFile.has(o.file) ? inner(o.file, off) : null;
        if (!l) {
          tally.outsideLoaded++;
          continue;
        }
        if (expected.includes(l)) {
          hit.add(l);
          continue;
        }
        const before = text(o.file)[off - 1];
        const kind =
          before === "`"
            ? "symbol (`name), q doesn't list"
            : /\b(select|exec|update|delete)\b/.test(l.source)
              ? "qSQL, unconfirmed by q"
              : "extra";
        tally.extra[kind] = (tally.extra[kind] || 0) + 1;
        c.extra.push({
          at: `${rel(o.file)}:${o.line}:${o.character + 1}`,
          kind,
        });
      }
      for (const l of expected) {
        tally.expected++;
        if (hit.has(l)) tally.found++;
        else {
          tally.missing++;
          c.missing.push(`${rel(l.file)}:${l.line}`);
        }
      }
      if (c.missing.length || c.extra.length) cases.references.push(c);
    }
    out.references = tally;
    out.timing.references = stats(lat);
  });

  test("workspace symbols", async () => {
    const tally = { found: 0, missing: 0 };
    for (const [name, ds] of defs) {
      const s =
        (await vscode.commands.executeCommand(
          "vscode.executeWorkspaceSymbolProvider",
          name,
        )) ?? [];
      const ok = ds.every((d) =>
        s.some((x) => {
          const full =
            x.containerName && !x.name.startsWith(".")
              ? `${x.containerName}.${x.name}`
              : x.name;
          return (
            (x.name === name || full === name) &&
            matches(norm(x.location)[0], d)
          );
        }),
      );
      if (ok) tally.found++;
      else {
        tally.missing++;
        cases.symbols.push({
          name,
          truth: ds.map((d) => `${rel(d.file)}:${d.line}`),
          got: s
            .slice(0, 5)
            .map(
              (x) =>
                `${x.containerName ?? ""}|${x.name} ${rel(x.location.uri.fsPath)}:${x.location.range.start.line + 1}`,
            ),
        });
      }
    }
    out.symbols = tally;
  });

  test("hover", async () => {
    const tally = {
      own: { shown: 0, empty: 0 },
      builtin: { withLink: 0, without: 0, notUsed: 0 },
    };
    const lat = [];
    const hoverText = (hs) =>
      (hs ?? [])
        .flatMap((h) =>
          h.contents.map((c) => (typeof c === "string" ? c : c.value)),
        )
        .join("\n");
    // own functions, hovered where they're used
    for (const l of lambdas) {
      if (!l.at) continue;
      const mask = codeMask(l.source);
      for (const g of new Set(l.globals)) {
        const full = resolveName(g, l.context);
        if (!defs.has(full) || l.hovered?.has(full)) continue;
        const at = tokens(l.source, g, mask);
        if (!at.length) continue;
        const pos = lineOf(l.file, l.at.map(at[0]));
        const { v, ms } = await timed(() =>
          vscode.commands.executeCommand(
            "vscode.executeHoverProvider",
            uri(l.file),
            new vscode.Position(
              pos.line,
              pos.character + Math.floor(g.length / 2),
            ),
          ),
        );
        lat.push(ms);
        const t = hoverText(v);
        if (t.trim()) tally.own.shown++;
        else {
          tally.own.empty++;
          cases.hover.push({
            own: full,
            at: `${rel(l.file)}:${pos.line + 1}:${pos.character + 1}`,
          });
        }
        l.hovered = (l.hovered ?? new Set()).add(full);
      }
    }
    // q's words, at their first use in a loaded file's code
    const words = JSON.parse(
      fs.readFileSync(path.join(RESULTS, "keywords.json"), "utf8"),
    );
    for (const w of words) {
      let found = null;
      for (const l of lambdas) {
        if (!l.at) continue;
        const at = tokens(l.source, w, codeMask(l.source));
        if (at.length) {
          found = { l, off: l.at.map(at[0]) };
          break;
        }
      }
      if (!found) {
        tally.builtin.notUsed++;
        continue;
      }
      const pos = lineOf(found.l.file, found.off);
      const v = await vscode.commands.executeCommand(
        "vscode.executeHoverProvider",
        uri(found.l.file),
        new vscode.Position(pos.line, pos.character + Math.floor(w.length / 2)),
      );
      const t = hoverText(v);
      if (/code\.kx\.com/.test(t)) tally.builtin.withLink++;
      else {
        tally.builtin.without++;
        cases.hover.push({
          builtin: w,
          at: `${rel(found.l.file)}:${pos.line + 1}:${pos.character + 1}`,
          got: t.slice(0, 120),
        });
      }
    }
    out.hover = tally;
    out.timing.hover = stats(lat);
  });

  test("completion latency, largest file", async () => {
    const files = [...new Set(lambdas.map((l) => l.file))];
    const largest = files.sort((a, b) => text(b).length - text(a).length)[0];
    const doc = await vscode.workspace.openTextDocument(uri(largest));
    const lat = [];
    for (let i = 1; i <= 20; i++) {
      const line = Math.floor((doc.lineCount * i) / 21);
      const pos = new vscode.Position(line, doc.lineAt(line).text.length);
      lat.push(
        (
          await timed(() =>
            vscode.commands.executeCommand(
              "vscode.executeCompletionItemProvider",
              doc.uri,
              pos,
            ),
          )
        ).ms,
      );
    }
    out.timing.completion = {
      file: rel(largest),
      bytes: text(largest).length,
      ...stats(lat),
    };
  });

  suiteTeardown(() => {
    fs.writeFileSync(
      path.join(RESULTS, "navigation.json"),
      JSON.stringify({ summary: out, cases }, null, 1),
    );
    assert.ok(true);
  });
});
