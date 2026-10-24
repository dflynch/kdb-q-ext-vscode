import * as assert from "node:assert";
import { details, took } from "../status";

suite("status", () => {
  test("a query's time: the server's and the roundtrip, or the roundtrip", () => {
    assert.strictEqual(
      took({ roundtrip: 3, execution: 2 }),
      "2 ms (3 ms roundtrip)",
    );
    assert.strictEqual(took({ roundtrip: 3 }), "3 ms roundtrip");
  });

  test("a server's settings, a line each", () => {
    assert.deepStrictEqual(
      details({
        name: "prod",
        host: "kdb1",
        port: 5010,
        user: "dan",
        timeout: 500,
        tls: { ca: "~/ca.pem" },
      }),
      [
        "Host: kdb1:5010",
        "User: dan",
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
        tls: { pfx: "/c.p12" },
      }).slice(1),
      [
        "Authentication: Ask each time",
        "TLS: On, with a client certificate",
        "Protected evaluation: Off",
        "Connection timeout: None",
      ],
    );
  });

  test("an extension is named, but not the fields it's given", () => {
    const lines = details({
      name: "sso",
      host: "kdb2",
      port: 5000,
      auth: { extension: "acme.kdb-auth", fields: { token: "secret" } },
    });
    assert.ok(lines.includes("Authentication: Extension acme.kdb-auth"));
    assert.ok(!lines.join("\n").includes("secret"));
    assert.ok(lines.includes("Connection timeout: Default"));
  });
});
