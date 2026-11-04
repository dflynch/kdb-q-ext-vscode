// What the tests share: stand-in tabs, secure storage and connections, and
// the servers setting in each scope
import * as vscode from "vscode";
import type { Connection } from "../connection";
import { Connections } from "../connections";
import type { FromForm, ToForm } from "../form/fields";
import type { Panels } from "../resultView";
import type { Definition } from "../servers";

// Stand-in editor tabs, keeping each one's title and what it's posted, and
// saying what it's told to. Each can wait for the next thing posted, or for
// it to be closed.
export function tabs() {
  const made: ReturnType<typeof tab>[] = [];
  const tab = (type: string, title: string) => {
    const posted: ToForm[] = [];
    const waiting: ((message: ToForm) => void)[] = [];
    let say: (message: FromForm) => void = () => {};
    let disposed = () => {};
    let closed = false;
    let revealed = 0;
    const closing = new Promise<void>((resolve) => {
      disposed = () => {
        closed = true;
        resolve();
      };
    });
    const panel = {
      webview: {
        cspSource: "https://source.example",
        options: {},
        html: "",
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: FromForm) => void) => {
          say = listener;
        },
        postMessage: async (message: ToForm) => {
          posted.push(message);
          waiting.shift()?.(message);
          return true;
        },
      },
      reveal: () => {
        revealed += 1;
      },
      onDidDispose: (listener: () => void) => {
        const then = disposed;
        disposed = () => {
          then();
          listener();
        };
      },
      dispose: () => disposed(),
    } as unknown as vscode.WebviewPanel;
    return {
      type,
      title,
      panel,
      posted,
      get closed() {
        return closed;
      },
      get revealed() {
        return revealed;
      },
      closing,
      next: () => new Promise<ToForm>((resolve) => waiting.push(resolve)),
      say: (message: FromForm) => say(message),
      // The form as first loaded
      loaded: async () => {
        const next = new Promise<ToForm>((resolve) => waiting.push(resolve));
        say({ type: "ready" });
        return (await next) as Extract<ToForm, { type: "load" }>;
      },
    };
  };
  const panels = ((type: string, title: string) => {
    const made1 = tab(type, title);
    made.push(made1);
    return made1.panel;
  }) as unknown as Panels;
  return { made, panels };
}

// Secure storage keeping what's stored
export function secrets(kept: Record<string, string>): vscode.SecretStorage {
  return {
    get: async (key: string) => kept[key],
    store: async (key: string, value: string) => {
      kept[key] = value;
    },
    delete: async (key: string) => {
      delete kept[key];
    },
    keys: async () => Object.keys(kept),
  } as unknown as vscode.SecretStorage;
}

export const config = () =>
  vscode.workspace.getConfiguration("kdb-q-ext-vscode");
export const user = () => config().inspect("servers")?.globalValue;
export const workspace = () => config().inspect("servers")?.workspaceValue;
export const setUser = (value: unknown) =>
  config().update("servers", value, vscode.ConfigurationTarget.Global);
export const setWorkspace = (value: unknown) =>
  config().update("servers", value, vscode.ConfigurationTarget.Workspace);

// Settings updates refused, those to the targets refuse says, while run
// runs, as VS Code refuses a settings file with unsaved changes
export async function refusing<T>(
  refuse: (target: vscode.ConfigurationTarget) => boolean,
  run: () => Promise<T>,
): Promise<T> {
  const { workspace } = vscode;
  const configuration = workspace.getConfiguration;
  workspace.getConfiguration = ((...args: Parameters<typeof configuration>) => {
    const config = configuration(...args);
    return Object.create(config, {
      update: {
        value: async (
          ...update: Parameters<vscode.WorkspaceConfiguration["update"]>
        ) => {
          if (refuse(update[2] as vscode.ConfigurationTarget)) {
            throw new Error("the file has unsaved changes");
          }
          return config.update(...update);
        },
      },
    });
  }) as typeof configuration;
  try {
    return await run();
  } finally {
    workspace.getConfiguration = configuration;
  }
}

// Connections to the servers given, in turn: those open, those that failed
// to open, so closed, and those still connecting. The last is active.
export async function connectionsWith(
  open: Definition[],
  failed: Definition[] = [],
  connecting: Definition[] = [],
) {
  const link = { closed: new Promise<Error>(() => {}), close: () => {} };
  const all = new Connections<Connection>((server) =>
    failed.includes(server)
      ? Promise.reject(new Error("hop"))
      : connecting.includes(server)
        ? new Promise(() => {})
        : Promise.resolve(link as unknown as Connection),
  );
  for (const server of open) {
    await all.connect(server);
  }
  for (const server of failed) {
    await all.connect(server).catch(() => {});
  }
  for (const server of connecting) {
    all.connect(server);
  }
  return all;
}
