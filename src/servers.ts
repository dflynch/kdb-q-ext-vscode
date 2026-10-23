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
};

// The settings a connection uses, besides the server's own
export type Defaults = {
  // In milliseconds
  timeout: number;
  // In bytes
  limit: number;
};

export const defaults: Defaults = { timeout: 2000, limit: 10e6 };

const fields = new Set(["host", "port", "user", "timeout"]);

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
    const { host, port, user, timeout } = value as Omit<Definition, "name">;
    servers.push({
      name,
      host,
      port,
      ...(user === undefined ? {} : { user }),
      ...(timeout === undefined ? {} : { timeout }),
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
  const { host, port, user, timeout } = value as Record<string, unknown>;
  if (typeof host !== "string" || host.trim() === "") {
    return "no host";
  }
  if (!isCount(port) || port > 65535) {
    return "the port isn't a port number";
  }
  // q takes the login as user:password, ending at a 0 byte
  if (user !== undefined && (typeof user !== "string" || /[:\0]/.test(user))) {
    return "the user can't contain : or a 0 byte";
  }
  if (timeout !== undefined && !isCount(timeout)) {
    return "the timeout isn't a whole number of milliseconds";
  }
  return undefined;
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

// A password q can take: the login ends at a 0 byte
export function passwordProblem(password: string): string | undefined {
  return password.includes("\0")
    ? "a password can't contain a 0 byte"
    : undefined;
}

// What a connection needs
export function server(
  definition: Definition,
  password: string | undefined,
  { timeout, limit }: Defaults,
): Server {
  return {
    host: definition.host,
    port: definition.port,
    ...(definition.user === undefined ? {} : { user: definition.user }),
    ...(password === undefined ? {} : { password }),
    timeout: definition.timeout ?? timeout,
    limit,
  };
}
