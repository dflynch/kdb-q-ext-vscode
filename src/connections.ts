import type { Definition } from "./servers";

// What the open connections need of one, so that tests can stand in for it
export interface Link {
  // Resolves with why it closed, however it did
  readonly closed: Promise<Error>;
  close(): void;
}

export type State =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; reason: Error };

// What's changed: a connection's state, or which is active. A connection
// that closed without being disconnected says why.
export type Change = { lost?: { name: string; reason: Error } };

type Entry<L> = {
  server: Definition;
  state: State;
  link?: L;
  opening?: Promise<L | undefined>;
  // Aborted by a disconnect while opening
  abort?: AbortController;
};

// The connections open, by their server's name, and the one that's active,
// which queries go to. A connection that closes, however it does, stays
// until it's disconnected, with the reason, so that it can be told.
export class Connections<L extends Link> {
  private entries = new Map<string, Entry<L>>();
  private current?: string;
  private listeners = new Set<(change: Change) => void>();

  // open gives a connection to a server, or undefined if the user cancels,
  // such as when asked for a password; it stops when the signal's aborted
  constructor(
    private open: (
      server: Definition,
      options: { signal: AbortSignal },
    ) => Promise<L | undefined>,
  ) {}

  onChange(listener: (change: Change) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get active(): { name: string; state: State } | undefined {
    const entry = this.current && this.entries.get(this.current);
    return entry && this.current
      ? { name: this.current, state: entry.state }
      : undefined;
  }

  state(name: string): State | undefined {
    return this.entries.get(name)?.state;
  }

  // The names of the connections, whatever their state
  get names(): string[] {
    return [...this.entries.keys()];
  }

  // The server as its settings defined it when it was connected to
  server(name: string): Definition | undefined {
    return this.entries.get(name)?.server;
  }

  link(name: string): L | undefined {
    const entry = this.entries.get(name);
    return entry?.state.kind === "open" ? entry.link : undefined;
  }

  // Make a server's connection active, opening it if it isn't open. One
  // that closed is opened again. A failure to open is kept as the reason,
  // and thrown.
  async connect(server: Definition): Promise<L | undefined> {
    const existing = this.entries.get(server.name);
    if (existing?.state.kind === "open") {
      this.activate(server.name);
      return existing.link;
    }
    if (existing?.opening) {
      this.activate(server.name);
      return existing.opening;
    }
    const before = this.current;
    const abort = new AbortController();
    const entry: Entry<L> = { server, state: { kind: "connecting" }, abort };
    this.entries.set(server.name, entry);
    this.current = server.name;
    entry.opening = this.open(server, { signal: abort.signal });
    this.emit({});
    let link: L | undefined;
    try {
      link = await entry.opening;
    } catch (error) {
      if (this.entries.get(server.name) !== entry) {
        // Disconnected while connecting, which stopped it
        return undefined;
      }
      entry.opening = undefined;
      entry.state = { kind: "closed", reason: error as Error };
      this.emit({});
      throw error;
    }
    if (this.entries.get(server.name) !== entry) {
      // Disconnected while connecting
      link?.close();
      return undefined;
    }
    entry.opening = undefined;
    entry.abort = undefined;
    if (link === undefined) {
      this.entries.delete(server.name);
      this.current = before;
      this.emit({});
      return undefined;
    }
    entry.link = link;
    entry.state = { kind: "open" };
    this.emit({});
    const opened = link;
    opened.closed.then((reason) => {
      if (this.entries.get(server.name)?.link === opened) {
        entry.state = { kind: "closed", reason };
        this.emit({ lost: { name: server.name, reason } });
      }
    });
    return link;
  }

  // Close a connection and forget it
  disconnect(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) {
      return;
    }
    this.entries.delete(name);
    if (this.current === name) {
      this.current = undefined;
    }
    entry.abort?.abort();
    entry.link?.close();
    this.emit({});
  }

  // Close them all, as the extension stops
  dispose(): void {
    for (const name of this.names) {
      this.disconnect(name);
    }
  }

  private activate(name: string): void {
    if (this.current !== name) {
      this.current = name;
      this.emit({});
    }
  }

  private emit(change: Change): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}
