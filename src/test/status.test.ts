import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { serverMenu } from "../commands";
import { describe, details, lastTiming, took } from "../status";

suite("status", () => {
  test("a query's time: the server's and the roundtrip, or the roundtrip", () => {
    assert.strictEqual(
      took({ roundtrip: 3, execution: 2 }),
      "2 ms (3 ms roundtrip)",
    );
    assert.strictEqual(took({ roundtrip: 3 }), "3 ms roundtrip");
  });

  test("the last query's timing, then the server's time once it's read", () => {
    let changes = 0;
    const last = lastTiming(() => changes++);
    const executed = last.ended("prod", 5);
    assert.deepStrictEqual(last.get(), {
      name: "prod",
      timing: { roundtrip: 5 },
    });
    executed(3);
    assert.deepStrictEqual(last.get(), {
      name: "prod",
      timing: { roundtrip: 5, execution: 3 },
    });
    assert.strictEqual(changes, 2);
  });

  test("a query's server time is dropped once another has ended", () => {
    let changes = 0;
    const last = lastTiming(() => changes++);
    const first = last.ended("prod", 5);
    last.ended("dev", 6);
    first(3);
    assert.deepStrictEqual(last.get(), {
      name: "dev",
      timing: { roundtrip: 6 },
    });
    assert.strictEqual(changes, 2);
  });

  test("a query's server time is dropped once the timing is cleared", () => {
    const last = lastTiming(() => {});
    const executed = last.ended("prod", 5);
    last.clear();
    executed(3);
    assert.strictEqual(last.get(), undefined);
  });

  test("a query with no response leaves no timing, nor takes a server time", () => {
    const last = lastTiming(() => {});
    last.ended("prod", 5);
    const executed = last.ended("prod", undefined);
    executed(3);
    assert.strictEqual(last.get(), undefined);
  });

  test("a closed connection as its reason, which says it closed", () => {
    assert.strictEqual(
      describe({
        kind: "closed",
        reason: new Error("connection closed unexpectedly"),
      }),
      "connection closed unexpectedly",
    );
  });

  test("a server's settings, a line each", () => {
    assert.deepStrictEqual(
      details({
        name: "prod",
        host: "kdb1",
        port: 5010,
        user: "admin",
        timeout: 500,
        tls: true,
      }),
      [
        "Host: kdb1:5010",
        "User: admin",
        "Authentication: Stored password",
        "TLS: On",
        "Protected evaluation: On",
        "Connection timeout: 500 ms",
      ],
    );
    assert.deepStrictEqual(
      details({
        name: "gw",
        host: "gw",
        port: 5000,
        auth: "prompt",
        protect: false,
        timeout: 0,
      }).slice(1),
      [
        "Authentication: Ask each time",
        "TLS: Off",
        "Protected evaluation: Off",
        "Connection timeout: None",
      ],
    );
  });

  test("the auth extension is named, but not the fields it's given", () => {
    const sso = {
      name: "sso",
      host: "kdb2",
      port: 5000,
      auth: { fields: { token: "secret" } },
    };
    const lines = details(sso, "acme.kdb-auth");
    assert.ok(lines.includes("Authentication: Extension acme.kdb-auth"));
    assert.ok(details(sso).includes("Authentication: Extension not set"));
    assert.ok(
      details(sso, "kdb-auth").includes(
        'Authentication: Extension "kdb-auth" (invalid)',
      ),
    );
    assert.ok(!lines.join("\n").includes("secret"));
    assert.ok(lines.includes("Connection timeout: Default"));
  });

  test("the server menu names each command as the palette does", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    );
    const titles = new Map<string, string>(
      manifest.contributes.commands.map(
        (c: { command: string; title: string }) => [c.command, c.title],
      ),
    );
    for (const [command, label] of serverMenu.flatMap((g) => g.commands)) {
      assert.strictEqual(titles.get(command), label, command);
    }
  });
});
