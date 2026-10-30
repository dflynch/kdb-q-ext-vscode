import {
  authExtension,
  type Credentials,
  credentialsProblem,
  type Definition,
  secretKey,
} from "./servers";

// What an auth extension is asked, at every connect, so that a token can
// always be fresh. It exports a function credentials(request) that returns,
// or resolves to, the credentials to log in with: { user?, password }. A user
// it gives replaces the server's.
export type CredentialsRequest = {
  // The server's path, its folders' names and its own joined by /, such as
  // Prod/trades/TP
  name: string;
  host: string;
  port: number;
  user?: string;
};

// Where credentials come from, so that tests can stand in for VS Code
export type Sources = {
  // A password from secure storage
  stored: (key: string) => PromiseLike<string | undefined>;
  // A password typed in, or undefined if the user cancels
  ask: (server: Definition) => PromiseLike<string | undefined>;
  // The authExtension setting, as it's written
  authExtension: () => unknown;
  // An installed extension's exports, activating it if it isn't yet, or
  // undefined if it isn't installed
  extension: (id: string) => PromiseLike<unknown>;
};

// The credentials to connect to a server with, or undefined if the user
// cancels. What an extension gives is never logged or put in an error.
export async function credentials(
  server: Definition,
  sources: Sources,
): Promise<Credentials | undefined> {
  const auth = server.auth;
  if (auth === undefined) {
    return {};
  }
  if (auth === "store") {
    const password = await sources.stored(secretKey(server));
    if (password === undefined) {
      throw new Error("password not stored");
    }
    return { password };
  }
  if (auth === "prompt") {
    const password = await sources.ask(server);
    return password === undefined ? undefined : { password };
  }
  const { id, problem: invalid } = authExtension(sources.authExtension());
  if (invalid) {
    throw new Error("invalid auth extension", { cause: invalid });
  }
  if (id === undefined) {
    throw new Error("auth extension not set");
  }
  const exports = await sources.extension(id);
  if (exports === undefined) {
    throw new Error("auth extension not installed", { cause: id });
  }
  const provide = (exports as { credentials?: unknown } | null)?.credentials;
  if (typeof provide !== "function") {
    throw new Error("auth extension gives no credentials", {
      cause: `${id} exports no credentials function`,
    });
  }
  const request: CredentialsRequest = {
    name: server.name,
    host: server.host,
    port: server.port,
    ...(server.user === undefined ? {} : { user: server.user }),
  };
  let given: unknown;
  try {
    given = await provide(request);
  } catch (cause) {
    throw new Error("auth extension failed", { cause });
  }
  const problem = credentialsProblem(given);
  if (problem) {
    throw new Error("malformed credentials from auth extension", {
      cause: `${id}: ${problem}`,
    });
  }
  const { user, password } = given as Credentials;
  return { ...(user === undefined ? {} : { user }), password };
}
