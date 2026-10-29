import * as assert from "node:assert";
import {
  credentialsProblem,
  defaults,
  definitions,
  passwordProblem,
  secretKey,
  server,
  settings,
} from "../servers";

suite("servers", () => {
  test("reads servers in the order written", () => {
    assert.deepStrictEqual(
      definitions({
        prod: { host: "kdb1", port: 5010, user: "admin", timeout: 500 },
        local: { host: "localhost", port: 5000 },
      }),
      {
        servers: [
          {
            name: "prod",
            host: "kdb1",
            port: 5010,
            user: "admin",
            timeout: 500,
          },
          { name: "local", host: "localhost", port: 5000 },
        ],
        problems: [],
      },
    );
  });

  test("tls is on with true or its files, and off otherwise", () => {
    const { servers, problems } = definitions({
      a: { host: "h", port: 1, tls: true },
      b: { host: "h", port: 1, tls: false },
      c: {
        host: "h",
        port: 1,
        tls: { ca: "~/ca.pem", cert: "/c.pem", key: "/k.pem" },
      },
      d: { host: "h", port: 1, tls: { pfx: "/c.p12" } },
    });
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(
      servers.map((s) => s.tls),
      [
        {},
        undefined,
        { ca: "~/ca.pem", cert: "/c.pem", key: "/k.pem" },
        { pfx: "/c.p12" },
      ],
    );
  });

  test("protected evaluation is on unless a server turns it off", () => {
    const { servers } = definitions({
      gateway: { host: "gw", port: 5000, protect: false },
      local: { host: "localhost", port: 5000 },
    });
    assert.deepStrictEqual(
      servers.map((s) => server(s, {}, defaults).protect),
      [false, true],
    );
  });

  test("no setting is no servers", () => {
    assert.deepStrictEqual(definitions(undefined), {
      servers: [],
      problems: [],
    });
  });

  test("a setting that isn't an object is a problem", () => {
    assert.deepStrictEqual(definitions([{ host: "h", port: 1 }]), {
      servers: [],
      problems: ["the servers setting isn't an object"],
    });
  });

  test("a server with a problem is left out and the rest kept", () => {
    const { servers, problems } = definitions({
      a: { host: "h", port: 0 },
      b: { host: "h", port: 65536 },
      c: { host: "h", port: 5.5 },
      d: { host: "", port: 1 },
      e: { port: 1 },
      f: { host: "h", port: 1, user: "a:b" },
      g: { host: "h", port: 1, user: "a\0" },
      h: { host: "h", port: 1, timeout: -1 },
      h2: { host: "h", port: 1, protect: "no" },
      t1: { host: "h", port: 1, tls: "yes" },
      t2: { host: "h", port: 1, tls: { ca: "ca.pem" } },
      t3: { host: "h", port: 1, tls: { cert: "/c.pem" } },
      t4: {
        host: "h",
        port: 1,
        tls: { pfx: "/c.p12", cert: "/c.pem", key: "/k.pem" },
      },
      t5: { host: "h", port: 1, tls: { crt: "/c.pem" } },
      i: { host: "h", port: 1, usr: "admin" },
      j: "h:1",
      "": { host: "h", port: 1 },
      ok: { host: "h", port: 1 },
    });
    assert.deepStrictEqual(servers, [{ name: "ok", host: "h", port: 1 }]);
    assert.deepStrictEqual(problems, [
      "a: the port isn't a port number",
      "b: the port isn't a port number",
      "c: the port isn't a port number",
      "d: no host",
      "e: no host",
      "f: the user can't contain : or a 0 byte",
      "g: the user can't contain : or a 0 byte",
      "h: the timeout isn't a whole number of milliseconds",
      "h2: protect is true or false",
      "t1: tls is true, false or its files",
      "t2: tls's files are absolute paths or start with ~/",
      "t3: tls's cert and key go together",
      "t4: tls has a cert and key or a pfx, not both",
      "t5: unknown tls field crt",
      "i: unknown field usr",
      "j: not an object",
      '"": a server needs a name',
    ]);
  });

  test("auth is a prompt, or an extension given the rest of it", () => {
    assert.deepStrictEqual(
      definitions({
        otp: { host: "h", port: 1, auth: "prompt" },
        sso: {
          host: "h",
          port: 1,
          auth: { extension: "acme.kdb-auth", realm: "EXAMPLE.COM" },
        },
      }).servers,
      [
        { name: "otp", host: "h", port: 1, auth: "prompt" },
        {
          name: "sso",
          host: "h",
          port: 1,
          auth: {
            extension: "acme.kdb-auth",
            fields: { realm: "EXAMPLE.COM" },
          },
        },
      ],
    );
  });

  test("auth that's neither is a problem", () => {
    assert.deepStrictEqual(
      definitions({
        a: { host: "h", port: 1, auth: "stored" },
        b: { host: "h", port: 1, auth: { realm: "EXAMPLE.COM" } },
        c: { host: "h", port: 1, auth: { extension: "kdb-auth" } },
        d: { host: "h", port: 1, auth: ["prompt"] },
      }).problems,
      [
        'a: auth is "prompt" or names an extension',
        "b: auth's extension isn't an extension ID",
        "c: auth's extension isn't an extension ID",
        'd: auth is "prompt" or names an extension',
      ],
    );
  });

  test("an extension's user replaces the server's", () => {
    const prod = { name: "prod", host: "h", port: 1, user: "admin" };
    assert.strictEqual(server(prod, {}, defaults).user, "admin");
    assert.strictEqual(
      server(prod, { user: "token", password: "jwt" }, defaults).user,
      "token",
    );
  });

  test("an extension's credentials are checked", () => {
    assert.strictEqual(credentialsProblem({ password: "p" }), undefined);
    assert.strictEqual(
      credentialsProblem({ user: "token", password: "p" }),
      undefined,
    );
    assert.strictEqual(credentialsProblem("user:p"), "not an object");
    assert.strictEqual(credentialsProblem({ user: "admin" }), "no password");
    assert.strictEqual(
      credentialsProblem({ user: "a:b", password: "p" }),
      "the user can't contain : or a 0 byte",
    );
    assert.strictEqual(
      credentialsProblem({ password: "a\0b" }),
      "a password can't contain a 0 byte",
    );
  });

  test("a timeout of 0 waits as long as it takes", () => {
    assert.deepStrictEqual(
      definitions({ local: { host: "h", port: 1, timeout: 0 } }).servers,
      [{ name: "local", host: "h", port: 1, timeout: 0 }],
    );
    assert.strictEqual(settings(0, undefined).defaults.timeout, 0);
  });

  test("the connect timeout and the size limit", () => {
    assert.deepStrictEqual(settings(undefined, undefined), {
      defaults,
      problems: [],
    });
    assert.deepStrictEqual(settings(500, 2.5), {
      defaults: { timeout: 500, limit: 2500000 },
      problems: [],
    });
  });

  test("a wrong setting is a problem, and its default is used", () => {
    assert.deepStrictEqual(settings(-1, 0), {
      defaults,
      problems: [
        "the connect timeout isn't a whole number of milliseconds",
        "the size limit isn't a positive number of megabytes",
      ],
    });
    assert.deepStrictEqual(settings(1.5, "10"), {
      defaults,
      problems: [
        "the connect timeout isn't a whole number of milliseconds",
        "the size limit isn't a positive number of megabytes",
      ],
    });
  });

  test("a password is kept for where it's sent, not the server's name", () => {
    const prod = { name: "prod", host: "KDB1", port: 5010, user: "admin" };
    assert.strictEqual(secretKey(prod), "password:admin@kdb1:5010");
    assert.strictEqual(
      secretKey({ ...prod, name: "renamed" }),
      secretKey(prod),
    );
    assert.notStrictEqual(
      secretKey({ ...prod, host: "kdb2" }),
      secretKey(prod),
    );
    assert.notStrictEqual(secretKey({ ...prod, port: 5011 }), secretKey(prod));
    assert.notStrictEqual(secretKey({ ...prod, user: "al" }), secretKey(prod));
    assert.strictEqual(
      secretKey({ name: "local", host: "localhost", port: 5000 }),
      "password:@localhost:5000",
    );
  });

  test("a password can't contain a 0 byte", () => {
    assert.strictEqual(passwordProblem("a:b c"), undefined);
    assert.strictEqual(
      passwordProblem("a\0b"),
      "a password can't contain a 0 byte",
    );
  });

  test("a server's own timeout overrides the default", () => {
    const local = { name: "local", host: "localhost", port: 5000 };
    assert.deepStrictEqual(server(local, {}, defaults), {
      host: "localhost",
      port: 5000,
      timeout: 2000,
      limit: 100e6,
      protect: true,
    });
    assert.deepStrictEqual(
      server(
        { ...local, user: "admin", timeout: 500 },
        { password: "pw" },
        defaults,
      ),
      {
        host: "localhost",
        port: 5000,
        user: "admin",
        password: "pw",
        timeout: 500,
        limit: 100e6,
        protect: true,
      },
    );
  });
});
