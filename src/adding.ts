import * as servers from "./servers";

// What a question can be answered with: its answer, back to the question
// before, or undefined for a cancel
export const back = Symbol("back");
export type Reply<T> = T | typeof back | undefined;

// Where a question is in the flow, for its title
export type Placed = { step: number; total: number };

// A box to type in
export type Input = {
  prompt: string;
  placeholder?: string;
  value?: string;
  password?: boolean;
  validate?: (text: string) => string | undefined;
};

// A list to pick one from, or to tick any of, answered with their ids. What
// was chosen before is chosen again.
export type Choice = { id: string; label: string; description?: string };
export type Choices = {
  placeholder: string;
  choices: Choice[];
  chosen?: string[];
};

// How the flow asks its questions: VS Code's quick input, or a script
export type Asker = {
  input(question: Input & Placed): Promise<Reply<string>>;
  pick(question: Choices & Placed): Promise<Reply<string>>;
  tick(question: Choices & Placed): Promise<Reply<string[]>>;
};

// What the flow needs to know: the names taken, the default connect timeout
// and whether a workspace is open to save the server to
export type Context = {
  taken: string[];
  timeout: number;
  workspaceOpen: boolean;
};

// A server to add: its name, its setting as written, any password to keep
// in secure storage, and the settings it's saved to
export type Adding = {
  name: string;
  value: Record<string, unknown>;
  password?: string;
  target: "user" | "workspace";
};

// The answers so far, kept as given, so that going back shows them again
type State = {
  name?: string;
  host?: string;
  port?: string;
  user?: string;
  login?: string;
  password?: string;
  options?: string[];
  target?: string;
};

// A question, and what its answer adds to the state
type Question =
  | (Input & { kind: "input"; take: (answer: string) => State })
  | (Choices & { kind: "pick"; take: (answer: string) => State })
  | (Choices & { kind: "tick"; take: (answer: string[]) => State });

// A step asks its question with the answers so far, to show them again
type Step = (state: State) => Question;

// The options as first shown: on, as a server has them by default
const optionsAtFirst = ["protect", "timeout"];

// The options chosen, or as first shown if not answered yet
function chosen(state: State): string[] {
  return state.options ?? optionsAtFirst;
}

// A port as typed
export function port(text: string): number | undefined {
  const port = /^\d+$/.test(text.trim()) ? Number(text) : 0;
  return port >= 1 && port <= 65535 ? port : undefined;
}

function name(taken: string[]): Step {
  return (state) => ({
    kind: "input",
    prompt: "Name",
    value: state.name,
    validate: (text) =>
      text.trim() === ""
        ? "Required"
        : text.includes("/")
          ? "Can't contain /"
          : taken.includes(text.trim())
            ? `${text.trim()} already exists`
            : undefined,
    take: (name) => ({ name: name.trim() }),
  });
}

// A host with :port after it is one typed with its port; an IPv6 address
// has colons too, but more than one
const host: Step = (state) => ({
  kind: "input",
  prompt: "Host",
  placeholder: "localhost",
  value: state.host,
  validate: (text) =>
    text.trim() === ""
      ? "Required"
      : /^[^:]+:\d+$/.test(text.trim())
        ? "Port comes next"
        : undefined,
  take: (host) => ({ host: host.trim() }),
});

const portOn: Step = (state) => ({
  kind: "input",
  prompt: `Port on ${state.host}`,
  placeholder: "5000",
  value: state.port,
  validate: (text) => (port(text) ? undefined : "From 1 to 65535"),
  take: (port) => ({ port: port.trim() }),
});

const user: Step = (state) => ({
  kind: "input",
  prompt: "User (optional)",
  value: state.user,
  validate: (text) =>
    servers.userProblem(text.trim())
      ? "Can't contain : or a 0 byte"
      : undefined,
  take: (user) => ({ user: user.trim() }),
});

