import type { Server } from "./connection";
import { connectTimeout } from "./form/fields";
import { passwordProblem, userProblem } from "./login";
import type { Secure } from "./tls";

// A server as the settings define it: everything but the password, which is
// kept in VS Code's secure storage, never in a settings file
export type Definition = {
  // Its own name after the folders it's in, joined by /, which no name in
  // the setting can contain
  name: string;
  host: string;
  port: number;
  user?: string;
  // How long to wait to connect and log in, in milliseconds, or 0 to wait
  // as long as it takes; connectTimeout unless given
  timeout?: number;
  // Whether to evaluate queries protected, so that an error comes back with
  // its backtrace: on unless false, as a server that enforces an allowlist
  // won't evaluate it
  protect?: boolean;
  // Whether to connect with TLS, with the files in the TLS settings
  tls?: boolean;
  // Where the password comes from: secure storage when there's no auth
  auth?: Auth;
};

// A password asked for at every connect and never kept, where a firm doesn't
// allow one to be stored or it changes too often to keep; or one the auth
// extension gives, for a firm's own sign-on: a Kerberos ticket or an access
// token, say, which the server checks in .z.pw. The authExtension setting
// names the extension, once for every server, so no other extension is given
// a server's login by taking a name agreed in advance.
export type Auth = "prompt" | "extension";

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

// A Marketplace extension ID, publisher.name
export const extensionId = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// A timeout, in milliseconds: 0 waits as long as it takes, as hopen does
function isTimeout(value: unknown): value is number {
  return value === 0 || isCount(value);
}

// The servers in the setting, in the order written, and the folders they're
// in, empty ones too, for the Servers view to show. A server has fields and
// a folder has none of its own, holding only servers and folders, or
// nothing, so an object with any plain value is a server, and any other is
// a folder. VS Code doesn't hold a setting to its schema, so each is checked
// here too; one with a problem is left out and the problem said, rather than
// connecting somewhere other than meant, such as without a user whose name
// was misspelt.
export function definitions(setting: unknown): {
  servers: Definition[];
  folders: string[];
  problems: string[];
} {
  const servers: Definition[] = [];
  const folders: string[] = [];
  const problems: string[] = [];
  if (setting === undefined || setting === null) {
    return { servers, folders, problems };
  }
  if (!isObject(setting)) {
    return {
      servers,
      folders,
      problems: ["the servers setting isn't an object"],
    };
  }
  const read = (folder: Record<string, unknown>, at: string) => {
    for (const [key, value] of Object.entries(folder)) {
      const name = at + key;
      const problem = nameProblem(key) ?? check(value);
      if (problem) {
        problems.push(`${at}${key || '""'}: ${problem}`);
        continue;
      }
      const object = value as Record<string, unknown>;
      if (isFolder(object)) {
        folders.push(name);
        read(object, `${name}/`);
      } else {
        servers.push(definition(name, object));
      }
    }
  };
  read(setting, "");
  return { servers, folders, problems };
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

// An object holding only objects, or nothing
function isFolder(value: Record<string, unknown>): boolean {
  return Object.values(value).every(isObject);
}

// A server's or a folder's name: / joins the names in a path
function nameProblem(name: string): string | undefined {
  return name.trim() === ""
    ? "a name can't be empty"
    : name.includes("/")
      ? "a name can't contain /"
      : undefined;
}

// A server as checked
function definition(name: string, value: Record<string, unknown>): Definition {
  const { host, port, user, timeout, protect, tls, auth } = value as Omit<
    Definition,
    "name"
  >;
  return {
    name,
    host,
    port,
    ...(user === undefined ? {} : { user }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(protect === undefined ? {} : { protect }),
    ...(tls ? { tls } : {}),
    ...(auth === undefined ? {} : { auth }),
  };
}

// A problem with a server, or with something in a folder that's neither a
// server nor a folder
function check(value: unknown): string | undefined {
  if (!isObject(value)) {
    return "not a server or a folder";
  }
  if (isFolder(value)) {
    return undefined;
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    return `unknown ${unknown.length === 1 ? "field" : "fields"} ${unknown.join(", ")}`;
  }
  const { host, port, user, timeout, protect, tls, auth } = value as Record<
    string,
    unknown
  >;
  if (typeof host !== "string" || host.trim() === "") {
    return "no host";
  }
  if (!isCount(port) || port > 65535) {
    return "the port isn't a port number";
  }
  // q takes the login as user:password, ending at a 0 byte
  if (user !== undefined && (typeof user !== "string" || userProblem(user))) {
    return "the user can't contain : or a 0 byte";
  }
  if (timeout !== undefined && !isTimeout(timeout)) {
    return "the timeout isn't a whole number of milliseconds";
  }
  if (protect !== undefined && typeof protect !== "boolean") {
    return "protect is true or false";
  }
  if (tls !== undefined && typeof tls !== "boolean") {
    return "tls is true or false";
  }
  if (auth !== undefined && auth !== "prompt" && auth !== "extension") {
    return 'auth is "prompt" or "extension"';
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

// The size limit, with the problem said if it's wrong and its default used
export function settings(megabytes: unknown): {
  defaults: Defaults;
  problems: string[];
} {
  const problems: string[] = [];
  let result = { ...defaults };
  if (megabytes !== undefined) {
    if (typeof megabytes === "number" && megabytes > 0) {
      result = { ...result, limit: Math.round(megabytes * 1e6) };
    } else {
      problems.push("the size limit isn't a positive number of megabytes");
    }
  }
  return { defaults: result, problems };
}

// Where a server's password is kept. Keyed by where it's sent, not by the
// server's name, so that a password is never sent to a host other than the
// one it was given for, if a server's host is changed
export function secretKey(server: Definition): string {
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
    timeout: definition.timeout ?? connectTimeout,
    limit,
    protect: definition.protect ?? true,
    ...(tls === undefined ? {} : { tls }),
  };
}
