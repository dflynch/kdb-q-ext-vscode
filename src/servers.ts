import type { Server } from "./connection";
import { longestTimeout, type Scope, shown } from "./form/fields";
import { passwordProblem, userProblem } from "./login";
import type { Secure } from "./tls";

// A server as the settings define it: everything but the password, which is
// kept in VS Code's secure storage, never in a settings file
export type Definition = {
  // The folders it's in, outermost first, then its own name
  path: string[];
  host: string;
  port: number;
  user?: string;
  // How long to wait to connect and log in, in milliseconds; unset or 0
  // waits as long as it takes, as hopen does
  timeout?: number;
  // Whether to evaluate queries protected, so that an error comes back with
  // its backtrace: on unless false, as a server that enforces an allowlist
  // won't evaluate it
  protect?: boolean;
  // Whether to connect with TLS, with the files in the TLS settings
  tls?: boolean;
  // Where the password comes from: none unless it's given
  auth?: Auth;
};

// A password kept in VS Code's secure storage, for the user, host and port;
// one asked for at every connect and never kept, where a firm doesn't allow
// one to be stored or it changes too often to keep; or one the auth
// extension gives, for a firm's own sign-on: a Kerberos ticket or an access
// token, say, which the server checks in .z.pw. The authExtension setting
// names the extension, once for every server, so no other extension is given
// a server's login by taking a name agreed in advance. "none", as the
// setting can say, is read as no auth.
export type Auth = "store" | "prompt" | "extension";

// What a login is made of
export type Credentials = { user?: string; password?: string };

// The settings a connection uses, besides the server's own
export type Defaults = {
  // In bytes
  limit: number;
};

export const defaults: Defaults = { limit: 100e6 };

// A server's fields as written, once checked
type Fields = Omit<Definition, "path">;

const fields = new Set([
  "host",
  "port",
  "user",
  "timeout",
  "protect",
  "tls",
  "auth",
]);

// Shared with the server form, which can't import this
export { shown };

// What a server's known by inside the extension, for its connection and its
// form: its path, as no name in it can be mistaken for part of another.
// Never shown.
export function id(path: string[]): string {
  return JSON.stringify(path);
}

// Whether a path is a folder's, or is in it, at any depth
export function within(path: string[], folder: string[]): boolean {
  return (
    path.length >= folder.length && folder.every((name, i) => path[i] === name)
  );
}

// A problem in the servers setting, at the path of what has it, empty for
// the setting itself: not a server or a folder
export type Problem = { path: string[]; problem: string };

// A problem as it's told, after what has it, by its path: Dev › rdb: not a
// server or a folder
export function said({ path, problem }: Problem): string {
  const own = path.at(-1);
  const folder = path.slice(0, -1);
  const what =
    own === undefined
      ? "the setting"
      : own.trim() !== ""
        ? shown(path)
        : folder.length > 0
          ? `an entry in ${shown(folder)}`
          : "an entry";
  return `${what}: ${problem}`;
}

// A Marketplace extension ID, publisher.name
export const extensionId = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// A timeout, in milliseconds: 0 waits as long as it takes, as hopen does
function isTimeout(value: unknown): value is number {
  return value === 0 || (isCount(value) && value <= longestTimeout);
}

// The servers in a setting, in the order written. An object with a host
// or a port is a server, and any other is a folder, holding servers and
// folders, or nothing. VS Code doesn't hold a setting to its schema, so
// each is checked here too; one with a problem is skipped and the problem
// said, rather than connecting somewhere other than meant, such as without
// a user whose name was misspelt.
export function definitions(setting: unknown): {
  servers: Definition[];
  problems: Problem[];
} {
  const servers: Definition[] = [];
  const problems: Problem[] = [];
  if (setting === undefined || setting === null) {
    return { servers, problems };
  }
  if (!isObject(setting)) {
    return { servers, problems: [{ path: [], problem: "not an object" }] };
  }
  const read = (folder: Record<string, unknown>, at: string[]) => {
    for (const [key, value] of Object.entries(folder)) {
      const path = [...at, key];
      const problem = entryProblem(key, value);
      if (problem) {
        problems.push({ path, problem });
        continue;
      }
      const object = value as Record<string, unknown>;
      if (!isServer(object)) {
        read(object, path);
      } else {
        servers.push(definition(path, object as Fields));
      }
    }
  };
  read(setting, []);
  return { servers, problems };
}

