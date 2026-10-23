import type { Server } from "./connection";

// A server as the settings define it: everything but the password, which is
// kept in VS Code's secure storage, never in a settings file
export type Definition = {
  name: string;
  host: string;
  port: number;
  user?: string;
  // Overrides the connect timeout for this server, in milliseconds
  timeout?: number;
  // Whether to evaluate queries protected, so that an error comes back with
  // its backtrace: on unless false, as a gateway whose .z.pg is customised
  // may not evaluate it
  protect?: boolean;
  // Where the password comes from: secure storage when there's no auth
  auth?: Auth;
};

// A password asked for at every connect and never kept, for a one-time code;
// or one an extension gives, for a firm's own sign-on: a Kerberos ticket or
// an access token, say, which the server checks in .z.pw. The setting names
// the extension, so no other extension is given the server's login by
// taking a name agreed in advance. The rest of the setting goes to it as it
// is.
export type Auth =
  | "prompt"
  | { extension: string; fields: Record<string, unknown> };

// What a login is made of
export type Credentials = { user?: string; password?: string };

// The settings a connection uses, besides the server's own
export type Defaults = {
  // In milliseconds
  timeout: number;
  // In bytes
  limit: number;
};

export const defaults: Defaults = { timeout: 2000, limit: 10e6 };

const fields = new Set(["host", "port", "user", "timeout", "protect", "auth"]);

// A Marketplace extension ID, publisher.name
const extensionId = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// The servers in the setting, in the order written. VS Code doesn't hold a
// setting to its schema, so each is checked here too; one with a problem is
// left out and the problem said, rather than connecting somewhere other than
// meant, such as without a user whose name was misspelt.
export function definitions(setting: unknown): {
  servers: Definition[];
  problems: string[];
} {
  const servers: Definition[] = [];
  const problems: string[] = [];
  if (setting === undefined || setting === null) {
    return { servers, problems };
  }
  if (typeof setting !== "object" || Array.isArray(setting)) {
    return { servers, problems: ["the servers setting isn't an object"] };
  }
  for (const [name, value] of Object.entries(setting)) {
    const problem = check(name, value);
    if (problem) {
      problems.push(`${name || '""'}: ${problem}`);
      continue;
    }
    const { host, port, user, timeout, protect, auth } = value as Omit<
      Definition,
      "name" | "auth"
    > & { auth?: "prompt" | Record<string, unknown> };
    servers.push({
      name,
      host,
      port,
      ...(user === undefined ? {} : { user }),
      ...(timeout === undefined ? {} : { timeout }),
      ...(protect === undefined ? {} : { protect }),
      ...(auth === undefined ? {} : { auth: readAuth(auth) }),
    });
  }
  return { servers, problems };
}

function check(name: string, value: unknown): string | undefined {
  if (name.trim() === "") {
    return "a server needs a name";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "not an object";
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    return `unknown ${unknown.length === 1 ? "field" : "fields"} ${unknown.join(", ")}`;
  }
  const { host, port, user, timeout, protect, auth } = value as Record<
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
  if (timeout !== undefined && !isCount(timeout)) {
    return "the timeout isn't a whole number of milliseconds";
  }
  if (protect !== undefined && typeof protect !== "boolean") {
    return "protect is true or false";
  }
  return auth === undefined ? undefined : authProblem(auth);
}

function authProblem(auth: unknown): string | undefined {
  if (auth === "prompt") {
    return undefined;
  }
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    return 'auth is "prompt" or names an extension';
  }
  const { extension } = auth as Record<string, unknown>;
  if (typeof extension !== "string" || !extensionId.test(extension)) {
    return "auth's extension isn't an extension ID";
  }
  return undefined;
}

function readAuth(auth: "prompt" | Record<string, unknown>): Auth {
  if (auth === "prompt") {
    return auth;
  }
  const { extension, ...fields } = auth;
  return { extension: extension as string, fields };
}

// The connect timeout and the size limit, with the problem said for one
// that's wrong and its default used
export function settings(
  timeout: unknown,
  megabytes: unknown,
): { defaults: Defaults; problems: string[] } {
  const problems: string[] = [];
  let result = { ...defaults };
  if (timeout !== undefined) {
    if (isCount(timeout)) {
      result = { ...result, timeout };
    } else {
      problems.push("the connect timeout isn't a whole number of milliseconds");
    }
  }
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

// A user q can take: the login is user:password, ending at a 0 byte
function userProblem(user: string): boolean {
  return /[:\0]/.test(user);
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

// A password q can take: the login ends at a 0 byte
export function passwordProblem(password: string): string | undefined {
  return password.includes("\0")
    ? "a password can't contain a 0 byte"
    : undefined;
}

// What a connection needs. A user in the credentials, as an extension can
// give, replaces the server's.
export function server(
  definition: Definition,
  { user = definition.user, password }: Credentials,
  { timeout, limit }: Defaults,
): Server {
  return {
    host: definition.host,
    port: definition.port,
    ...(user === undefined ? {} : { user }),
    ...(password === undefined ? {} : { password }),
    timeout: definition.timeout ?? timeout,
    limit,
    protect: definition.protect ?? true,
  };
}
