// Part B, step 2 of the TorQ evaluation: the developer agent's route as a
// repeatable script. A developer adds .ana.vwap (vwap.q) to the TorQ Finance
// Starter Pack and checks it through every feature, on the TorQ servers
// npm run evaluate starts. Each step is timed, screenshotted and checked
// against what the page shows; results/scenario.json and scenario.md.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const evaluation = path.join(repo, ".vscode-test", "evaluation");
const deploy = path.join(evaluation, "deploy");
const results = path.join(evaluation, "results");
const shots = path.join(results, "scenario");
const VSCODE = process.env.DRIVE_VSCODE ?? "1.146.0";
const PASSWORD = "admin"; // TorQ's access list as shipped

// What the developer starts with: the servers, as the Servers view saves them
const server = (port, more = {}) => ({
  host: "localhost",
  port,
  user: "admin",
  auth: "store",
  timeout: 2000,
  ...more,
});
const settings = {
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "extensions.autoCheckUpdates": false,
  "chat.disableAIFeatures": true,
  "debug.javascript.enableNetworkView": false,
  // macOS draws native menus and dialogs outside the page
  "window.menuStyle": "custom",
  "files.simpleDialog.enable": true,
  // the terminal's text in the page, to read the q terminal's output
  "terminal.integrated.gpuAcceleration": "off",
  "kdb-q-ext-vscode.servers": {
    rdb1: server(6002),
    hdb1: server(6003),
    gateway1: server(6007),
    // F1: TorQ's gateway answers with -30!, which drops protected evaluation's reply
    "gateway1 plain": server(6007, { protect: false }),
  },
};

const steps = [];
let page;
let app;
let n = 0;

async function shot(name) {
  const f = path.join(shots, `${String(++n).padStart(3, "0")}-${name}.png`);
  await page.screenshot({ path: f, scale: "css" });
  return path.relative(results, f);
}

// One step: run it, time it, screenshot it; a failed check is recorded, not thrown
async function step(name, fn, { finding } = {}) {
  const t0 = performance.now();
  let ok = true;
  let note = "";
  try {
    note = (await fn()) ?? "";
  } catch (e) {
    ok = false;
    note = String(e?.message ?? e).split("\n")[0];
  }
  const ms = Math.round(performance.now() - t0);
  const s = await shot(name.replace(/\W+/g, "-").toLowerCase());
  steps.push({ name, ok, ms, note, shot: s, finding });
  console.log(`${ok ? "✔" : "✘"} ${name} (${ms} ms)${note ? `: ${note}` : ""}`);
}

// --- reading the page --------------------------------------------------------

// The text of every webview frame (the Result view, kept results, forms)
async function webviewText() {
  const parts = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      parts.push(await f.locator("body").innerText({ timeout: 500 }));
    } catch {}
  }
  return parts.join("\n");
}
async function waitForText(re, ms = 15000, where = webviewText) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    last = await where();
    const m = last.match(re);
    if (m) return m[0];
    await page.waitForTimeout(100);
  }
  throw new Error(
    `not shown: ${re} (saw: ${last.replace(/\s+/g, " ").slice(0, 160)})`,
  );
}
const workbenchText = () => page.locator(".monaco-workbench").innerText();
// A frame is in sight when every frame element holding it is: a kept
// result's hidden tab stays in the page, and its own document says visible
async function inSight(f) {
  for (let c = f; c.parentFrame(); c = c.parentFrame())
    if (!(await (await c.frameElement()).isVisible())) return false;
  return true;
}
// The Result view's frame (in the panel), or a kept result's in sight
async function resultFrame({ kept = false } = {}) {
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !(await inSight(f))) continue;
    if (
      !(await f
        .locator("text=/^grid$/i")
        .count()
        .catch(() => 0))
    )
      continue;
    let outer = f;
    while (outer.parentFrame() !== page.mainFrame())
      outer = outer.parentFrame();
    // VS Code lays webviews over the workbench, not inside the panel's DOM
    const box = await (await outer.frameElement()).boundingBox();
    const panel = await page.locator(".part.panel").boundingBox();
    const inPanel = !!(
      box &&
      panel &&
      box.y >= panel.y - 1 &&
      box.y < panel.y + panel.height
    );
    if (inPanel !== kept) return f;
  }
  throw new Error(`no ${kept ? "kept result" : "Result view"} in sight`);
}

