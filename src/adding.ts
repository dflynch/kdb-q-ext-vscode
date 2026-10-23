import * as servers from "./servers";
import { filePath } from "./tls";

// What a question can be answered with: its answer, back to the question
// before, or undefined for a cancel
export const back = Symbol("back");
export type Reply<T> = T | typeof back | undefined;

// Where a question is in the flow, for its title
export type Placed = { step: number; total: number };

// A box to type in, which can offer to browse for a file
export type Input = {
  prompt: string;
  placeholder?: string;
  value?: string;
  password?: boolean;
  validate?: (text: string) => string | undefined;
  browse?: { label: string; filters: Record<string, string[]> };
};

// A list to pick one from, or to tick any of, answered with their ids. What
// was chosen before is chosen again.
export type Choice = { id: string; label: string; description?: string };
export type Choices = {
  placeholder: string;
  choices: Choice[];
  chosen?: string[];
};

// How the flow asks its questions: VS Code's quick input, or a script. A
// step asks without saying where it is, which the flow adds.
type Asks<Where> = {
  input(question: Input & Where): Promise<Reply<string>>;
  pick(question: Choices & Where): Promise<Reply<string>>;
  tick(question: Choices & Where): Promise<Reply<string[]>>;
};
export type Asker = Asks<Placed>;
type Ask = Asks<Record<never, never>>;

// What the flow needs to know: the names taken, the default connect timeout
// and whether there's a workspace to keep the server in
export type Context = { taken: string[]; timeout: number; workspace: boolean };

// A server to add: its name, its setting as written, what to keep in secure
// storage, which can be empty, and whether it goes in the workspace's
// settings
export type Adding = {
  name: string;
  value: Record<string, unknown>;
  password: string;
  passphrase: string;
  workspace: boolean;
};

// The answers so far, kept as given, so that going back shows them again
type State = {
  name?: string;
  host?: string;
  port?: string;
  user?: string;
  login?: string;
  password?: string;
  extension?: string;
  options?: string[];
  files?: string[];
  form?: string;
  ca?: string;
  cert?: string;
  key?: string;
  pfx?: string;
  passphrase?: string;
  timeout?: string;
  scope?: string;
};

// A question, giving the answers it adds to the state
type Step = (ask: Ask, state: State) => Promise<Reply<State>>;

// A reply's answer as the state takes it
function then<T>(reply: Reply<T>, take: (answer: T) => State): Reply<State> {
  if (reply === undefined) {
    return undefined;
  }
  return reply === back ? back : take(reply as T);
}

const pem = { PEM: ["pem", "crt", "cer", "key"] };

// A file's path, typed or browsed for
function file(
  key: "ca" | "cert" | "key" | "pfx",
  prompt: string,
  label: string,
  filters: Record<string, string[]>,
): Step {
  return async (ask, state) =>
    then(
      await ask.input({
        prompt,
        value: state[key],
        validate: (text) =>
          filePath.test(text.trim())
            ? undefined
            : "An absolute path, or one starting with ~/",
        browse: { label, filters },
      }),
      (path) => ({ [key]: path.trim() }),
    );
}

function name(taken: string[]): Step {
  return async (ask, state) =>
    then(
      await ask.input({
        prompt: "The server's name",
        value: state.name,
        validate: (text) =>
          text.trim() === ""
            ? "A server needs a name"
            : taken.includes(text.trim())
              ? `There's a server named ${text.trim()} already`
              : undefined,
      }),
      (name) => ({ name: name.trim() }),
    );
}

const host: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: "The server's host",
      placeholder: "localhost",
      value: state.host,
      validate: (text) =>
        text.trim() === ""
          ? "A host"
          : /:\d+$/.test(text.trim())
            ? "The port goes in the next step"
            : undefined,
    }),
    (host) => ({ host: host.trim() }),
  );

const port: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: `The port on ${state.host}`,
      placeholder: "5000",
      value: state.port,
      validate: (text) =>
        servers.port(text) ? undefined : "A port, from 1 to 65535",
    }),
    (port) => ({ port: port.trim() }),
  );

