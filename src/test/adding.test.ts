import * as assert from "node:assert";
import * as vscode from "vscode";
import {
  type Adding,
  type Asker,
  add,
  back,
  type Context,
  type Reply,
} from "../adding";
import { addServer } from "../commands";
import type { Connection } from "../connection";
import { Connections } from "../connections";

type Answer = Reply<string | string[]>;

// An asker answering in turn from a script, checking each answer typed
// passes its question's check. What each question showed is kept: its
// prompt or placeholder, its value or what was chosen, and where it was.
function scripted(answers: Answer[]): Asker & { asked: string[] } {
  const asked: string[] = [];
  const next = <T>(shown: string): Reply<T> => {
    asked.push(shown);
    return answers.shift() as Reply<T>;
  };
  return {
    asked,
    input: async (question) => {
      const answer = next<string>(
        `${question.step}/${question.total} ${question.prompt}${question.value === undefined ? "" : ` [${question.value}]`}`,
      );
      if (typeof answer === "string") {
        assert.strictEqual(
          question.validate?.(answer),
          undefined,
          `${question.prompt} took ${answer}`,
        );
      }
      return answer;
    },
    pick: async (question) =>
      next(
        `${question.step}/${question.total} ${question.placeholder}${question.chosen ? ` [${question.chosen}]` : ""}`,
      ),
    tick: async (question) =>
      next(
        `${question.step}/${question.total} ${question.placeholder}${question.chosen ? ` [${question.chosen}]` : ""}`,
      ),
  };
}

const context: Context = { taken: ["old"], timeout: 2000, workspace: false };

suite("adding a server", () => {
  test("asks for each setting, and the password to store", async () => {
    const ask = scripted([
      "prod",
      "kdb1",
      "5010",
      "dan",
      "store",
      "secret",
      ["protect", "timeout"],
      "2000",
    ]);
    assert.deepStrictEqual(await add(ask, context), {
      name: "prod",
      value: { host: "kdb1", port: 5010, user: "dan" },
      password: "secret",
      passphrase: "",
      workspace: false,
    } satisfies Adding);
    assert.deepStrictEqual(ask.asked, [
      "1/7 The server's name",
      "2/7 The server's host",
      "3/7 The port on kdb1",
      "4/7 The user to log in as, or none",
      "5/7 Where the password comes from",
      "6/8 The password for prod",
      "7/8 Options [protect,timeout]",
      "8/8 How long to wait to connect and log in, in milliseconds [2000]",
    ]);
  });

  test("going back shows the answers given, and keeps them", async () => {
    const ask = scripted([
      "prod",
      "kdb1",
      back,
      back,
      "uat",
      "kdb1",
      "5010",
      "",
      "store",
      "secret",
      back,
      back,
      "none",
      ["protect"],
    ]);
    const adding = await add(ask, context);
    assert.deepStrictEqual(ask.asked.slice(2, 6), [
      "3/7 The port on kdb1",
      "2/7 The server's host [kdb1]",
      "1/7 The server's name [prod]",
      "2/7 The server's host [kdb1]",
    ]);
    // No password asks for none, so the password given before isn't kept
    assert.deepStrictEqual(ask.asked.slice(10), [
      "7/8 Options [protect,timeout]",
      "6/8 The password for uat [secret]",
      "5/8 Where the password comes from [store]",
      "6/7 Options [protect,timeout]",
    ]);
    assert.deepStrictEqual(adding, {
      name: "uat",
      value: { host: "kdb1", port: 5010 },
      password: "",
      passphrase: "",
      workspace: false,
    });
  });

  test("going back from the first question stays there", async () => {
    const ask = scripted([back, "prod", undefined]);
    assert.strictEqual(await add(ask, context), undefined);
    assert.deepStrictEqual(ask.asked, [
      "1/7 The server's name",
      "1/7 The server's name",
      "2/7 The server's host",
    ]);
  });

  test("asking each time, or an extension named, its fields left out", async () => {
    const prompt = scripted(["otp", "kdb1", "1", "", "prompt", ["protect"]]);
    assert.deepStrictEqual((await add(prompt, context))?.value, {
      host: "kdb1",
      port: 1,
      auth: "prompt",
    });
    const sso = scripted([
      "sso",
      "kdb2",
      "5000",
      "",
      "extension",
      "acme.kdb-auth",
      ["protect"],
    ]);
    assert.deepStrictEqual((await add(sso, context))?.value, {
      host: "kdb2",
      port: 5000,
      auth: { extension: "acme.kdb-auth" },
    });
  });

  test("the options: TLS with its files, protect off and a timeout", async () => {
    const ask = scripted([
      "prod",
      "kdb1",
      "5010",
      "",
      "none",
      ["tls", "timeout"],
      ["ca", "client"],
      "~/certs/ca.pem",
      "pem",
      "~/certs/client.pem",
      "~/certs/client.key",
      "secret",
      "500",
    ]);
    assert.deepStrictEqual(await add(ask, context), {
      name: "prod",
      value: {
        host: "kdb1",
        port: 5010,
        tls: {
          ca: "~/certs/ca.pem",
          cert: "~/certs/client.pem",
          key: "~/certs/client.key",
        },
        protect: false,
        timeout: 500,
      },
      password: "",
      passphrase: "secret",
      workspace: false,
    });
    assert.strictEqual(
      ask.asked.at(-1),
      "13/13 How long to wait to connect and log in, in milliseconds [2000]",
    );
  });

  test("a timeout left at the default isn't written", async () => {
    const left = scripted([
      "a",
      "kdb1",
      "1",
      "",
      "none",
      ["protect", "timeout"],
      "2000",
    ]);
    assert.deepStrictEqual((await add(left, context))?.value, {
      host: "kdb1",
      port: 1,
    });
    const set = scripted([
      "b",
      "kdb1",
      "1",
      "",
      "none",
      ["protect", "timeout"],
      "2500",
    ]);
    assert.strictEqual((await add(set, context))?.value.timeout, 2500);
  });

  test("TLS needing no files is true, and a PKCS#12 file is a pfx", async () => {
    const plain = scripted([
      "a",
      "kdb1",
      "1",
      "",
      "none",
      ["tls", "protect"],
      [],
    ]);
    assert.deepStrictEqual((await add(plain, context))?.value.tls, true);
    const pfx = scripted([
      "b",
      "kdb1",
      "2",
      "",
      "none",
      ["tls", "protect"],
      ["client"],
      "pfx",
      "/etc/client.p12",
      "",
    ]);
    assert.deepStrictEqual((await add(pfx, context))?.value.tls, {
      pfx: "/etc/client.p12",
    });
  });

  test("with a workspace open, asks where to keep it", async () => {
    const ask = scripted([
      "prod",
      "kdb1",
      "1",
      "",
      "none",
      ["protect"],
      "workspace",
    ]);
    const adding = await add(ask, { ...context, workspace: true });
    assert.strictEqual(adding?.workspace, true);
    assert.strictEqual(ask.asked.at(-1), "7/7 Where to keep the server");
  });

  test("a cancel adds nothing", async () => {
    assert.strictEqual(
      await add(scripted(["prod", "kdb1", "5010", undefined]), context),
      undefined,
    );
  });

  test("the checks: name, host, port, user, password and file", async () => {
    const problems: (string | undefined)[] = [];
    const tries: Record<string, string[]> = {
      "The server's name": ["old", " ", "prod"],
      "The server's host": [" ", "kdb1:5000", "kdb1"],
      "The port on kdb1": ["0", "65536", "5.5", "5000"],
      "The user to log in as, or none": ["a:b", ""],
      "The password for prod": ["", "secret"],
      "The CA's certificate, in PEM": ["ca.pem", "~/ca.pem"],
    };
    const picks = ["store", ["tls", "protect"], ["ca"]];
    const ask: Asker = {
      input: async (question) => {
        const texts = tries[question.prompt] ?? [];
        problems.push(...texts.map((text) => question.validate?.(text)));
        return texts.at(-1);
      },
      pick: async () => picks.shift() as string,
      tick: async () => picks.shift() as string[],
    };
    await add(ask, context);
    assert.deepStrictEqual(problems, [
      "There's a server named old already",
      "A server needs a name",
      undefined,
      "A host",
      "The port goes in the next step",
      undefined,
      "A port, from 1 to 65535",
      "A port, from 1 to 65535",
      "A port, from 1 to 65535",
      undefined,
      "The user can't contain : or a 0 byte",
      undefined,
      "A password",
      undefined,
      "An absolute path, or one starting with ~/",
      undefined,
    ]);
  });
});