// --- acting -----------------------------------------------------------------

const key = (k) => page.keyboard.press(k);
async function paste(text) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);
  await key("Meta+V");
}
async function command(name) {
  await key("Meta+Shift+P");
  await page.waitForTimeout(250);
  await page.keyboard.type(name, { delay: 5 });
  await page.waitForTimeout(400);
  await key("Enter");
}
// Answer whatever the run asks: the server to use, then a password
// Only the extension's own prompts: the Command Palette's box can still be
// closing when this looks, and typing a name into it runs something else
async function answerPrompts(serverName) {
  const box = page.locator(".quick-input-widget:visible");
  for (let i = 0; i < 2; i++) {
    let title = "";
    const until = Date.now() + 1500;
    while (
      Date.now() < until &&
      !/kdb\+\/q: Connect to Server|password/i.test(title)
    ) {
      title = await box.innerText({ timeout: 100 }).catch(() => "");
      await page.waitForTimeout(50);
    }
    if (/password/i.test(title)) {
      await page.keyboard.type(PASSWORD);
      await key("Enter");
    } else if (/Connect to Server/.test(title)) {
      await page.keyboard.type(serverName);
      await page.waitForTimeout(250);
      await key("Enter");
    } else return;
    await page.waitForTimeout(300);
  }
}
async function openFile(rel) {
  await key("Meta+P");
  await page.waitForTimeout(250);
  await page.keyboard.type(rel, { delay: 5 });
  await page.waitForTimeout(500);
  await key("Enter");
  await page.waitForTimeout(500);
}
// Replace the scratch file's text with the query and run it on the server
async function run(query, serverName) {
  const pause = () => page.waitForTimeout(200);
  await key("Meta+1"); // a run leaves focus in the Result view
  await pause();
  await key("Meta+A");
  await paste(query);
  await pause(); // the clipboard's paste lands asynchronously
  await key("Meta+A");
  await pause();
  await key("Meta+Enter");
  await answerPrompts(serverName);
}
// Connect and make it the active server, as the status bar then shows
async function connect(serverName) {
  const active = async () =>
    (await page.locator(".statusbar").innerText())
      .split("\n")
      .some((l) => l.trim() === serverName);
  for (let i = 0; i < 2 && !(await active()); i++) {
    if (i) console.log(`  (connect ${serverName}: second try)`);
    await command("kdb+/q: Connect to Server");
    await answerPrompts(serverName);
    const until = Date.now() + 5000;
    while (Date.now() < until && !(await active()))
      await page.waitForTimeout(100);
  }
  if (!(await active())) throw new Error(`${serverName} not active`);
}
async function view(tab) {
  const f = await resultFrame();
  await f.locator(`text=/^${tab}$/i`).first().click();
  await page.waitForTimeout(300);
  return f;
}

// --- the route ----------------------------------------------------------------

