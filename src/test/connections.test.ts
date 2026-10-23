import * as assert from "node:assert";
import { type Change, Connections, type Link } from "../connections";
import type { Definition } from "../servers";

// A stand-in connection, which closes when told to or when the server does
class Fake implements Link {
  closedBy?: string;
  private end: (reason: Error) => void = () => {};
  readonly closed = new Promise<Error>((resolve) => {
    this.end = resolve;
  });
  close(): void {
    this.closedBy ??= "us";
    this.end(new Error("the query was cancelled"));
  }
  // The server closing it
  lose(): void {
    this.closedBy = "server";
    this.end(new Error("the connection closed"));
  }
}

const prod: Definition = { name: "prod", host: "kdb1", port: 5010 };
const dev: Definition = { name: "dev", host: "kdb2", port: 5011 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Connections whose opening is the test's to settle
function connections() {
  const opening: {
    server: Definition;
    resolve: (link: Fake | undefined) => void;
    reject: (error: Error) => void;
  }[] = [];
  const all = new Connections<Fake>(
    (server) =>
      new Promise((resolve, reject) =>
        opening.push({ server, resolve, reject }),
      ),
  );
  const changes: Change[] = [];
  all.onChange((change) => changes.push(change));
  return { all, opening, changes };
}

suite("connections", () => {
  test("connecting makes a server active, connecting then open", async () => {
    const { all, opening } = connections();
    const connected = all.connect(prod);
    assert.deepStrictEqual(all.active, {
      name: "prod",
      state: { kind: "connecting" },
    });
    const link = new Fake();
    opening[0].resolve(link);
    assert.strictEqual(await connected, link);
    assert.deepStrictEqual(all.active, {
      name: "prod",
      state: { kind: "open" },
    });
    assert.strictEqual(all.link("prod"), link);
  });

  test("connecting to one that's open only makes it active", async () => {
    const { all, opening } = connections();
    const first = all.connect(prod);
    opening[0].resolve(new Fake());
    await first;
    const second = all.connect(dev);
    opening[1].resolve(new Fake());
    await second;
    assert.strictEqual(all.active?.name, "dev");
    await all.connect(prod);
    assert.strictEqual(all.active?.name, "prod");
    assert.strictEqual(opening.length, 2);
  });

  test("connecting twice while connecting opens once", async () => {
    const { all, opening } = connections();
    const first = all.connect(prod);
    const second = all.connect(prod);
    const link = new Fake();
    opening[0].resolve(link);
    assert.strictEqual(await first, link);
    assert.strictEqual(await second, link);
    assert.strictEqual(opening.length, 1);
  });

  test("a failure to connect is kept as the reason, and thrown", async () => {
    const { all, opening } = connections();
    const connected = all.connect(prod);
    opening[0].reject(new Error("access"));
    await assert.rejects(connected, { message: "access" });
    const state = all.state("prod");
    assert.ok(state?.kind === "closed");
    assert.strictEqual(state.reason.message, "access");
    assert.strictEqual(all.link("prod"), undefined);
  });

  test("a closed connection is opened again", async () => {
    const { all, opening } = connections();
    const first = all.connect(prod);
    opening[0].reject(new Error("timeout"));
    await assert.rejects(first);
    const second = all.connect(prod);
    const link = new Fake();
    opening[1].resolve(link);
    assert.strictEqual(await second, link);
    assert.strictEqual(all.state("prod")?.kind, "open");
  });

  test("cancelling forgets the server and puts back the active one", async () => {
    const { all, opening } = connections();
    const first = all.connect(dev);
    opening[0].resolve(new Fake());
    await first;
    const second = all.connect(prod);
    opening[1].resolve(undefined);
    assert.strictEqual(await second, undefined);
    assert.strictEqual(all.state("prod"), undefined);
    assert.strictEqual(all.active?.name, "dev");
  });

  test("a connection the server closes stays, with the reason, and is told", async () => {
    const { all, opening, changes } = connections();
    const connected = all.connect(prod);
    const link = new Fake();
    opening[0].resolve(link);
    await connected;
    link.lose();
    await tick();
    assert.deepStrictEqual(all.active?.state, {
      kind: "closed",
      reason: new Error("the connection closed"),
    });
    assert.strictEqual(changes.at(-1)?.lost?.name, "prod");
  });

  test("disconnecting closes and forgets it, and isn't told as lost", async () => {
    const { all, opening, changes } = connections();
    const connected = all.connect(prod);
    const link = new Fake();
    opening[0].resolve(link);
    await connected;
    all.disconnect("prod");
    await tick();
    assert.strictEqual(link.closedBy, "us");
    assert.strictEqual(all.active, undefined);
    assert.deepStrictEqual(all.names, []);
    assert.ok(changes.every((change) => !change.lost));
  });

  test("disconnecting while connecting closes the connection once it opens", async () => {
    const { all, opening } = connections();
    const connected = all.connect(prod);
    all.disconnect("prod");
    const link = new Fake();
    opening[0].resolve(link);
    assert.strictEqual(await connected, undefined);
    assert.strictEqual(link.closedBy, "us");
    assert.deepStrictEqual(all.names, []);
  });

  test("disposing closes them all", async () => {
    const { all, opening } = connections();
    const links = [new Fake(), new Fake()];
    const first = all.connect(prod);
    opening[0].resolve(links[0]);
    await first;
    const second = all.connect(dev);
    opening[1].resolve(links[1]);
    await second;
    all.dispose();
    assert.deepStrictEqual(
      links.map((link) => link.closedBy),
      ["us", "us"],
    );
    assert.deepStrictEqual(all.names, []);
  });
});
