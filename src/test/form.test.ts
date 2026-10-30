import * as assert from "node:assert";
import {
  blank,
  type Context,
  type Form,
  fromSetting,
  port,
  problems,
  toSetting,
} from "../form/fields";
import { definitions } from "../servers";

const context: Context = {
  folder: [],
  scopes: [],
  taken: ["old"],
  workspaceOpen: false,
  tlsFiles: [],
  connected: false,
};

const prod: Form = {
  ...blank(),
  name: "prod",
  host: "kdb1",
  port: "5010",
  user: "admin",
  auth: "store",
  password: "secret",
  timeout: "",
};

suite("the server form's fields", () => {
  test("a server added starts with protected evaluation on, no TLS, and a timeout", () => {
    assert.deepStrictEqual(toSetting({ ...blank(), host: "h", port: "1" }), {
      host: "h",
      port: 1,
      timeout: 2000,
    });
  });

  test("writes only what differs from the defaults, in the README's order", () => {
    assert.deepStrictEqual(
      toSetting({
        ...prod,
        name: " gw ",
        host: " gw.example.com ",
        user: " admin ",
        auth: "prompt",
        tls: true,
        protect: false,
        timeout: "0",
      }),
      {
        host: "gw.example.com",
        port: 5010,
        user: "admin",
        auth: "prompt",
        tls: true,
        protect: false,
        timeout: 0,
      },
    );
    // A password's kept in secure storage, never in settings
    assert.deepStrictEqual(toSetting(prod), {
      host: "kdb1",
      port: 5010,
      user: "admin",
    });
  });

  test("a server added starts with a 2000 ms timeout, and an empty one waits as long as it takes", () => {
    assert.strictEqual(blank().timeout, "2000");
    assert.strictEqual(
      fromSetting("s", { host: "h", port: 1 }, false).timeout,
      "",
    );
    assert.strictEqual(toSetting({ ...prod, timeout: " " }).timeout, undefined);
    assert.deepStrictEqual(
      problems({ ...prod, timeout: "" }, context, false),
      {},
    );
  });

  test("a server's setting round trips through the form", () => {
    for (const value of [
      { host: "h", port: 1 },
      { host: "h", port: 1, user: "u", auth: "extension" as const },
      { host: "h", port: 1, tls: true, protect: false, timeout: 500 },
      { host: "h", port: 1, timeout: 0 },
    ]) {
      assert.deepStrictEqual(
        toSetting(fromSetting("s", value, false)),
        value,
        JSON.stringify(value),
      );
    }
  });

  test("a server with no auth has a stored password, or none", () => {
    const value = { host: "h", port: 1 };
    assert.strictEqual(fromSetting("s", value, true).auth, "store");
    assert.strictEqual(fromSetting("s", value, false).auth, "none");
    assert.strictEqual(
      fromSetting("s", { ...value, auth: "prompt" }, true).auth,
      "prompt",
    );
  });

  test("what the form writes, the settings read", () => {
    const { servers, problems } = definitions({ prod: toSetting(prod) });
    assert.deepStrictEqual(problems, []);
    assert.strictEqual(servers.length, 1);
  });

  test("each field's problem, by field", () => {
    assert.deepStrictEqual(problems(prod, context, false), {});
    assert.deepStrictEqual(
      problems(
        {
          ...prod,
          name: "old",
          host: "kdb1:5000",
          port: "5.5",
          user: "a:b",
          password: "a\0b",
          timeout: "-1",
        },
        context,
        false,
      ),
      {
        name: "old already exists",
        host: "Put the port in Port",
        port: "From 1 to 65535",
        user: "Can't contain : or a 0 byte",
        password: "Can't contain a 0 byte",
        timeout: "A whole number of milliseconds",
      },
    );
    assert.deepStrictEqual(
      problems(
        { ...blank(), name: " ", host: " ", port: "", auth: "store" },
        context,
        false,
      ),
      {
        name: "Required",
        host: "Required",
        port: "Required",
        password: "Required",
      },
    );
    assert.deepStrictEqual(problems({ ...prod, name: "a/b" }, context, false), {
      name: "Can't contain /",
    });
    // An IPv6 address has colons too, but more than one
    assert.deepStrictEqual(
      problems({ ...prod, host: "fe80::1" }, context, false),
      {},
    );
  });

  test("a timeout is at most what a timer takes, and the auth extension's needed to use it", () => {
    assert.deepStrictEqual(
      problems({ ...prod, timeout: "2147483648" }, context, false),
      { timeout: "At most 2147483647" },
    );
    assert.deepStrictEqual(
      problems({ ...prod, timeout: "2147483647" }, context, false),
      {},
    );
    const extension = { ...prod, auth: "extension" as const };
    assert.deepStrictEqual(problems(extension, context, false), {
      auth: "The auth extension isn't set",
    });
    assert.deepStrictEqual(
      problems(extension, { ...context, authExtension: "acme.sso" }, false),
      {},
    );
  });

  test("a password stored for the login needn't be typed again", () => {
    const keep = { ...prod, password: "" };
    assert.deepStrictEqual(problems(keep, context, true), {});
    assert.deepStrictEqual(problems(keep, context, false), {
      password: "Required",
    });
    // Nor is one needed for another way to log in
    assert.deepStrictEqual(
      problems({ ...keep, auth: "none" }, context, false),
      {},
    );
  });

  test("a port is a whole number up to 65535", () => {
    assert.strictEqual(port(" 5010 "), 5010);
    for (const wrong of ["0", "65536", "5.5", "-1", "", "5e3"]) {
      assert.strictEqual(port(wrong), undefined, wrong);
    }
  });
});