// Secure storage keeping what's stored
function secrets(kept: Record<string, string>): vscode.SecretStorage {
  return {
    get: async (key: string) => kept[key],
    store: async (key: string, value: string) => {
      kept[key] = value;
    },
    delete: async (key: string) => {
      delete kept[key];
    },
    keys: async () => Object.keys(kept),
    onDidChange: () => ({ dispose: () => {} }),
  } as unknown as vscode.SecretStorage;
}

const config = () => vscode.workspace.getConfiguration("kdb-q-ext-vscode");
const added = () => config().inspect("servers")?.globalValue;

suite("addServer", () => {
  const connections = new Connections<Connection>(async () => undefined);
  const window = vscode.window as unknown as Record<string, unknown>;
  const inform = window.showInformationMessage;
  let told: string[] = [];

  setup(() => {
    told = [];
    window.showInformationMessage = async (message: string) => {
      told.push(message);
      return undefined;
    };
  });

  teardown(async () => {
    window.showInformationMessage = inform;
    await config().update(
      "servers",
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  test("writes the server beside the others, and stores its password", async () => {
    await config().update(
      "servers",
      { old: { host: "kdb0", port: 1 } },
      vscode.ConfigurationTarget.Global,
    );
    const kept: Record<string, string> = {};
    await addServer(
      secrets(kept),
      connections,
      scripted([
        " prod ",
        "kdb1.example.com",
        "5010",
        "dan",
        "store",
        "secret",
        ["protect"],
      ]),
    );
    assert.deepStrictEqual(added(), {
      old: { host: "kdb0", port: 1 },
      prod: { host: "kdb1.example.com", port: 5010, user: "dan" },
    });
    assert.deepStrictEqual(kept, {
      "password:dan@kdb1.example.com:5010": "secret",
    });
    assert.deepStrictEqual(told, ["kdb+/q: Added prod."]);
  });

  test("stores a client certificate's passphrase under its key", async () => {
    const kept: Record<string, string> = {};
    await addServer(
      secrets(kept),
      connections,
      scripted([
        "prod",
        "kdb1",
        "5010",
        "",
        "prompt",
        ["tls", "protect"],
        ["client"],
        "pfx",
        "/etc/client.p12",
        "secret",
      ]),
    );
    assert.deepStrictEqual(kept, { "passphrase:/etc/client.p12": "secret" });
  });

  test("says an extension's fields go in settings.json", async () => {
    await addServer(
      secrets({}),
      connections,
      scripted([
        "sso",
        "kdb2",
        "5000",
        "",
        "extension",
        "acme.kdb-auth",
        ["protect"],
      ]),
    );
    assert.match(told[0], /fields its extension takes go in settings.json/);
  });

  test("a cancel writes nothing", async () => {
    await addServer(secrets({}), connections, scripted(["prod", undefined]));
    assert.strictEqual(added(), undefined);
    assert.deepStrictEqual(told, []);
  });
});
