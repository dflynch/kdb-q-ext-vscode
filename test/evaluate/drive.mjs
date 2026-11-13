// Drive VS Code (with the extension under development) as a person would:
// keys, typing, clicks, screenshots. One long-running server holds the
// window; each command is one short call.
//
//   node drive.mjs serve                  start VS Code on the TorQ workspace (leave running)
//   node drive.mjs shot                   screenshot; prints its path
//   node drive.mjs key Meta+Shift+P       press a key or chord (Playwright names)
//   node drive.mjs type "some text"       type, as keystrokes (VS Code auto-closes brackets)
//   node drive.mjs paste "some text"      paste through the clipboard
//   node drive.mjs click X Y              click at window coordinates (also: dblclick, rclick)
//   node drive.mjs move X Y               hover the mouse there
//   node drive.mjs drag X1 Y1 X2 Y2       drag with the left button
//   node drive.mjs scroll X Y DY          mouse wheel at X Y
//   node drive.mjs command "Name"         Command Palette: type the name, press Enter
//   node drive.mjs text SELECTOR          the text of the first element matching a CSS selector
//   node drive.mjs wait MS                wait, then screenshot
//   node drive.mjs stop                   close VS Code
// DRIVE_SETTINGS=file.json adds user settings; DRIVE_FRESH=0 keeps the last profile.
// Every command but text/stop answers with a screenshot path and the time it took.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const evaluation = path.join(repo, ".vscode-test", "evaluation");
const PORT = Number(process.env.DRIVE_PORT ?? 9341);
const SHOTS =
  process.env.DRIVE_SHOTS ??
  path.join(evaluation, "results", "session", "shots");
const VSCODE = process.env.DRIVE_VSCODE ?? "1.146.0";

async function serve() {
  const { _electron } = await import("playwright-core");
  // short paths: VS Code's IPC socket path must stay under 104 characters
  const userData = path.join(repo, ".vscode-test", "eud");
  const exts = path.join(repo, ".vscode-test", "eext");
  if (process.env.DRIVE_FRESH !== "0")
    rmSync(userData, { recursive: true, force: true });
  mkdirSync(path.join(userData, "User"), { recursive: true });
  mkdirSync(exts, { recursive: true });
  writeFileSync(
    path.join(userData, "User", "settings.json"),
    JSON.stringify(
      {
        "security.workspace.trust.enabled": false, // a developer's own checkout
        "workbench.startupEditor": "none",
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "extensions.autoCheckUpdates": false,
        "chat.disableAIFeatures": true,
        "debug.javascript.enableNetworkView": false,
        // macOS draws native menus and dialogs outside the page, where no
        // screenshot sees them: VS Code's own in-window ones instead
        "window.menuStyle": "custom",
        "files.simpleDialog.enable": true,
        ...(process.env.DRIVE_SETTINGS
          ? JSON.parse(readFileSync(process.env.DRIVE_SETTINGS, "utf8"))
          : {}),
      },
      null,
      1,
    ),
  );
  mkdirSync(SHOTS, { recursive: true });
  const app = await _electron.launch({
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
      `--extensions-dir=${exts}`,
      `--extensionDevelopmentPath=${repo}`,
      "--skip-welcome",
      "--skip-release-notes",
      path.join(evaluation, "deploy"),
    ],
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.kx/bin:${process.env.PATH}`,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 1000);
    w.center();
  });
  await page.waitForTimeout(1500);
  let n = 0;
  const shot = async () => {
    const f = path.join(SHOTS, `${String(++n).padStart(4, "0")}.png`);
    await page.screenshot({ path: f, scale: "css" }); // pixels = click coordinates
    return f;
  };
  const settle = () => page.waitForTimeout(400);

  const run = async (cmd, a) => {
    switch (cmd) {
      case "shot":
        break;
      case "key":
        await page.keyboard.press(a[0]);
        break;
      case "type":
        await page.keyboard.type(a.join(" "), { delay: 15 });
        break;
      case "paste":
        await app.evaluate(
          ({ clipboard }, t) => clipboard.writeText(t),
          a.join(" "),
        );
        await page.keyboard.press("Meta+V");
        break;
      case "click":
        await page.mouse.click(+a[0], +a[1]);
        break;
      case "dblclick":
        await page.mouse.dblclick(+a[0], +a[1]);
        break;
      case "rclick":
        await page.mouse.click(+a[0], +a[1], { button: "right" });
        break;
      case "move":
        await page.mouse.move(+a[0], +a[1]);
        break;
      case "drag":
        await page.mouse.move(+a[0], +a[1]);
        await page.mouse.down();
        await page.mouse.move(+a[2], +a[3], { steps: 12 });
        await page.mouse.up();
        break;
      case "scroll":
        await page.mouse.move(+a[0], +a[1]);
        await page.mouse.wheel(0, +a[2]);
        break;
      case "command":
        await page.keyboard.press("Meta+Shift+P");
        await page.waitForTimeout(250);
        await page.keyboard.type(a.join(" "), { delay: 10 });
        await page.waitForTimeout(350);
        await page.keyboard.press("Enter");
        break;
      case "wait":
        await page.waitForTimeout(+a[0]);
        break;
      case "text":
        return {
          text: await page
            .locator(a.join(" "))
            .first()
            .innerText({ timeout: 3000 }),
        };
      case "stop":
        setTimeout(async () => {
          await app.close();
          process.exit(0);
        }, 100);
        return { stopped: true };
      default:
        throw new Error(`unknown command ${cmd}`);
    }
    await settle();
    return { shot: await shot() };
  };

  http
    .createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const { cmd, args } = JSON.parse(body);
      const t0 = performance.now();
      try {
        const r = await run(cmd, args);
        res.end(
          JSON.stringify({ ...r, ms: Math.round(performance.now() - t0) }),
        );
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
    })
    .listen(PORT, "127.0.0.1", () =>
      console.log(`drive: VS Code ready, listening on ${PORT}`),
    );
}

async function client(cmd, args) {
  const body = JSON.stringify({ cmd, args });
  const out = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method: "POST" },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
  console.log(out);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "serve") await serve();
else await client(cmd, args);
