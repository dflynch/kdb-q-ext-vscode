// Evaluates the extension on TorQ and its Finance Starter Pack, at pinned
// commits, against TorQ's own processes on this machine:
// - truth.q asks every process for its lambdas through q's `value f` (name,
//   file, line, the globals each uses); navigation.test.js asks our providers
//   at every use and scores them against that
// - scenario.mjs drives VS Code through a developer's task (vwap.q, added to
//   the gateway) with every feature, timed and screenshotted
// Needs q (~/.kx/bin/q or on the path), macOS (TorQ's mac start scripts),
// git, and network for the first clone. Not part of npm test:
//   npm run evaluate [-- part ...]   parts: setup, truth, navigation,
//                                    scenario (all by default), stop
// Everything it makes is under .vscode-test/evaluation; results in results/.

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const dir = path.join(repo, ".vscode-test", "evaluation");
const deploy = path.join(dir, "deploy");
const results = path.join(dir, "results");

// Pinned so every run measures the same code
const TORQ = {
  url: "https://github.com/DataIntellectTech/TorQ.git",
  commit: "4be4fc3457bf1a838e976ff2e9892b2babe8c1c3",
};
const FSP = {
  url: "https://github.com/DataIntellectTech/TorQ-Finance-Starter-Pack.git",
  commit: "50fcd5ad6d8e50fcd71965010ce38a1fccdad87b",
};

// Every process type the FSP's process.csv lists but kill (it stops the
// others) and tickerlogreplay (it replays a log and exits)
const CORE = [
  6000, 6001, 6002, 6003, 6004, 6005, 6006, 6007, 6011, 6014, 6015, 6016, 6017,
  6018,
];
const EXTRA = [6009, 6012, 6013, 6020, 6021, 6022, 6023];
const PORTS = [...CORE, ...EXTRA];

const qbin = fs.existsSync(path.join(os.homedir(), ".kx", "bin", "q"))
  ? path.join(os.homedir(), ".kx", "bin")
  : "";
const env = {
  ...process.env,
  PATH: qbin ? `${qbin}:${process.env.PATH}` : process.env.PATH,
  // stops setenv.sh downloading a CA bundle on every start
  SSL_CA_CERT_FILE: process.env.SSL_CA_CERT_FILE ?? "/etc/ssl/cert.pem",
};
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", env, ...opts });

function clone({ url, commit }, to) {
  if (!fs.existsSync(to)) run("git", ["clone", "--quiet", url, to]);
  run("git", ["-C", to, "checkout", "--quiet", commit]);
}

// TorQ, then the FSP over it, as TorQ's app install does; a git repo with the
// pristine state committed, so git diff lists what a run changed
function makeDeploy() {
  fs.rmSync(deploy, { recursive: true, force: true });
  for (const from of ["torq", "fsp"])
    fs.cpSync(path.join(dir, from), deploy, {
      recursive: true,
      filter: (f) => path.basename(f) !== ".git",
    });
  run("git", ["init", "--quiet"], { cwd: deploy });
  run("git", ["add", "-A"], { cwd: deploy });
  run(
    "git",
    [
      "-c",
      "user.name=evaluate",
      "-c",
      "user.email=evaluate@example.com",
      "commit",
      "--quiet",
      "-m",
      "as cloned",
    ],
    {
      cwd: deploy,
    },
  );
}

const listening = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

async function waitFor(ports, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const down = [];
    for (const p of ports) if (!(await listening(p))) down.push(p);
    if (!down.length) return;
    if (Date.now() > until)
      throw new Error(`TorQ: nothing listening on ${down.join(", ")}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// The q processes started from the deploy folder (an HDB runs in its
// database's folder)
function ours() {
  const r = spawnSync("pgrep", ["-x", "q"], { encoding: "utf8" });
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .filter((pid) => {
      const c = spawnSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
        encoding: "utf8",
      }).stdout;
      return c
        .split("\n")
        .some((l) => l === `n${deploy}` || l.startsWith(`n${deploy}/`));
    });
}

// Stopped processes free their ports a moment later
async function stop() {
  const pids = ours();
  if (pids.length) run("kill", pids);
  const until = Date.now() + 10000;
  for (;;) {
    const taken = [];
    for (const p of PORTS) if (await listening(p)) taken.push(p);
    if (!taken.length) break;
    if (Date.now() > until)
      throw new Error(
        `ports ${taken.join(", ")} are taken by something else: stop it first (lsof -nP -iTCP:${taken[0]})`,
      );
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`evaluate: stopped ${pids.length} TorQ processes`);
}

async function setup() {
  fs.mkdirSync(dir, { recursive: true });
  clone(TORQ, path.join(dir, "torq"));
  clone(FSP, path.join(dir, "fsp"));
  await stop();
  makeDeploy();
  fs.mkdirSync(path.join(deploy, "logs"), { recursive: true });
  run("bash", ["start_torq_demo_mac.sh"], { cwd: deploy, stdio: "ignore" });
  run("bash", ["start_torq_demo_mac_extra.sh"], {
    cwd: deploy,
    stdio: "ignore",
  });
  run(
    "bash",
    [
      "-c",
      ". ./setenv.sh >/dev/null 2>&1; bash torq.sh start filealerter1 dqc1 dqcdb1 dqe1 dqedb1",
    ],
    {
      cwd: deploy,
      stdio: "ignore",
    },
  );
  await waitFor(PORTS, 60000);
  console.log(`evaluate: TorQ up on ${PORTS.length} ports`);
}

function truth() {
  fs.mkdirSync(results, { recursive: true });
  const q = (script, args) =>
    run("q", [path.join(__dirname, script), ...args, "-q"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  q("truth.q", [
    "-root",
    `${deploy}/`,
    "-out",
    path.join(results, "truth.json"),
    "-ports",
    ...PORTS.map(String),
  ]);
  q("keywords.q", ["-out", path.join(results, "keywords.json")]);
}

function navigation() {
  run(
    "npx",
    [
      "vscode-test",
      "--config",
      path.join(__dirname, "evaluate.vscode-test.mjs"),
    ],
    { cwd: repo },
  );
  const s = JSON.parse(
    fs.readFileSync(path.join(results, "navigation.json"), "utf8"),
  ).summary;
  console.log(JSON.stringify(s, null, 1));
}

function scenario() {
  run("node", [path.join(__dirname, "scenario.mjs")], { cwd: repo });
}

const parts = { setup, truth, navigation, scenario, stop };
(async () => {
  const asked = process.argv.slice(2);
  for (const p of asked.length
    ? asked
    : ["setup", "truth", "navigation", "scenario"]) {
    if (!parts[p])
      throw new Error(`no part ${p}: ${Object.keys(parts).join(", ")}`);
    await parts[p]();
  }
})().catch((e) => {
  console.error(`evaluate: ${e.message}`);
  process.exit(1);
});
