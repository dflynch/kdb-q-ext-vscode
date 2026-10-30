import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { passwordProblem } from "../login";
import {
  at,
  authExtension,
  credentialsProblem,
  type Definition,
  defaults,
  definitions,
  put,
  said,
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
            path: ["prod"],
            host: "kdb1",
            port: 5010,
            user: "admin",
            timeout: 500,
          },
          { path: ["local"], host: "localhost", port: 5000 },
        ],
        folders: [],
        problems: [],
      },
    );
  });

  test("tls is on with true, and off otherwise", () => {
    const { servers, problems } = definitions({
      a: { host: "h", port: 1, tls: true },
      b: { host: "h", port: 1, tls: false },
      c: { host: "h", port: 1 },
    });
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(
      servers.map((s) => s.tls),
      [true, undefined, undefined],
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
      folders: [],
      problems: [],
    });
  });

  test("a setting that isn't an object is a problem", () => {
    assert.deepStrictEqual(definitions([{ host: "h", port: 1 }]), {
      servers: [],
      folders: [],
      problems: [{ path: [], problem: "isn't an object" }],
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
      t2: { host: "h", port: 1, tls: { ca: "/ca.pem" } },
      i: { host: "h", port: 1, usr: "admin" },
      j: "h:1",
      "": { host: "h", port: 1 },
      ok: { host: "h", port: 1 },
    });
    assert.deepStrictEqual(servers, [{ path: ["ok"], host: "h", port: 1 }]);
    assert.deepStrictEqual(problems, [
      { path: ["a"], problem: "has a port that isn't from 1 to 65535" },
      { path: ["b"], problem: "has a port that isn't from 1 to 65535" },
      { path: ["c"], problem: "has a port that isn't from 1 to 65535" },
      { path: ["d"], problem: "has no host" },
      { path: ["e"], problem: "has no host" },
      { path: ["f"], problem: "has a user with a : or a 0 byte" },
      { path: ["g"], problem: "has a user with a : or a 0 byte" },
      {
        path: ["h"],
        problem: "has a timeout that isn't a whole number of milliseconds",
      },
      { path: ["h2"], problem: "has a protect that isn't true or false" },
      { path: ["t1"], problem: "has a tls that isn't true or false" },
      { path: ["t2"], problem: "has a tls that isn't true or false" },
      { path: ["i"], problem: "has an unknown field, usr" },
      { path: ["j"], problem: "isn't a server or a folder" },
      { path: [""], problem: "has no name" },
    ]);
  });

  test("auth is none, a stored password, a prompt or the auth extension", () => {
    const { servers, problems } = definitions({
      none: { host: "h", port: 1, auth: "none" },
      kept: { host: "h", port: 1, auth: "store" },
      otp: { host: "h", port: 1, auth: "prompt" },
      sso: { host: "h", port: 1, auth: "extension" },
      a: { host: "h", port: 1, auth: "stored" },
      b: { host: "h", port: 1, auth: ["prompt"] },
      c: { host: "h", port: 1, auth: null },
    });
    // "none" is read as no auth
    assert.deepStrictEqual(servers, [
      { path: ["none"], host: "h", port: 1 },
      { path: ["kept"], host: "h", port: 1, auth: "store" },
      { path: ["otp"], host: "h", port: 1, auth: "prompt" },
      { path: ["sso"], host: "h", port: 1, auth: "extension" },
    ]);
    assert.deepStrictEqual(problems, [
      {
        path: ["a"],
        problem:
          'has an auth that isn\'t "none", "store", "prompt" or "extension"',
      },
      {
        path: ["b"],
        problem:
          'has an auth that isn\'t "none", "store", "prompt" or "extension"',
      },
      {
        path: ["c"],
        problem:
          'has an auth that isn\'t "none", "store", "prompt" or "extension"',
      },
    ]);
  });

  test("folders hold servers and folders, to any depth, or nothing", () => {
    assert.deepStrictEqual(
      definitions({
        Dev: {
          TP: { host: "dev", port: 5010 },
          trades: { RDB: { host: "dev", port: 5011 } },
        },
        Prod: { TP: { host: "prod", port: 5010 } },
        local: { host: "localhost", port: 5000 },
        UAT: {},
      }),
      {
        servers: [
          { path: ["Dev", "TP"], host: "dev", port: 5010 },
          { path: ["Dev", "trades", "RDB"], host: "dev", port: 5011 },
          { path: ["Prod", "TP"], host: "prod", port: 5010 },
          { path: ["local"], host: "localhost", port: 5000 },
        ],
        folders: [["Dev"], ["Dev", "trades"], ["Prod"], ["UAT"]],
        problems: [],
      },
    );
  });

  test("the schema's folders refer back to the servers setting", () => {
    const configuration = JSON.parse(
      readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    ).contributes.configuration;
    // VS Code's settings schema has each setting under properties, as the
    // configuration contributed does
    const resolve = (pointer: string) =>
      pointer
        .replace(/^#\//, "")
        .split("/")
        .reduce((at, part) => at?.[part], configuration);
    const servers = configuration.properties["kdb-q-ext-vscode.servers"];
    const [, folder] = servers.additionalProperties.anyOf;
    assert.strictEqual(
      resolve(folder.additionalProperties.$ref),
      servers.additionalProperties,
    );
    assert.strictEqual(
      resolve(folder.propertyNames.$ref),
      servers.propertyNames,
    );
    const names = new RegExp(servers.propertyNames.pattern);
    for (const name of ["TP", "Prod trades", "a.b", "fx/spot"]) {
      assert.ok(names.test(name), name);
    }
    for (const name of ["", " "]) {
      assert.ok(!names.test(name), name);
    }
  });

  test("a problem in a folder is said by its path", () => {
    assert.deepStrictEqual(
      definitions({
        Dev: {
          // A misspelt host makes a server with an unknown field
          TP: { hots: "dev", port: 5010 },
          // Any name will do, but an empty one
          "a/b": { host: "dev", port: 1 },
          trades: { " ": { host: "dev", port: 1 }, "": {} },
          HDB: { host: "dev", port: 5012 },
        },
        // A value that isn't an object makes a server of what holds it
        UAT: { TP: { host: "uat", port: 5010 }, RDB: "uat:5011" },
        // An object in a server is said as its field
        gw: { host: "gw", port: 1, tls: { ca: "/ca.pem" } },
        stray: "gw:1",
      }),
      {
        servers: [
          { path: ["Dev", "a/b"], host: "dev", port: 1 },
          { path: ["Dev", "HDB"], host: "dev", port: 5012 },
        ],
        folders: [["Dev"], ["Dev", "trades"]],
        problems: [
          { path: ["Dev", "TP"], problem: "has an unknown field, hots" },
          { path: ["Dev", "trades", " "], problem: "has no name" },
          { path: ["Dev", "trades", ""], problem: "has no name" },
          { path: ["UAT"], problem: "has unknown fields, TP, RDB" },
          { path: ["gw"], problem: "has a tls that isn't true or false" },
          { path: ["stray"], problem: "isn't a server or a folder" },
        ],
      },
    );
  });

  test("a problem's said of what has it, by its path", () => {
    const problem = "isn't a server or a folder";
    assert.strictEqual(
      said({ path: ["Dev", "rdb"], problem }),
      "Dev › rdb isn't a server or a folder",
    );
    assert.strictEqual(
      said({ path: ["Dev", " "], problem: "has no name" }),
      "an entry in Dev has no name",
    );
    assert.strictEqual(
      said({ path: [""], problem: "has no name" }),
      "an entry has no name",
    );
    assert.strictEqual(
      said({ path: [], problem: "isn't an object" }),
      "the setting isn't an object",
    );
  });

  test("what's at a path, or undefined", () => {
    const setting = { Prod: { trades: { TP: { host: "h", port: 1 } } } };
    assert.deepStrictEqual(at(setting, ["Prod", "trades", "TP"]), {
      host: "h",
      port: 1,
    });
    assert.strictEqual(at(setting, ["Prod", "TP"]), undefined);
    assert.strictEqual(
      at(setting, ["Prod", "trades", "TP", "host", "x"]),
      undefined,
    );
    assert.strictEqual(at(setting, ["constructor"]), undefined);
    assert.strictEqual(at(undefined, ["Prod"]), undefined);
  });

  test("a server put at a path, beside the rest, the setting left as it was", () => {
    const setting = { Dev: { TP: { host: "dev", port: 1 } }, local: {} };
    const server = { host: "prod", port: 2 };
    assert.deepStrictEqual(put(setting, ["Prod", "trades", "TP"], server), {
      Dev: { TP: { host: "dev", port: 1 } },
      local: {},
      Prod: { trades: { TP: server } },
    });
    assert.deepStrictEqual(put(setting, ["Dev", "RDB"], server), {
      Dev: { TP: { host: "dev", port: 1 }, RDB: server },
      local: {},
    });
    assert.deepStrictEqual(setting, {
      Dev: { TP: { host: "dev", port: 1 } },
      local: {},
    });
  });

  test("a server replaced, renamed in its place, or deleted", () => {
    const setting = {
      a: { host: "a", port: 1 },
      b: { host: "b", port: 1 },
      c: { host: "c", port: 1 },
    };
    const server = { host: "x", port: 2 };
    assert.deepStrictEqual(Object.entries(put(setting, ["b"], server)), [
      ["a", setting.a],
      ["b", server],
      ["c", setting.c],
    ]);
    assert.deepStrictEqual(
      Object.entries(put(setting, ["renamed"], server, "b")),
      [
        ["a", setting.a],
        ["renamed", server],
        ["c", setting.c],
      ],
    );
    assert.deepStrictEqual(put(setting, ["b"], undefined), {
      a: setting.a,
      c: setting.c,
    });
    // A folder emptied stays, as an empty folder
    assert.deepStrictEqual(
      put({ Dev: { TP: server } }, ["Dev", "TP"], undefined),
      {
        Dev: {},
      },
    );
  });

  test("any name can be put, as the settings can hold it", () => {
    const put1 = put({}, ["__proto__", "constructor"], { host: "h", port: 1 });
    assert.deepStrictEqual(
      definitions(put1).servers.map((s) => s.path),
      [["__proto__", "constructor"]],
    );
  });

  test("the auth extension is an extension ID, or unset", () => {
    assert.deepStrictEqual(authExtension("acme.kdb-auth"), {
      id: "acme.kdb-auth",
    });
    assert.deepStrictEqual(authExtension(undefined), {});
    assert.deepStrictEqual(authExtension(""), {});
    assert.deepStrictEqual(authExtension("kdb-auth"), {
      problem: "the auth extension isn't an extension ID",
    });
    assert.deepStrictEqual(authExtension(1), {
      problem: "the auth extension isn't an extension ID",
    });
  });

  test("an extension's user replaces the server's", () => {
    const prod = { path: ["prod"], host: "h", port: 1, user: "admin" };
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
      [{ path: ["local"], host: "h", port: 1, timeout: 0 }],
    );
  });

  test("the size limit", () => {
    assert.deepStrictEqual(settings(undefined), { defaults, problems: [] });
    assert.deepStrictEqual(settings(2.5), {
      defaults: { limit: 2500000 },
      problems: [],
    });
  });

  test("a wrong setting is a problem, and its default is used", () => {
    for (const wrong of [0, "10"]) {
      assert.deepStrictEqual(settings(wrong), {
        defaults,
        problems: ["the size limit isn't a positive number of megabytes"],
      });
    }
  });

  test("a password is kept for where it's sent, not the server's name", () => {
    const prod: Definition = {
      path: ["prod"],
      host: "KDB1",
      port: 5010,
      user: "admin",
    };
    const renamed: Definition = { ...prod, path: ["renamed"] };
    assert.strictEqual(secretKey(prod), "password:admin@kdb1:5010");
    assert.strictEqual(secretKey(renamed), secretKey(prod));
    assert.notStrictEqual(
      secretKey({ ...prod, host: "kdb2" }),
      secretKey(prod),
    );
    assert.notStrictEqual(secretKey({ ...prod, port: 5011 }), secretKey(prod));
    assert.notStrictEqual(secretKey({ ...prod, user: "al" }), secretKey(prod));
    assert.strictEqual(
      secretKey({ host: "localhost", port: 5000 }),
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

  test("a server's timeout is its own, with none unless given", () => {
    const local = { path: ["local"], host: "localhost", port: 5000 };
    assert.deepStrictEqual(server(local, {}, defaults), {
      host: "localhost",
      port: 5000,
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