async function main() {
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  // the developer's files: the new function and a scratch file for queries
  copyFileSync(
    path.join(here, "vwap.q"),
    path.join(deploy, "code", "common", "vwap.q"),
  );
  writeFileSync(path.join(deploy, "scratch.q"), "");
  const userData = path.join(repo, ".vscode-test", "sud"); // short: socket path limit
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(path.join(userData, "User"), { recursive: true });
  writeFileSync(
    path.join(userData, "User", "settings.json"),
    JSON.stringify(settings, null, 1),
  );
  const settingsFile = path.join(userData, "User", "settings.json");
  const setSetting = (k, v) => {
    const s = JSON.parse(readFileSync(settingsFile, "utf8"));
    s[k] = v;
    writeFileSync(settingsFile, JSON.stringify(s, null, 1));
  };

  app = await _electron.launch({
    executablePath: path.join(
      repo,
      ".vscode-test",
      `vscode-darwin-arm64-${VSCODE}`,
      "Visual Studio Code.app",
      "Contents",
      "MacOS",
      "Code",
    ),
    args: [
      `--user-data-dir=${userData}`,
      `--extensions-dir=${path.join(repo, ".vscode-test", "eext")}`,
      `--extensionDevelopmentPath=${repo}`,
      "--skip-welcome",
      "--skip-release-notes",
      deploy,
    ],
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.kx/bin:${process.env.PATH}`,
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
  );
  await page.waitForTimeout(2000);

  // 1 Orient
  await step("Cmd+T finds .gw.syncexec and opens its definition", async () => {
    await key("Meta+T");
    await page.waitForTimeout(200);
    await page.keyboard.type(".gw.syncexec", { delay: 5 });
    await waitForText(/\.gw\.syncexec/, 5000, () =>
      page.locator(".quick-input-widget").innerText(),
    );
    await key("Enter");
    await waitForText(/gateway\.q/, 5000, () =>
      page.locator(".tabs-container").innerText(),
    );
  });
  // Passwords, stored as the Add Server form would; one per login
  await step("Set Server Password for each login", async () => {
    for (const s of ["rdb1", "hdb1", "gateway1"]) {
      await command("kdb+/q: Set Server Password");
      await page
        .locator(".quick-input-widget:visible")
        .waitFor({ timeout: 5000 });
      await page.keyboard.type(s);
      await page.waitForTimeout(250);
      await key("Enter");
      await page.waitForTimeout(400);
      await page.keyboard.type(PASSWORD);
      await key("Enter");
      await page.waitForTimeout(400);
    }
  });

  // 2 Write: hover, completion, hints, syntax errors as you type, in the scratch file
  await openFile("scratch.q");
  await step("Hover on .gw.syncexecjt shows its signature", async () => {
    await key("Meta+A");
    await page.keyboard.type(".gw.syncexecjt", { delay: 10 });
    await key("Escape");
    await key("ArrowLeft");
    await command("Show or Focus Hover");
    return waitForText(
      /syncexecjt\[query;servertype;joinfunction;timeout\]/,
      5000,
      () => page.locator(".monaco-hover").first().innerText(),
    );
  });
  await step("Completion offers .lg.o after .lg.", async () => {
    await key("Meta+A");
    await page.keyboard.type(".lg.", { delay: 20 });
    await waitForText(/\bo\b|\.lg\.o/, 5000, () =>
      page.locator(".suggest-widget").innerText(),
    );
    await key("Escape");
  });
  // .lg.o and .gw.syncexec are projections, with no parameter list to hint
  await step("Parameter hints for .gw.syncexecjt[", async () => {
    await key("Escape");
    await key("Meta+A");
    await page.keyboard.type(".gw.syncexecjt[", { delay: 20 });
    return waitForText(/query;servertype/, 5000, () =>
      page.locator(".parameter-hints-widget").innerText(),
    );
  });
  await step("An unclosed bracket is marked as you type", async () => {
    await key("Escape");
    await key("Meta+A");
    await page.keyboard.type("f:{[x] x+1", { delay: 10 });
    await key("Delete"); // the auto-closed }
    await waitForText(/[1-9]/, 5000, () =>
      page.locator(".statusbar-item[id='status.problems']").innerText(),
    );
    await key("Meta+A");
    await key("Backspace");
  });

  // 3 Explore on the RDB
  await step("meta trade on rdb1 (picker, password, Grid)", async () => {
    await run("meta trade", "rdb1");
    return waitForText(/8 rows, 4 columns/);
  });
  await step("A broken query shows q's error and backtrace", async () => {
    await run("select from trade where sym=`AAPL, prce>100", "rdb1");
    return waitForText(/'prce/);
  });
  await step("Shift+Enter runs the line in a q terminal", async () => {
    // it sends to the terminal in use, so start q in one first
    await command("Terminal: Create New Terminal");
    await page.waitForTimeout(1500);
    await page.keyboard.type("q", { delay: 20 });
    await key("Enter");
    await page.waitForTimeout(1500);
    await key("Meta+1");
    await key("Meta+A");
    await paste("1+1");
    await page.waitForTimeout(300);
    await key("Shift+Enter");
    return waitForText(/^2\s*$/m, 10000, () =>
      page.locator(".xterm-rows").first().innerText(),
    );
  });

  // 4 Load the function on the RDB and HDB, call it through the gateway
  for (const s of ["rdb1", "hdb1"])
    await step(`Run File on Server loads vwap.q on ${s}`, async () => {
      await connect(s);
      await openFile("code/common/vwap.q");
      await command("kdb+/q: Run File on Server");
      await answerPrompts(s);
      await waitForText(new RegExp(s), 5000, workbenchText);
      await openFile("scratch.q");
      await run(
        ".ana.vwap[`AAPL;2015.01.07D00:00;2015.01.07D23:59;0D01:00]",
        s,
      );
      return waitForText(/\d+ rows, 4 columns|vwap/);
    });
  await step(
    "Through the gateway with protected evaluation (default)",
    async () => {
      await connect("gateway1");
      await run(
        ".gw.syncexec[(`.ana.vwap;`AAPL`IBM;2015.01.07D00:00;.z.p;0D00:05);`rdb`hdb]",
        "gateway1",
      );
      return waitForText(/\d+ rows, 4 columns/, 8000);
    },
    {
      finding:
        "F1: TorQ's gateway answers with -30!, so protected evaluation's reply is dropped",
    },
  );
  await step("Through the gateway without protected evaluation", async () => {
    await connect("gateway1 plain");
    await run(
      ".gw.syncexec[(`.ana.vwap;`AAPL`IBM`MSFT`GOOG;2015.01.07D00:00;.z.p;0D00:05);`rdb`hdb]",
      "gateway1 plain",
    );
    return waitForText(/\d+ rows, 4 columns/);
  });

  // 5 Inspect
  await step("Sort the Grid by volume", async () => {
    const f = await view("grid");
    const t0 = performance.now();
    await f.locator(".ag-header-cell-text", { hasText: /^volume$/ }).click();
    await f
      .locator(".ag-header-cell[aria-sort='ascending']")
      .waitFor({ timeout: 5000 });
    return `${Math.round(performance.now() - t0)} ms`;
  });
  await step("Copy with Headers from the Grid's right-click menu", async () => {
    const f = await view("grid");
    await f
      .locator(".ag-row[row-index='0'] [role=gridcell]:not([col-id='index'])")
      .first()
      .click({ button: "right" });
    await page
      .locator(".context-view .action-label", { hasText: "Copy with Headers" })
      .click();
    await page.waitForTimeout(500);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    // the selected cell, under its column's header
    const lines = copied.trimEnd().split("\n");
    if (lines.length !== 2 || lines[0] !== "sym")
      throw new Error(`clipboard: ${JSON.stringify(copied.slice(0, 60))}`);
    return JSON.stringify(copied.trimEnd());
  });
  await step("Export Result to CSV", async () => {
    const out = path.join(results, "scenario", "vwap.csv");
    rmSync(out, { force: true });
    await command("kdb+/q: Export Result to CSV");
    await page
      .locator(".quick-input-widget:visible")
      .waitFor({ timeout: 5000 });
    await key("Meta+A");
    await page.keyboard.type(out);
    await key("Enter");
    const until = Date.now() + 5000;
    while (!existsSync(out) && Date.now() < until)
      await page.waitForTimeout(100);
    const lines = readFileSync(out, "utf8").trimEnd().split("\n");
    if (lines[0] !== "sym,time,vwap,volume")
      throw new Error(`header: ${lines[0]}`);
    return `${lines.length - 1} rows`;
  });
  await step("Keep Result opens it as an editor tab", async () => {
    await command("kdb+/q: Keep Result");
    return waitForText(/syncexec/, 5000, () =>
      page.locator(".tabs-container").innerText(),
    );
  });
  await step("Drill into a nested cell, and back", async () => {
    await connect("rdb1");
    await openFile("scratch.q");
    await run("select price by sym from trade", "rdb1");
    await waitForText(/\d+ rows, 2 columns/);
    const f = await view("grid");
    await f
      .locator(".ag-row[row-index='0'] [role=gridcell]:not([col-id='index'])")
      .last()
      .dblclick();
    await waitForText(/\[0, 1\]/);
    await key("Alt+ArrowLeft");
  });

  // 6 Chart
  await step("Chart the VWAP bars", async () => {
    await connect("hdb1");
    await openFile("scratch.q");
    await run(
      "select vwap, volume by time from .ana.vwap[`AAPL;2015.01.07D00:00;2015.01.07D23:59;0D00:05]",
      "hdb1",
    );
    await waitForText(/\d+ rows, 3 columns/);
    const f = await view("chart");
    await f.locator("canvas").first().waitFor({ timeout: 5000 });
  });

  // 7 Limits
  await step(
    "A 115 MB result is refused at the default size limit",
    async () => {
      await run("select from quote where date=2015.01.08", "hdb1");
      return waitForText(
        /size limit[^\n]*/,
        30000,
        async () => `${await webviewText()}\n${await workbenchText()}`,
      );
    },
  );
  await step(
    "With the size limit raised, 2.09M rows show in the Grid",
    async () => {
      setSetting("kdb-q-ext-vscode.sizeLimit", 1000);
      await page.waitForTimeout(500);
      await connect("hdb1");
      await openFile("scratch.q");
      await run("select from quote where date=2015.01.08", "hdb1");
      return waitForText(/2086516 rows, 10 columns/, 30000);
    },
  );
  await step("Sort 2.09M rows", async () => {
    const f = await view("grid");
    const t0 = performance.now();
    await f.locator(".ag-header-cell-text", { hasText: /^bid$/ }).click();
    await f
      .locator(".ag-header-cell[aria-sort='ascending']")
      .waitFor({ timeout: 30000 });
    return `${Math.round(performance.now() - t0)} ms`;
  });
  await step(
    "10.4M rows are refused at the row limit, and the connection stays",
    async () => {
      await run(
        "raze 5#enlist select from quote where date=2015.01.08",
        "hdb1",
      );
      await waitForText(
        /row limit[^\n]*/,
        60000,
        async () => `${await webviewText()}\n${await workbenchText()}`,
      );
      await run("1+1", "hdb1");
      return waitForText(/^2$/m, 10000);
    },
  );

  // 8 Back to the code
  await step("F12 on .ana.vwap opens vwap.q", async () => {
    await key("Meta+1");
    await key("Meta+A");
    await paste(".ana.vwap");
    await key("End");
    await key("ArrowLeft");
    await key("F12");
    await waitForText(/vwap\.q/, 5000, () =>
      page.locator(".tabs-container").innerText(),
    );
  });

  await app.close();
}

const t0 = Date.now();
try {
  await main();
} catch (e) {
  console.error(`scenario stopped: ${e.message}`);
  steps.push({ name: "scenario stopped", ok: false, note: e.message });
  await app?.close().catch(() => {});
}
rmSync(path.join(deploy, "scratch.q"), { force: true });
const failed = steps.filter((s) => !s.ok && !s.finding);
const known = steps.filter((s) => !s.ok && s.finding);
const report = {
  versions: {
    vscode: VSCODE,
    extension: execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repo,
    })
      .toString()
      .trim(),
  },
  seconds: Math.round((Date.now() - t0) / 1000),
  steps,
};
writeFileSync(
  path.join(results, "scenario.json"),
  JSON.stringify(report, null, 1),
);
writeFileSync(
  path.join(results, "scenario.md"),
  [
    `# Scenario run, ${new Date().toISOString()}`,
    "",
    `VS Code ${VSCODE}, extension ${report.versions.extension}, ${report.seconds} s. ${steps.length - failed.length - known.length} passed, ${known.length} failed on a known finding, ${failed.length} failed.`,
    "",
    "| Step | | ms | Note | Shot |",
    "|---|---|---|---|---|",
    ...steps.map(
      (s) =>
        `| ${s.name} | ${s.ok ? "✔" : s.finding ? "✘ known" : "✘"} | ${s.ms ?? ""} | ${(s.finding ? `${s.finding}. ` : "") + (s.note ?? "")} | ${s.shot ?? ""} |`,
    ),
    "",
  ].join("\n"),
);
console.log(
  `scenario: ${failed.length ? `${failed.length} failed` : "green"}${known.length ? ` (${known.length} on known findings)` : ""}`,
);
process.exit(failed.length ? 1 : 0);
