import * as vscode from "vscode";
import type { Connection } from "./connection";
import type { Connections, State } from "./connections";
import type { Definition } from "./servers";
import { passphraseKey } from "./tls";

// How long a query took, in whole milliseconds, as \t gives
export type Timing = {
  // From sending the query to the last of its response arriving
  roundtrip: number;
  // The server's time running it, with protected evaluation: not
  // serialising the result, nor formatting a backtrace
  execution?: number;
};

// What a query tells the status bar: that it's running on a server; with the
// function that gives back, that it ended, after the roundtrip given if a
// response came; and with the function that gives back, how long the server
// took, once the Result view has read it from the response. That's dropped
// if another query's timing has replaced this one's.
export type Status = {
  running(
    name: string,
  ): (roundtrip: number | undefined) => (execution: number) => void;
};

// A state as a few words: a closed one's reason, which says how it closed
export function describe(state: State): string {
  switch (state.kind) {
    case "connecting":
      return "connecting";
    case "open":
      return "connected";
    case "closed":
      return state.reason.message;
  }
}

// How long a query took: the server's time, as \t gives, with protected
// evaluation, and the roundtrip
export function took(timing: Timing): string {
  return timing.execution === undefined
    ? `${timing.roundtrip} ms roundtrip`
    : `${timing.execution} ms (${timing.roundtrip} ms roundtrip)`;
}

// The last query's timing, and the server it ran on. A query that ended
// without a response leaves none. Its server time comes after it ends, once
// the Result view has read the response, and is dropped if another query has
// ended since, or the timing was cleared. changed is called when a timing
// arrives.
export function lastTiming(changed: () => void) {
  let last: { name: string; timing: Timing } | undefined;
  return {
    get: () => last,
    clear: () => {
      last = undefined;
    },
    ended: (name: string, roundtrip: number | undefined) => {
      const ended: typeof last =
        roundtrip === undefined ? undefined : { name, timing: { roundtrip } };
      last = ended;
      changed();
      return (execution: number) => {
        if (ended && last === ended) {
          ended.timing = { roundtrip: ended.timing.roundtrip, execution };
          changed();
        }
      };
    },
  };
}

// A server's settings, a line each, all but secrets: where the password
// comes from, not what it is, and an extension's name, not the fields it's
// given
export function details(server: Definition): string[] {
  const auth =
    server.auth === undefined
      ? "Stored password"
      : server.auth === "prompt"
        ? "Ask each time"
        : `Extension ${server.auth.extension}`;
  const tls =
    server.tls === undefined
      ? "Off"
      : passphraseKey(server.tls) === undefined
        ? "On"
        : "On, with a client certificate";
  const timeout =
    server.timeout === undefined
      ? "Default"
      : server.timeout === 0
        ? "None"
        : `${server.timeout} ms`;
  return [
    `Host: ${server.host}:${server.port}`,
    ...(server.user ? [`User: ${server.user}`] : []),
    `Authentication: ${auth}`,
    `TLS: ${tls}`,
    `Protected evaluation: ${server.protect === false ? "Off" : "On"}`,
    `Connection timeout: ${timeout}`,
  ];
}

// The active connection in the status bar, which opens the server menu when
// clicked, with how long its last query took, and a warning when a
// connection closes without being disconnected. The icon says the
// connection's state, a plug joined or pulled apart, spinning while it
// connects or runs a query, and the tooltip gives the server's settings as
// it was connected to.
export function showStatus(
  connections: Connections<Connection>,
): Status & vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "kdb-q-ext-vscode.connection",
    vscode.StatusBarAlignment.Left,
  );
  item.name = "kdb+/q Connection";
  item.command = "kdb-q-ext-vscode.showServerMenu";
  // The last query's timing, kept while its connection is open, and how
  // many queries are running on each server: another can be tried while one
  // runs, though the connection refuses it
  const last = lastTiming(() => update());
  const running = new Map<string, number>();
  const update = () => {
    const active = connections.active;
    const server = active && connections.server(active.name);
    const busy =
      active?.state.kind === "open" && (running.get(active.name) ?? 0) > 0;
    const icon =
      active?.state.kind === "connecting" || busy
        ? "loading~spin"
        : active?.state.kind === "open"
          ? "debug-connected"
          : "debug-disconnect";
    const ended = last.get();
    const timing =
      !busy && ended?.name === active?.name ? ended?.timing : undefined;
    item.text = `$(${icon}) ${active?.name ?? "kdb+/q"}${timing ? `  $(watch) ${took(timing)}` : ""}`;
    // The icon says the state, so screen readers are told it in words
    item.accessibilityInformation = {
      label: active
        ? `kdb+/q: ${active.name}, ${busy ? "running a query" : describe(active.state)}${timing ? `, last query ${took(timing)}` : ""}`
        : "kdb+/q: not connected",
    };
    item.tooltip = server
      ? details(server).join("\n")
      : "kdb+/q: Not connected";
    item.backgroundColor =
      active?.state.kind === "closed"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  };
  update();
  item.show();
  const stop = connections.onChange(({ lost }) => {
    const ended = last.get();
    if (ended && connections.state(ended.name)?.kind !== "open") {
      last.clear();
    }
    update();
    if (lost) {
      vscode.window.showWarningMessage(
        `kdb+/q: ${lost.name}: ${lost.reason.message}`,
      );
    }
  });
  return {
    running: (name) => {
      running.set(name, (running.get(name) ?? 0) + 1);
      update();
      return (roundtrip) => {
        running.set(name, (running.get(name) ?? 0) - 1);
        return last.ended(name, roundtrip);
      };
    },
    dispose: () => {
      stop();
      item.dispose();
    },
  };
}