// What's in the servers setting, as the Servers view shows it: a folder,
// with what it holds, or a server; with the problem each has, if one does.
// A server with one is anything else written in a folder, whatever it is,
// so that it can be fixed in its form; a folder with one, a folder with no
// name, holds nothing that's read.
export type Entry =
  | { kind: "folder"; path: string[]; entries: Entry[]; problem?: string }
  | { kind: "server"; path: string[]; server?: Definition; problem?: string };

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// The entries in a folder, or the setting, folders first, then servers,
// each A to Z, as the Explorer has files
export function entries(folder: Record<string, unknown>, at: string[] = []) {
  const found = Object.entries(folder).map(([key, value]): Entry => {
    const path = [...at, key];
    const problem = entryProblem(key, value);
    if (isObject(value) && !isServer(value)) {
      return problem
        ? { kind: "folder", path, entries: [], problem }
        : { kind: "folder", path, entries: entries(value, path) };
    }
    return problem
      ? { kind: "server", path, problem }
      : { kind: "server", path, server: definition(path, value as Fields) };
  });
  return found.sort(
    (a, b) =>
      Number(a.kind === "server") - Number(b.kind === "server") ||
      collator.compare(a.path.at(-1) ?? "", b.path.at(-1) ?? ""),
  );
}

// What's at a path in a setting: a folder, anything else, which is a
// server or should be, or nothing
export function kindAt(
  setting: unknown,
  path: string[],
): Entry["kind"] | undefined {
  const value = at(setting, path);
  return value === undefined
    ? undefined
    : isObject(value) && !isServer(value)
      ? "folder"
      : "server";
}

// The servers setting as written in each scope
export type Written = Record<Scope, unknown>;

// The servers the scopes define together: a folder in both holds what each
// has; anything else in the workspace's replaces what's at its place in the
// user's whole, rather than VS Code's merge, which mixes their fields, so
// that a server is as one scope writes it
export function read(written: Written): Definition[] {
  return definitions(merged(written)).servers;
}

// The servers setting as the scopes write it together
// A scope whose setting isn't an object is left out, so that it hides
// nothing of the other's.
export function merged(written: Written): unknown {
  const readable = (setting: unknown) =>
    isObject(setting) ? setting : undefined;
  return merge(readable(written.user), readable(written.workspace), true);
}

// The user's and the workspace's values at the same place, as read
// together: two folders, or the settings themselves, which are folders,
// are merged, the user's names first, and otherwise the workspace's wins
export function merge(user: unknown, workspace: unknown, folders = false) {
  if (workspace === undefined) {
    return user;
  }
  if (
    !isObject(user) ||
    !isObject(workspace) ||
    (!folders && (isServer(user) || isServer(workspace)))
  ) {
    return workspace;
  }
  const merged = new Map(Object.entries(user));
  for (const [key, value] of Object.entries(workspace)) {
    merged.set(key, merge(merged.get(key), value));
  }
  return Object.fromEntries(merged);
}

// Whether a value is an object, as the servers setting and its folders and
// servers are
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// What's at a path in the setting, or undefined if nothing is
export function at(setting: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (folder, key) =>
      isObject(folder) && Object.hasOwn(folder, key) ? folder[key] : undefined,
    setting,
  );
}

// The setting with a value put at a path, or what's there deleted for
// undefined, the setting given left as it was. Renamed from another name
// in the same folder, it takes that one's place among the rest; otherwise
// it keeps its own, or goes last. Folders missing on the way are made.
export function put(
  setting: Record<string, unknown>,
  path: string[],
  value: unknown,
  from?: string,
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (rest.length > 0) {
    // A folder this scope writes as a server, or anything else, is left as
    // it is, rather than written into or replaced
    const folder = at(setting, [key]);
    if (folder !== undefined && !(isObject(folder) && !isServer(folder))) {
      throw new Error(`${key} isn't a folder in this scope's settings`);
    }
    return replaced(
      setting,
      key,
      key,
      put(isObject(folder) ? folder : {}, rest, value, from),
    );
  }
  return replaced(setting, from ?? key, key, value);
}

// An object with one key replaced by another, in its place
function replaced(
  object: Record<string, unknown>,
  old: string,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const [k, v] of Object.entries(object)) {
    if (k === old) {
      entries.set(key, value);
    } else if (k !== key) {
      entries.set(k, v);
    }
  }
  if (!entries.has(key)) {
    entries.set(key, value);
  }
  if (value === undefined) {
    entries.delete(key);
  }
  return Object.fromEntries(entries);
}

