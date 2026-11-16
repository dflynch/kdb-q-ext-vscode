// The workspace index's answer to each file event, told by stand-in
// watchers rather than VS Code's, whose timing isn't ours to test. The
// files are real, as are findFiles, files.exclude and the settings.
//
// The events each row tells are those VS Code may: a folder created or
// deleted may come without the files in it (as a move or a checkout does),
// and a .q glob's watcher hears only paths that match it
import * as assert from "node:assert";
import * as vscode from "vscode";
import { Problems, type Watch, Workspace } from "../../language";

const folder = () => {
  const f = vscode.workspace.workspaceFolders?.[0];
  assert.ok(f);
  return f.uri;
};

const write = (uri: vscode.Uri, text: string) =>
  vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

const setting = (section: string, key: string, value: unknown) =>
  vscode.workspace
    .getConfiguration(section)
    .update(key, value, vscode.ConfigurationTarget.Workspace);

// Till the extension's own index has answered: each settings change it
// was told of is behind it, and not left for a row's index to hear
const settled = () =>
  vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", "");

async function waitFor(condition: () => Promise<boolean>) {
  for (let i = 0; i < 50 && !(await condition()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(await condition(), "timed out");
}

// A watcher for each glob, whose events the test tells
function watchers() {
  const made = new Map<string, Record<Kind, vscode.EventEmitter<vscode.Uri>>>();
  const watch: Watch = (glob) => {
    const e = {
      create: new vscode.EventEmitter<vscode.Uri>(),
      change: new vscode.EventEmitter<vscode.Uri>(),
      delete: new vscode.EventEmitter<vscode.Uri>(),
    };
    made.set(glob, e);
    return {
      onDidCreate: e.create.event,
      onDidChange: e.change.event,
      onDidDelete: e.delete.event,
      dispose: () => {
        for (const emitter of Object.values(e)) emitter.dispose();
      },
    };
  };
  const tell = (glob: string) => (kind: Kind, uri: vscode.Uri) => {
    const e = made.get(glob);
    assert.ok(e, `no watcher for ${glob}`);
    e[kind].fire(uri);
  };
  return { watch, files: tell("**/*.q"), anything: tell("**") };
}
type Kind = "create" | "change" | "delete";

suite("the workspace index's file events", function () {
  // The folder rows wait out the index's pause before a scan
  this.timeout(10000);

  let n = 0;
  let root: vscode.Uri;
  let collection: vscode.DiagnosticCollection;
  let problems: Problems;
  let workspace: Workspace;
  let tell: ReturnType<typeof watchers>;

  const at = (...path: string[]) => vscode.Uri.joinPath(root, ...path);

  // The files the index has below the row's folder, by path in it
  const indexed = async () => {
    const prefix = `${root.toString()}/`;
    return [...(await workspace.index()).keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  };

  // Each problem as "message line:col", from 1
  const shown = (uri: vscode.Uri) =>
    (collection.get(uri) ?? []).map(
      (d) =>
        `${d.message} ${d.range.start.line + 1}:${d.range.start.character + 1}`,
    );

  // A fresh index for each row, built before the row touches the disk, so
  // the build can't find what only an event should
  setup(async () => {
    root = vscode.Uri.joinPath(folder(), "events", String(++n));
    await vscode.workspace.fs.createDirectory(root);
    collection = vscode.languages.createDiagnosticCollection("q-events");
    problems = new Problems(collection);
    tell = watchers();
    workspace = new Workspace(problems, tell.watch);
    await workspace.index();
  });
  teardown(async () => {
    workspace.dispose();
    problems.dispose();
    await vscode.workspace.fs.delete(root, { recursive: true });
  });
  suiteTeardown(() =>
    vscode.workspace.fs
      .delete(vscode.Uri.joinPath(folder(), "events"), { recursive: true })
      .then(undefined, () => undefined),
  );

  test("a file created, open files only: read, its problems not shown", async () => {
    await write(at("a.q"), "a:(1;2\n");
    tell.files("create", at("a.q"));
    assert.deepStrictEqual(await indexed(), ["a.q"]);
    assert.deepStrictEqual(shown(at("a.q")), []);
  });

  suite("workspace mode", () => {
    suiteSetup(async () => {
      await setting("kdb-q-ext-vscode", "diagnosticMode", "workspace");
      await setting("files", "exclude", { "events/*/skip/**": true });
      await settled();
    });
    suiteTeardown(async () => {
      await setting("kdb-q-ext-vscode", "diagnosticMode", undefined);
      await setting("files", "exclude", undefined);
      await settled();
    });

    test("a file created: read, its problems shown", async () => {
      await write(at("a.q"), "a:(1;2\n");
      tell.files("create", at("a.q"));
      assert.deepStrictEqual(await indexed(), ["a.q"]);
      assert.deepStrictEqual(shown(at("a.q")), [") expected 1:6"]);
    });

    test("a file changed: read again", async () => {
      await write(at("a.q"), "a:(1;2\n");
      tell.files("create", at("a.q"));
      await indexed();
      await write(at("a.q"), "a:(1;2)\n");
      tell.files("change", at("a.q"));
      assert.deepStrictEqual(await indexed(), ["a.q"]);
      assert.deepStrictEqual(shown(at("a.q")), []);
    });

    test("a file deleted: dropped, its problems gone", async () => {
      await write(at("a.q"), "a:(1;2\n");
      tell.files("create", at("a.q"));
      await indexed();
      await vscode.workspace.fs.delete(at("a.q"));
      tell.anything("delete", at("a.q"));
      assert.deepStrictEqual(await indexed(), []);
      assert.deepStrictEqual(shown(at("a.q")), []);
    });

    test("a folder deleted, without its files: each dropped", async () => {
      for (const name of ["a.q", "b.q"]) {
        await write(at("d", name), "a:(1;2\n");
        tell.files("create", at("d", name));
      }
      assert.deepStrictEqual(await indexed(), ["d/a.q", "d/b.q"]);
      await vscode.workspace.fs.delete(at("d"), { recursive: true });
      tell.anything("delete", at("d"));
      assert.deepStrictEqual(await indexed(), []);
      assert.deepStrictEqual(shown(at("d", "a.q")), []);
      assert.deepStrictEqual(shown(at("d", "b.q")), []);
    });

    test("a folder created, without its files: each found, once creating pauses", async () => {
      await write(at("m", "a.q"), "a:(1;2\n");
      tell.anything("create", at("m"));
      await waitFor(async () => (await indexed()).length > 0);
      assert.deepStrictEqual(await indexed(), ["m/a.q"]);
      assert.deepStrictEqual(shown(at("m", "a.q")), [") expected 1:6"]);
    });

    test("a file other than q created: no search for q files", async () => {
      // A q file no event told of, which a search would find
      await write(at("a.q"), "a:(1;2\n");
      await write(at("notes.txt"), "");
      tell.anything("create", at("notes.txt"));
      // Past the pause before a search, and the look at what was created
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.deepStrictEqual(await indexed(), []);
    });

    test("a file files.exclude leaves out: not read", async () => {
      await write(at("skip", "a.q"), "a:(1;2\n");
      tell.files("create", at("skip", "a.q"));
      assert.deepStrictEqual(await indexed(), []);
      assert.deepStrictEqual(shown(at("skip", "a.q")), []);
    });
  });
});