const user: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: "The user to log in as, or none",
      value: state.user,
      validate: (text) =>
        servers.userProblem(text.trim())
          ? "The user can't contain : or a 0 byte"
          : undefined,
    }),
    (user) => ({ user: user.trim() }),
  );

const login: Step = async (ask, state) =>
  then(
    await ask.pick({
      placeholder: "Where the password comes from",
      choices: [
        { id: "none", label: "No password" },
        {
          id: "store",
          label: "Store a password",
          description: "in VS Code's secure storage",
        },
        {
          id: "prompt",
          label: "Ask each time",
          description: "and never keep it",
        },
        {
          id: "extension",
          label: "Use an extension",
          description: "that gives the login, for a firm's own sign-on",
        },
      ],
      chosen: state.login === undefined ? undefined : [state.login],
    }),
    (login) => ({ login }),
  );

const password: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: `The password for ${state.name}`,
      value: state.password,
      password: true,
      validate: (text) =>
        text === "" ? "A password" : servers.passwordProblem(text),
    }),
    (password) => ({ password }),
  );

const extension: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: "The ID of the extension that gives the login",
      placeholder: "publisher.name",
      value: state.extension,
      validate: (text) =>
        servers.extensionId.test(text.trim())
          ? undefined
          : "An extension ID, publisher.name",
    }),
    (extension) => ({ extension: extension.trim() }),
  );

// The options as first shown: protected evaluation on, as a server has it
// by default, and the timeout, to be shown with its default
const optionsAtFirst = ["protect", "timeout"];

// Whether an option or a file TLS needs is ticked, the options counting as
// first shown until answered
function ticked(state: State, key: "options" | "files", id: string): boolean {
  return (state[key] ?? (key === "options" ? optionsAtFirst : [])).includes(id);
}

const options: Step = async (ask, state) =>
  then(
    await ask.tick({
      placeholder: "Options",
      choices: [
        { id: "tls", label: "Connect with TLS" },
        {
          id: "protect",
          label: "Protected evaluation",
          description: "off for a gateway whose .z.pg is its own",
        },
        { id: "timeout", label: "Set a connect timeout" },
      ],
      chosen: state.options ?? optionsAtFirst,
    }),
    (options) => ({ options }),
  );

const files: Step = async (ask, state) =>
  then(
    await ask.tick({
      placeholder: "The files TLS needs, if any (Enter for none)",
      choices: [
        {
          id: "ca",
          label: "A CA",
          description: "to trust besides the system's, such as a firm's own",
        },
        {
          id: "client",
          label: "A client certificate",
          description: "for a server that requires one",
        },
      ],
      chosen: state.files,
    }),
    (files) => ({ files }),
  );

const form: Step = async (ask, state) =>
  then(
    await ask.pick({
      placeholder: "The client certificate's form",
      choices: [
        {
          id: "pem",
          label: "A certificate and its key",
          description: "in PEM",
        },
        { id: "pfx", label: "One PKCS#12 file", description: ".p12 or .pfx" },
      ],
      chosen: state.form === undefined ? undefined : [state.form],
    }),
    (form) => ({ form }),
  );

const passphrase: Step = async (ask, state) =>
  then(
    await ask.input({
      prompt: "The client certificate's passphrase, or none",
      value: state.passphrase,
      password: true,
    }),
    (passphrase) => ({ passphrase }),
  );

function timeout(otherwise: number): Step {
  return async (ask, state) =>
    then(
      await ask.input({
        prompt: "How long to wait to connect and log in, in milliseconds",
        value: state.timeout ?? `${otherwise}`,
        validate: (text) =>
          /^\d+$/.test(text.trim()) && Number(text) > 0
            ? undefined
            : "A whole number of milliseconds",
      }),
      (timeout) => ({ timeout: timeout.trim() }),
    );
}

