// Compares the console text with q's for random values from fuzz.q, which
// needs q on the path. Not part of npm test: run npm run fuzz [seed]

const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { decode } = require("../../out/codec/decode");
const { show } = require("../../out/format/console");

const seed = process.argv[2] ?? String(Date.now() % 100000);
const dir = mkdtempSync(path.join(tmpdir(), "fuzz-"));
const out = path.join(dir, "fuzz.json");
let fuzz;
try {
  execFileSync("q", ["fuzz.q", seed, out, "-q"], {
    cwd: __dirname,
    stdio: ["ignore", "inherit", "inherit"],
  });
  fuzz = JSON.parse(readFileSync(out, "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// At the size q showed them
const [lines, width] = fuzz.size;
const size = { lines, width };
const values = fuzz.values;
const wrong = values.filter((v) => {
  const ours = show(decode(Buffer.from(v.bytes, "hex")), size);
  // q ends the last line with a newline
  v.ours = ours;
  return ours !== v.console.replace(/\n$/, "");
});
for (const v of wrong.slice(0, 10)) {
  console.log(`bytes ${v.bytes}\nq:\n${v.console}ours:\n${v.ours}\n`);
}
console.log(`seed ${seed}: ${wrong.length} of ${values.length} differ`);
process.exitCode = wrong.length ? 1 : 0;
