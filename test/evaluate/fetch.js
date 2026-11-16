// TorQ and its Finance Starter Pack at pinned commits, deployed as TorQ's app
// install does, under .vscode-test/evaluation: for the navigation tests,
// which npm test runs, and for npm run evaluate. A clone already at its
// commit isn't fetched again, so only the first run needs the network.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const dir = path.join(repo, ".vscode-test", "evaluation");
const deploy = path.join(dir, "deploy");

// Pinned so every run measures the same code, and truth.json stays true
const TORQ = {
  url: "https://github.com/DataIntellectTech/TorQ.git",
  commit: "4be4fc3457bf1a838e976ff2e9892b2babe8c1c3",
};
const FSP = {
  url: "https://github.com/DataIntellectTech/TorQ-Finance-Starter-Pack.git",
  commit: "50fcd5ad6d8e50fcd71965010ce38a1fccdad87b",
};

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }).trim();

// Only the pinned commit, as GitHub serves a commit by its hash
function clone({ url, commit }, to) {
  try {
    if (git(["-C", to, "rev-parse", "HEAD"]) === commit) return;
  } catch {
    // not a clone yet
  }
  git(["init", "--quiet", to]);
  git(["-C", to, "fetch", "--quiet", "--depth", "1", url, commit]);
  git(["-C", to, "checkout", "--quiet", commit]);
}

// TorQ, then the FSP over it, as TorQ's app install does
function fetch() {
  fs.mkdirSync(dir, { recursive: true });
  clone(TORQ, path.join(dir, "torq"));
  clone(FSP, path.join(dir, "fsp"));
  fs.rmSync(deploy, { recursive: true, force: true });
  for (const from of ["torq", "fsp"])
    fs.cpSync(path.join(dir, from), deploy, {
      recursive: true,
      filter: (f) => path.basename(f) !== ".git",
    });
}

module.exports = { fetch, dir, deploy };