// An object with a host or a port is a server, and any other a folder, so
// that each is told by what it has itself: a mistake in a folder's entry
// doesn't make a server of the folder. A server named host or port is an
// object, as a server's own host and port aren't.
export function isServer(value: Record<string, unknown>): boolean {
  return ["host", "port"].some(
    (field) => Object.hasOwn(value, field) && !isObject(value[field]),
  );
}

// The problem with an entry in a folder, by its name and its value
export function entryProblem(name: string, value: unknown): string | undefined {
  return name.trim() === "" ? "no name" : check(value);
}

// A server as checked
function definition(path: string[], value: Fields): Definition {
  const { host, port, user, timeout, protect, tls, auth } = value as Fields;
  return {
    path,
    host,
    port,
    ...(user === undefined ? {} : { user }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(protect === undefined ? {} : { protect }),
    ...(tls ? { tls } : {}),
    ...(auth === undefined || (auth as string) === "none" ? {} : { auth }),
  };
}

// A problem with a server, or with something in a folder that's neither a
// server nor a folder
function check(value: unknown): string | undefined {
  if (!isObject(value)) {
    return "not a server or a folder";
  }
  if (!isServer(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    return unknown.length === 1
      ? `unknown field: ${unknown[0]}`
      : `unknown fields: ${unknown.join(", ")}`;
  }
  const { host, port, user, timeout, protect, tls, auth } = value as Record<
    string,
    unknown
  >;
  if (typeof host !== "string" || host.trim() === "") {
    return "no host";
  }
  if (!isCount(port) || port > 65535) {
    return "port must be from 1 to 65535";
  }
  // q takes the login as user:password, ending at a 0 byte
  if (user !== undefined && (typeof user !== "string" || userProblem(user))) {
    return "user can't contain : or a 0 byte";
  }
  if (timeout !== undefined && !isTimeout(timeout)) {
    return isCount(timeout)
      ? `timeout must be at most ${longestTimeout} ms`
      : "timeout must be a whole number of milliseconds";
  }
  if (protect !== undefined && typeof protect !== "boolean") {
    return "protect must be true or false";
  }
  if (tls !== undefined && typeof tls !== "boolean") {
    return "tls must be true or false";
  }
  if (
    auth !== undefined &&
    !["none", "store", "prompt", "extension"].includes(auth as string)
  ) {
    return 'auth must be "none", "store", "prompt" or "extension"';
  }
  return undefined;
}

// The auth extension's ID, as its setting gives it, or undefined if it's
// unset; with the problem said for one that isn't an ID
export function authExtension(setting: unknown): {
  id?: string;
  problem?: string;
} {
  if (setting === undefined || setting === null || setting === "") {
    return {};
  }
  return typeof setting === "string" && extensionId.test(setting)
    ? { id: setting }
    : { problem: "the auth extension must be an extension ID" };
}

// The size limit, in megabytes; one that's wrong is refused, so that the
// connect that reads it fails, saying why, rather than use another
export function settings(megabytes: unknown): Defaults {
  if (megabytes === undefined) {
    return defaults;
  }
  if (typeof megabytes === "number" && megabytes > 0) {
    return { ...defaults, limit: Math.round(megabytes * 1e6) };
  }
  throw new Error(
    "invalid sizeLimit setting: must be a positive number of megabytes",
  );
}

// Where a server's password is kept. Keyed by where it's sent, not by the
// server's name, so that a password is never sent to a host other than the
// one it was given for, if a server's host is changed
export function secretKey(
  server: Pick<Definition, "user" | "host" | "port">,
): string {
  return `password:${server.user ?? ""}@${server.host.toLowerCase()}:${server.port}`;
}

// Credentials as an extension gave them, checked as the setting is: they
// come from code that isn't ours
export function credentialsProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "not an object";
  }
  const { user, password } = value as Record<string, unknown>;
  if (user !== undefined && (typeof user !== "string" || userProblem(user))) {
    return "the user can't contain : or a 0 byte";
  }
  if (typeof password !== "string") {
    return "no password";
  }
  return passwordProblem(password);
}

// What a connection needs, with the TLS options read from the TLS
// files. A user in the credentials, as an extension can give, replaces the
// server's.
export function server(
  definition: Definition,
  { user = definition.user, password }: Credentials,
  { limit }: Defaults,
  tls?: Secure,
): Server {
  return {
    host: definition.host,
    port: definition.port,
    ...(user === undefined ? {} : { user }),
    ...(password === undefined ? {} : { password }),
    ...(definition.timeout === undefined
      ? {}
      : { timeout: definition.timeout }),
    limit,
    protect: definition.protect ?? true,
    ...(tls === undefined ? {} : { tls }),
  };
}