const scope: Step = async (ask, state) =>
  then(
    await ask.pick({
      placeholder: "Where to keep the server",
      choices: [
        {
          id: "user",
          label: "User settings",
          description: "for every workspace",
        },
        {
          id: "workspace",
          label: "Workspace settings",
          description: "for this workspace, and anyone who opens it",
        },
      ],
      chosen: state.scope === undefined ? undefined : [state.scope],
    }),
    (scope) => ({ scope }),
  );

// The questions the answers so far lead to, in order. One not answered yet
// counts as its first choice, so that the total is a fair guess.
function plan(state: State, context: Context): Step[] {
  const tls = ticked(state, "options", "tls");
  const client = tls && ticked(state, "files", "client");
  return [
    name(context.taken),
    host,
    port,
    user,
    login,
    ...(state.login === "store" ? [password] : []),
    ...(state.login === "extension" ? [extension] : []),
    options,
    ...(tls ? [files] : []),
    ...(tls && ticked(state, "files", "ca")
      ? [file("ca", "The CA's certificate, in PEM", "Trust this CA", pem)]
      : []),
    ...(client ? [form] : []),
    ...(client && state.form === "pfx"
      ? [
          file("pfx", "The PKCS#12 file", "Use this certificate", {
            "PKCS#12": ["p12", "pfx"],
          }),
        ]
      : []),
    ...(client && state.form !== "pfx"
      ? [
          file("cert", "The certificate, in PEM", "Use this certificate", pem),
          file("key", "The certificate's key, in PEM", "Use this key", pem),
        ]
      : []),
    ...(client ? [passphrase] : []),
    ...(ticked(state, "options", "timeout") ? [timeout(context.timeout)] : []),
    ...(context.workspace ? [scope] : []),
  ];
}

// Ask each question the answers lead to, going back a question when asked,
// with the answers given before kept. Undefined for a cancel.
export async function add(
  ask: Asker,
  context: Context,
): Promise<Adding | undefined> {
  let state: State = {};
  let at = 0;
  for (;;) {
    const steps = plan(state, context);
    if (at === steps.length) {
      return adding(state, context);
    }
    const placed = { step: at + 1, total: steps.length };
    const asking: Ask = {
      input: (question) => ask.input({ ...question, ...placed }),
      pick: (question) => ask.pick({ ...question, ...placed }),
      tick: (question) => ask.tick({ ...question, ...placed }),
    };
    const reply = await steps[at](asking, state);
    if (reply === undefined) {
      return undefined;
    }
    if (reply === back) {
      at = Math.max(at - 1, 0);
    } else {
      state = { ...state, ...reply };
      at += 1;
    }
  }
}

// The server the answers make, using only the answers their choices lead
// to: one given before going back and choosing otherwise is dropped. A
// timeout left at the default isn't written, so that the server follows the
// default.
function adding(state: State, context: Context): Adding {
  const tls = ticked(state, "options", "tls");
  const ca = tls && ticked(state, "files", "ca");
  const client = tls && ticked(state, "files", "client");
  const auth =
    state.login === "prompt"
      ? "prompt"
      : state.login === "extension"
        ? { extension: state.extension }
        : undefined;
  const timeout = Number(state.timeout);
  return {
    name: state.name ?? "",
    value: {
      host: state.host,
      port: servers.port(state.port ?? ""),
      ...(state.user ? { user: state.user } : {}),
      ...(auth === undefined ? {} : { auth }),
      ...(tls
        ? {
            tls:
              !ca && !client
                ? true
                : {
                    ...(ca ? { ca: state.ca } : {}),
                    ...(client && state.form === "pfx"
                      ? { pfx: state.pfx }
                      : {}),
                    ...(client && state.form !== "pfx"
                      ? { cert: state.cert, key: state.key }
                      : {}),
                  },
          }
        : {}),
      ...(ticked(state, "options", "protect") ? {} : { protect: false }),
      ...(ticked(state, "options", "timeout") && timeout !== context.timeout
        ? { timeout }
        : {}),
    },
    password: state.login === "store" ? (state.password ?? "") : "",
    passphrase: client ? (state.passphrase ?? "") : "",
    workspace: state.scope === "workspace",
  };
}
