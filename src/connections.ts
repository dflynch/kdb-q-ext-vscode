import { type Definition, id } from "./servers";

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
export type Change = { lost?: { server: Definition; reason: Error } };

type Entry<L> = {
  server: Definition;
  state: State;
  link?: L;
  opening?: Promise<L | undefined>;
  // Aborted by a disconnect while opening
  abort?: AbortController;
};

// The connections open, by their server's id, and the one that's active,
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

  get active(): { id: string; state: State } | undefined {
    const entry = this.current && this.entries.get(this.current);
    return entry && this.current
      ? { id: this.current, state: entry.state }
      : undefined;
  }

  state(id: string): State | undefined {
    return this.entries.get(id)?.state;
  }

  // The servers connected to, whatever their state, as their settings
  // defined them then
  get servers(): Definition[] {
    return [...this.entries.values()].map((entry) => entry.server);
  }

  server(id: string): Definition | undefined {
    return this.entries.get(id)?.server;
  }

  link(id: string): L | undefined {
    const entry = this.entries.get(id);
    return entry?.state.kind === "open" ? entry.link : undefined;
  }

  // Make a server's connection active, opening it if it isn't open. One
  // that closed is opened again. A failure to open is kept as the reason,
  // and thrown. Connecting while it's connecting waits for the same
  // outcome.
  async connect(server: Definition): Promise<L | undefined> {
    const key = id(server.path);
    const existing = this.entries.get(key);
    if (existing?.state.kind === "open") {
      this.activate(key);
      return existing.link;
    }
    if (existing?.opening) {
      this.activate(key);
      return existing.opening;
    }
    const entry: Entry<L> = { server, state: { kind: "connecting" } };
    this.entries.set(key, entry);
    const before = this.current;
    this.current = key;
    entry.opening = this.opened(entry, before);
    this.emit({});
    return entry.opening;
  }

  // The connection opened for an entry, or undefined if it's cancelled or
  // disconnected while connecting, which isn't a failure
  private async opened(
    entry: Entry<L>,
    before: string | undefined,
  ): Promise<L | undefined> {
    const { server } = entry;
    const key = id(server.path);
    const abort = new AbortController();
    entry.abort = abort;
    let link: L | undefined;
    try {
      link = await this.open(server, { signal: abort.signal });
    } catch (error) {
      if (this.entries.get(key) !== entry) {
        // Disconnected while connecting, as it failed: no one's waiting to
        // be told
        return undefined;
      }
      entry.opening = undefined;
      entry.state = { kind: "closed", reason: error as Error };
      this.emit({});
      throw error;
    }
    if (this.entries.get(key) !== entry) {
      // Disconnected while connecting
      link?.close();
      return undefined;
    }
    entry.opening = undefined;
    entry.abort = undefined;
    if (link === undefined) {
      this.entries.delete(key);
      this.current = before;
      this.emit({});
      return undefined;
    }
    entry.link = link;
    entry.state = { kind: "open" };
    this.emit({});
    const opened = link;
    opened.closed.then((reason) => {
      if (this.entries.get(key)?.link === opened) {
        entry.state = { kind: "closed", reason };
        this.emit({ lost: { server, reason } });
      }
    });
    return link;
  }

  // Close a connection and forget it
  disconnect(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    this.entries.delete(id);
    if (this.current === id) {
      this.current = undefined;
    }
    entry.abort?.abort();
    entry.link?.close();
    this.emit({});
  }

  // Close them all, as the extension stops
  dispose(): void {
    for (const id of [...this.entries.keys()]) {
      this.disconnect(id);
    }
  }

  private activate(id: string): void {
    if (this.current !== id) {
      this.current = id;
      this.emit({});
    }
  }

  private emit(change: Change): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}
