import * as assert from "node:assert";
import {
  type CredentialsRequest,
  credentials,
  type Sources,
} from "../credentials";
import type { Definition } from "../servers";

const prod: Definition = {
  name: "prod",
  host: "kdb1",
  port: 5010,
  user: "admin",
};

// Sources that fail the test if one is used that shouldn't be
function sources(given: Partial<Sources>): Sources {
  const unused = () => assert.fail("an unexpected source was used");
  return { stored: unused, ask: unused, extension: unused, ...given };
}

async function rejects(
  promise: Promise<unknown>,
  message: string,
  cause: unknown,
) {
  await assert.rejects(promise, (error: Error) => {
    assert.strictEqual(error.message, message);
    assert.deepStrictEqual(error.cause, cause);
    return true;
  });
}

suite("credentials", () => {
  test("with no auth, the password kept for the user, host and port", async () => {
    const keys: string[] = [];
    const stored = async (key: string) => {
      keys.push(key);
      return "pw";
    };
    assert.deepStrictEqual(await credentials(prod, sources({ stored })), {
      password: "pw",
    });
    assert.deepStrictEqual(keys, ["password:admin@kdb1:5010"]);
  });

  test("with no password kept, none", async () => {
    const stored = async () => undefined;
    assert.deepStrictEqual(await credentials(prod, sources({ stored })), {});
  });

  test("a prompt asks every time, and cancelling cancels", async () => {
    const otp: Definition = { ...prod, auth: "prompt" };
    assert.deepStrictEqual(
      await credentials(otp, sources({ ask: async () => "123456" })),
      { password: "123456" },
    );
    assert.strictEqual(
      await credentials(otp, sources({ ask: async () => undefined })),
      undefined,
    );
  });

  test("an extension is asked with the server and its fields", async () => {
    const requests: CredentialsRequest[] = [];
    const ids: string[] = [];
    const sso: Definition = {
      ...prod,
      auth: { extension: "acme.kdb-auth", fields: { realm: "EXAMPLE.COM" } },
    };
    const extension = async (id: string) => {
      ids.push(id);
      return {
        credentials: async (request: CredentialsRequest) => {
          requests.push(request);
          return { user: "token", password: "jwt" };
        },
      };
    };
    assert.deepStrictEqual(await credentials(sso, sources({ extension })), {
      user: "token",
      password: "jwt",
    });
    assert.deepStrictEqual(ids, ["acme.kdb-auth"]);
    assert.deepStrictEqual(requests, [
      {
        name: "prod",
        host: "kdb1",
        port: 5010,
        user: "admin",
        fields: { realm: "EXAMPLE.COM" },
      },
    ]);
  });

  test("an extension can answer without a promise", async () => {
    const sso: Definition = { ...prod, auth: { extension: "a.b", fields: {} } };
    const extension = async () => ({ credentials: () => ({ password: "t" }) });
    assert.deepStrictEqual(await credentials(sso, sources({ extension })), {
      password: "t",
    });
  });

  test("an extension can't change the fields the next connect gets", async () => {
    const sso: Definition = {
      ...prod,
      auth: { extension: "a.b", fields: { scopes: ["kdb"] } },
    };
    const extension = async () => ({
      credentials: (request: CredentialsRequest) => {
        (request.fields.scopes as string[]).push("more");
        return { password: "t" };
      },
    });
    await credentials(sso, sources({ extension }));
    assert.deepStrictEqual(sso.auth, {
      extension: "a.b",
      fields: { scopes: ["kdb"] },
    });
  });

  test("an extension that isn't there, or gives nothing usable, fails", async () => {
    const sso: Definition = { ...prod, auth: { extension: "a.b", fields: {} } };
    await rejects(
      credentials(sso, sources({ extension: async () => undefined })),
      "auth extension not installed",
      "a.b",
    );
    await rejects(
      credentials(sso, sources({ extension: async () => ({}) })),
      "auth extension gives no credentials",
      "a.b exports no credentials function",
    );
    await rejects(
      credentials(sso, sources({ extension: async () => null })),
      "auth extension gives no credentials",
      "a.b exports no credentials function",
    );
    await rejects(
      credentials(
        sso,
        sources({ extension: async () => ({ credentials: () => "admin:pw" }) }),
      ),
      "malformed credentials from auth extension",
      "a.b: not an object",
    );
  });

  test("an extension's own error is kept as the cause", async () => {
    const sso: Definition = { ...prod, auth: { extension: "a.b", fields: {} } };
    const ticket = new Error("no Kerberos ticket");
    const extension = async () => ({
      credentials: async () => {
        throw ticket;
      },
    });
    await rejects(
      credentials(sso, sources({ extension })),
      "auth extension failed",
      ticket,
    );
  });
});
