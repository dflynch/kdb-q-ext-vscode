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
  return {
    stored: unused,
    ask: unused,
    authExtension: unused,
    extension: unused,
    ...given,
  };
}

// Sources with the auth extension set to a.b, and its exports as given
function signOn(extension: Sources["extension"]): Sources {
  return sources({ authExtension: () => "a.b", extension });
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
  test("a stored password is the one kept for the user, host and port", async () => {
    const keys: string[] = [];
    const stored = async (key: string) => {
      keys.push(key);
      return "pw";
    };
    const kept: Definition = { ...prod, auth: "store" };
    assert.deepStrictEqual(await credentials(kept, sources({ stored })), {
      password: "pw",
    });
    assert.deepStrictEqual(keys, ["password:admin@kdb1:5010"]);
  });

  test("a stored password that isn't stored is a failure", async () => {
    const kept: Definition = { ...prod, auth: "store" };
    await assert.rejects(
      credentials(kept, sources({ stored: async () => undefined })),
      { message: "password not stored" },
    );
  });

  test("with no auth, no password, even one stored for the login", async () => {
    const stored = async () => "pw";
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

  test("an extension is asked with the server", async () => {
    const requests: CredentialsRequest[] = [];
    const ids: string[] = [];
    const sso: Definition = { ...prod, auth: "extension" };
    const extension = async (id: string) => {
      ids.push(id);
      return {
        credentials: async (request: CredentialsRequest) => {
          requests.push(request);
          return { user: "token", password: "jwt" };
        },
      };
    };
    assert.deepStrictEqual(
      await credentials(
        sso,
        sources({ authExtension: () => "acme.kdb-auth", extension }),
      ),
      {
        user: "token",
        password: "jwt",
      },
    );
    assert.deepStrictEqual(ids, ["acme.kdb-auth"]);
    assert.deepStrictEqual(requests, [
      {
        name: "prod",
        host: "kdb1",
        port: 5010,
        user: "admin",
      },
    ]);
  });

  test("an extension can answer without a promise", async () => {
    const sso: Definition = { ...prod, auth: "extension" };
    const extension = async () => ({ credentials: () => ({ password: "t" }) });
    assert.deepStrictEqual(await credentials(sso, signOn(extension)), {
      password: "t",
    });
  });

  test("an auth extension unset or not an ID fails", async () => {
    const sso: Definition = { ...prod, auth: "extension" };
    await rejects(
      credentials(sso, sources({ authExtension: () => undefined })),
      "auth extension not set",
      undefined,
    );
    await rejects(
      credentials(sso, sources({ authExtension: () => "kdb-auth" })),
      "invalid auth extension",
      "the auth extension isn't an extension ID",
    );
  });

  test("an extension that isn't there, or gives nothing usable, fails", async () => {
    const sso: Definition = { ...prod, auth: "extension" };
    await rejects(
      credentials(
        sso,
        signOn(async () => undefined),
      ),
      "auth extension not installed",
      "a.b",
    );
    await rejects(
      credentials(
        sso,
        signOn(async () => ({})),
      ),
      "auth extension gives no credentials",
      "a.b exports no credentials function",
    );
    await rejects(
      credentials(
        sso,
        signOn(async () => null),
      ),
      "auth extension gives no credentials",
      "a.b exports no credentials function",
    );
    await rejects(
      credentials(
        sso,
        signOn(async () => ({ credentials: () => "admin:pw" })),
      ),
      "malformed credentials from auth extension",
      "a.b: not an object",
    );
  });

  test("an extension's own error is kept as the cause", async () => {
    const sso: Definition = { ...prod, auth: "extension" };
    const ticket = new Error("no Kerberos ticket");
    const extension = async () => ({
      credentials: async () => {
        throw ticket;
      },
    });
    await rejects(
      credentials(sso, signOn(extension)),
      "auth extension failed",
      ticket,
    );
  });
});