const login: Step = (state) => ({
  kind: "pick",
  placeholder: "Authentication",
  choices: [
    { id: "none", label: "No password" },
    {
      id: "store",
      label: "Store password",
      description: "in VS Code's secure storage",
    },
    { id: "prompt", label: "Ask each time", description: "never stored" },
    {
      id: "extension",
      label: "Use extension",
      description: "for a firm's own sign-on",
    },
  ],
  chosen: state.login === undefined ? undefined : [state.login],
  take: (login) => ({ login }),
});

const password: Step = (state) => ({
  kind: "input",
  prompt: "Password",
  value: state.password,
  password: true,
  validate: (text) =>
    text === "" ? "Required" : servers.passwordProblem(text),
  take: (password) => ({ password }),
});

function options(timeout: number): Step {
  return (state) => ({
    kind: "tick",
    placeholder: "Options",
    choices: [
      {
        id: "tls",
        label: "TLS",
        description: "with the files in the TLS settings",
      },
      {
        id: "protect",
        label: "Protected evaluation",
        description: "untick when the server enforces an allowlist",
      },
      {
        id: "timeout",
        label: "Connection timeout",
        description: `${timeout === 0 ? "none" : `${timeout} ms`}, edit in settings.json`,
      },
    ],
    chosen: state.options ?? optionsAtFirst,
    take: (options) => ({ options }),
  });
}

const target: Step = (state) => ({
  kind: "pick",
  placeholder: "Save to",
  choices: [
    { id: "user", label: "User settings", description: "all workspaces" },
    {
      id: "workspace",
      label: "Workspace settings",
      description: "this workspace, and anyone who opens it",
    },
  ],
  chosen: state.target === undefined ? undefined : [state.target],
  take: (target) => ({ target }),
});

// The questions the answers so far lead to, in order. A question not
// answered yet counts as first shown, so that the total is a fair guess.
function plan(state: State, context: Context): Step[] {
  return [
    name(context.taken),
    host,
    portOn,
    user,
    login,
    ...(state.login === "store" ? [password] : []),
    options(context.timeout),
    ...(context.workspaceOpen ? [target] : []),
  ];
}

// A question asked where it is in the flow, with its answer as the state
// takes it
async function asked(
  ask: Asker,
  question: Question,
  placed: Placed,
): Promise<Reply<State>> {
  const answered = <T>(
    reply: Reply<T>,
    take: (answer: T) => State,
  ): Reply<State> =>
    reply === undefined ? undefined : reply === back ? back : take(reply as T);
  switch (question.kind) {
    case "input":
      return answered(
        await ask.input({ ...question, ...placed }),
        question.take,
      );
    case "pick":
      return answered(
        await ask.pick({ ...question, ...placed }),
        question.take,
      );
    case "tick":
      return answered(
        await ask.tick({ ...question, ...placed }),
        question.take,
      );
  }
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
    const reply = await asked(ask, steps[at](state), {
      step: at + 1,
      total: steps.length,
    });
    if (reply === undefined) {
      return undefined;
    }
    if (reply === back && at === 0) {
      throw new Error("there's no question before the first");
    }
    if (reply === back) {
      at -= 1;
    } else {
      state = { ...state, ...reply };
      at += 1;
    }
  }
}

// The server the answers make. Every answer the plan leads to is given. The
// timeout is written, as the default if on, so that it's there to edit.
function adding(state: State, context: Context): Adding {
  const options = chosen(state);
  const auth =
    state.login === "prompt"
      ? "prompt"
      : state.login === "extension"
        ? "extension"
        : undefined;
  return {
    name: state.name as string,
    value: {
      host: state.host,
      port: port(state.port as string),
      ...(state.user ? { user: state.user } : {}),
      ...(auth === undefined ? {} : { auth }),
      ...(options.includes("tls") ? { tls: true } : {}),
      ...(options.includes("protect") ? {} : { protect: false }),
      timeout: options.includes("timeout") ? context.timeout : 0,
    },
    ...(state.login === "store" ? { password: state.password } : {}),
    target: state.target === "workspace" ? "workspace" : "user",
  };
}
