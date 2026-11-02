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

// A problem in the servers setting, at the path of what has it, empty for
// the setting itself, said of it: isn't a server or a folder
export type Problem = { path: string[]; problem: string };

// A problem as a clause, with what has it by its path: Dev › rdb isn't a
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
  return `${what} ${problem}`;
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

// The servers in a setting, in the order written, and the folders they're
// in, empty ones too, for the Servers view to show. An object with a host
// or a port is a server, and any other is a folder, holding servers and
// folders, or nothing. VS Code doesn't hold a setting to its schema, so
// each is checked here too; one with a problem is skipped and the problem
// said, rather than connecting somewhere other than meant, such as without
// a user whose name was misspelt.
export function definitions(setting: unknown): {
  servers: Definition[];
  folders: string[][];
  problems: Problem[];
} {
  const servers: Definition[] = [];
  const folders: string[][] = [];
  const problems: Problem[] = [];
  if (setting === undefined || setting === null) {
    return { servers, folders, problems };
  }
  if (!isObject(setting)) {
    return {
      servers,
      folders,
      problems: [{ path: [], problem: "isn't an object" }],
    };
  }
  const read = (folder: Record<string, unknown>, at: string[]) => {
    for (const [key, value] of Object.entries(folder)) {
      const path = [...at, key];
      const problem = nameProblem(key) ?? check(value);
      if (problem) {
        problems.push({ path, problem });
        continue;
      }
      const object = value as Record<string, unknown>;
      if (!isServer(object)) {
        folders.push(path);
        read(object, path);
      } else {
        servers.push(definition(path, object));
      }
    }
  };
  read(setting, []);
  return { servers, folders, problems };
}

// The servers setting as written in each scope
export type Written = Record<Scope, unknown>;

// The servers the scopes define together, and their folders, with the
// problems in each scope said of it. A folder in both holds what each has;
// anything else in the workspace's replaces what's at its place in the
// user's whole, rather than VS Code's merge, which mixes their fields, so
// that a server is as one scope writes it, and a problem is said where it's
// written.
export function read(written: Written): {
  servers: Definition[];
  folders: string[][];
  problems: (Problem & { scope: Scope })[];
} {
  const { servers, folders } = definitions(
    merge(written.user, written.workspace, true),
  );
  const problems = (["user", "workspace"] as const).flatMap((scope) =>
    definitions(written[scope]).problems.map((problem) => ({
      ...problem,
      scope,
    })),
  );
  return { servers, folders, problems };
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

// Whether a server's written at a path in a setting
export function serverAt(setting: unknown, path: string[]): boolean {
  const value = at(setting, path);
  return isObject(value) && isServer(value);
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
    const folder = at(setting, [key]);
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

// A server's or a folder's name
function nameProblem(name: string): string | undefined {
  return name.trim() === "" ? "has no name" : undefined;
}

// A server as checked
function definition(
  path: string[],
  value: Record<string, unknown>,
): Definition {
  const { host, port, user, timeout, protect, tls, auth } = value as Omit<
    Definition,
    "path"
  >;
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
    return "isn't a server or a folder";
  }
  if (!isServer(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    return unknown.length === 1
      ? `has an unknown field, ${unknown[0]}`
      : `has unknown fields, ${unknown.join(", ")}`;
  }
  const { host, port, user, timeout, protect, tls, auth } = value as Record<
    string,
    unknown
  >;
  if (typeof host !== "string" || host.trim() === "") {
    return "has no host";
  }
  if (!isCount(port) || port > 65535) {
    return "has a port that isn't from 1 to 65535";
  }
  // q takes the login as user:password, ending at a 0 byte
  if (user !== undefined && (typeof user !== "string" || userProblem(user))) {
    return "has a user with a : or a 0 byte";
  }
  if (timeout !== undefined && !isTimeout(timeout)) {
    return isCount(timeout)
      ? `has a timeout over ${longestTimeout} ms`
      : "has a timeout that isn't a whole number of milliseconds";
  }
  if (protect !== undefined && typeof protect !== "boolean") {
    return "has a protect that isn't true or false";
  }
  if (tls !== undefined && typeof tls !== "boolean") {
    return "has a tls that isn't true or false";
  }
  if (
    auth !== undefined &&
    !["none", "store", "prompt", "extension"].includes(auth as string)
  ) {
    return 'has an auth that isn\'t "none", "store", "prompt" or "extension"';
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
    : { problem: "the auth extension isn't an extension ID" };
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
    "invalid sizeLimit setting: not a positive number of megabytes",
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
