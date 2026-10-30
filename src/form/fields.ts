import { passwordProblem, userProblem } from "../login";

// The server form's fields, as the form has them, and what they're checked
// against: shared by the extension and the form's webview, so no Node here

// Where a server's password comes from: none, VS Code's secure storage, a
// prompt at each connect, or the auth extension
export type Auth = "none" | "store" | "prompt" | "extension";

// Every field as typed
export type Form = {
  name: string;
  host: string;
  port: string;
  user: string;
  auth: Auth;
  // A password to store, or empty to keep the one stored, if there's one
  password: string;
  tls: boolean;
  protect: boolean;
  // In milliseconds, or empty to wait as long as it takes
  timeout: string;
  // The settings a server added is saved to; one edited stays where it is
  target: "user" | "workspace";
};

export type Field = keyof Form;

// What the form is for: a server to add to a folder, or one to edit, by its
// name as it was, and what it needs to know of the rest
export type Context = {
  // The folders the server is in, outermost first
  folder: string[];
  // The server's own name, when editing
  editing?: string;
  // The names of the rest of the folder's servers and folders
  taken: string[];
  // Whether there's a workspace to save a server to
  workspaceOpen: boolean;
  // The authExtension setting, as written
  authExtension?: string;
  // The TLS files set, by their file names, as the settings give them
  tlsFiles: string[];
  // Whether the server's connected, so that changes wait for the next
  // connect
  connected: boolean;
};

// The timeout a server added starts with, in milliseconds
export const connectTimeout = 2000;

// The form for a server to add: protected evaluation on, as a server has
// it by default
export function blank(): Form {
  return {
    name: "",
    host: "",
    port: "",
    user: "",
    auth: "none",
    password: "",
    tls: false,
    protect: true,
    timeout: String(connectTimeout),
    target: "user",
  };
}

// A server's setting as the form has it, its password stored or not
export function fromSetting(
  name: string,
  value: {
    host: string;
    port: number;
    user?: string;
    auth?: "prompt" | "extension";
    tls?: boolean;
    protect?: boolean;
    timeout?: number;
  },
  stored: boolean,
): Form {
  return {
    ...blank(),
    name,
    host: value.host,
    port: String(value.port),
    user: value.user ?? "",
    auth: value.auth ?? (stored ? "store" : "none"),
    tls: value.tls ?? false,
    protect: value.protect ?? true,
    timeout: value.timeout === undefined ? "" : String(value.timeout),
  };
}

// A port as typed
export function port(text: string): number | undefined {
  const port = /^\d+$/.test(text.trim()) ? Number(text) : 0;
  return port >= 1 && port <= 65535 ? port : undefined;
}

// A timeout as typed: a whole number of milliseconds, or empty for none
function timeout(text: string): number | undefined {
  return /^\d+$/.test(text.trim()) ? Number(text) : undefined;
}

// The problem with each field that has one, under it in the form. A
// password's needed to store one, unless one is stored for the user, host
// and port as typed.
export function problems(
  form: Form,
  context: Context,
  stored: boolean,
): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  const name = form.name.trim();
  if (name === "") {
    found.name = "Required";
  } else if (name.includes("/")) {
    found.name = "Can't contain /";
  } else if (context.taken.includes(name)) {
    found.name = `${name} already exists`;
  }
  const host = form.host.trim();
  if (host === "") {
    found.host = "Required";
  } else if (/^[^:]+:\d+$/.test(host)) {
    // A host with :port after it is one typed with its port; an IPv6
    // address has colons too, but more than one
    found.host = "Port comes next";
  }
  if (port(form.port) === undefined) {
    found.port = "From 1 to 65535";
  }
  if (userProblem(form.user.trim())) {
    found.user = "Can't contain : or a 0 byte";
  }
  if (form.auth === "store") {
    if (form.password === "" && !stored) {
      found.password = "Required";
    } else if (passwordProblem(form.password)) {
      found.password = "Can't contain a 0 byte";
    }
  }
  if (form.timeout.trim() !== "" && timeout(form.timeout) === undefined) {
    found.timeout = "A whole number of milliseconds";
  }
  return found;
}

// The server's setting the form makes, its fields in the order the README
// gives them. Only what differs from the defaults is written.
export function toSetting(form: Form): Record<string, unknown> {
  const user = form.user.trim();
  const ms = timeout(form.timeout);
  return {
    host: form.host.trim(),
    port: port(form.port),
    ...(user === "" ? {} : { user }),
    ...(form.auth === "prompt" || form.auth === "extension"
      ? { auth: form.auth }
      : {}),
    ...(form.tls ? { tls: true } : {}),
    ...(form.protect ? {} : { protect: false }),
    ...(ms === undefined ? {} : { timeout: ms }),
  };
}

// The user, host and port as typed, which a stored password is kept for
export type Login = { user: string; host: string; port: string };

// To the form: the form to show, what it needs to know, and whether a
// password is stored for its login, again whenever the settings change; that
// a server edited is no longer in the settings; whether a password is
// stored for a login typed; or how a test of the server went
export type ToForm =
  | { type: "load"; form: Form; context: Context; stored: boolean }
  | { type: "gone" }
  | { type: "stored"; login: Login; stored: boolean }
  | { type: "tested"; ok: boolean; text: string };

// From the form: it's ready for its form; a login typed, to say whether a
// password is stored for it; the form to save, or to test by connecting;
// cancel; or a setting to open
export type FromForm =
  | { type: "ready" }
  | { type: "lookup"; login: Login }
  | { type: "save"; form: Form }
  | { type: "test"; form: Form }
  | { type: "cancel" }
  | { type: "open"; setting: "servers" | "authExtension" | "tls" };
