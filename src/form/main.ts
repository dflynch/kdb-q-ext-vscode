// The server form's script, bundled into dist/form.js. It runs in the
// webview, with the DOM but no Node and no VS Code API, and talks to the
// extension only by messages. Laid out as the Settings editor lays out a
// setting: its name in bold, what it does, then its box.
import {
  type Context,
  type Field,
  type Form,
  type FromForm,
  type Login,
  problems,
  type ToForm,
} from "./fields";

declare function acquireVsCodeApi(): {
  postMessage(message: FromForm): void;
};

const vscode = acquireVsCodeApi();

// The form as loaded, what it was loaded with, and whether a password is
// stored for the login as typed
let loaded: Form | undefined;
let context: Context | undefined;
let stored = false;
// The fields left once, whose problems are shown; all of them once Save is
// tried
const left = new Set<Field>();
// A load that came while the form had changes, applied on Reload
let pending: Extract<ToForm, { type: "load" }> | undefined;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className) {
    made.className = className;
  }
  if (text !== undefined) {
    made.textContent = text;
  }
  return made;
}

// A link that opens a setting, as the Settings editor's do
function link(text: string, setting: "servers" | "authExtension" | "tls") {
  const a = element("a", undefined, text);
  a.href = "#";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    vscode.postMessage({ type: "open", setting });
  });
  return a;
}

const title = element("h1");
const where = element("p", "where");
const note = element("p", "note", "Changes apply at the next connect.");
const banner = element("div", "banner");
banner.role = "status";

// A setting: its name, what it does, its box or boxes, and its problem
function setting(
  label: string,
  description: (string | Node)[],
  ...controls: HTMLElement[]
) {
  const row = element("div", "setting");
  const name = element("div", "label", label);
  const about = element("div", "description");
  about.append(...description);
  const problem = element("div", "problem");
  problem.role = "alert";
  row.append(name, about, ...controls, problem);
  return { row, about, problem };
}

function text(id: Field, type = "text") {
  const input = element("input");
  input.id = id;
  input.type = type;
  input.spellcheck = false;
  input.autocomplete = "off";
  return input;
}

// A tick box with what it does beside it, as the Settings editor has one
function tick(id: Field, ...label: (string | Node)[]) {
  const box = element("input");
  box.id = id;
  box.type = "checkbox";
  const said = element("span", "description");
  said.append(...label);
  const wrap = element("label", "tick");
  wrap.append(box, said);
  return { box, wrap };
}

// Radio buttons, each with what it means
function radios(group: string, choices: [string, string, string | Node][]) {
  const wrap = element("div", "radios");
  wrap.role = "radiogroup";
  const buttons = new Map<string, HTMLInputElement>();
  const notes = new Map<string, HTMLElement>();
  for (const [value, label, about] of choices) {
    const radio = element("input");
    radio.type = "radio";
    radio.name = group;
    radio.value = value;
    const option = element("label", "radio");
    const said = element("span", "description");
    said.append(about);
    option.append(radio, element("span", undefined, label), said);
    wrap.append(option);
    buttons.set(value, radio);
    notes.set(value, said);
  }
  return { wrap, buttons, notes };
}

const name = text("name");
const host = text("host");
host.placeholder = "localhost";
const port = text("port");
port.placeholder = "5000";
const user = text("user");
const password = text("password", "password");
const timeout = text("timeout");
const tls = tick(
  "tls",
  "Connect with TLS, with the files in the ",
  link("TLS settings", "tls"),
  ".",
);
const protect = tick(
  "protect",
  "Run each query under .Q.trp, so that an error comes back with its backtrace. Turn it off when the server enforces an allowlist.",
);
const auth = radios("auth", [
  ["none", "None", "No password"],
  ["store", "Stored password", "Kept in VS Code's secure storage"],
  ["prompt", "Ask each time", "Never kept"],
  ["extension", "Extension", ""],
]);
const target = radios("target", [
  ["user", "User settings", "All your workspaces"],
  [
    "workspace",
    "Workspace settings",
    "This workspace, for anyone who opens it",
  ],
]);

const rows = {
  name: setting("Name", ["Unique in its folder"], name),
  host: setting("Host", ["A name or an address"], host),
  port: setting("Port", ["From 1 to 65535"], port),
  user: setting("User", ["Optional"], user),
  auth: setting("Authentication", [], auth.wrap),
  password: setting("Password", [], password),
  tls: setting("TLS", [], tls.wrap),
  protect: setting("Protected evaluation", [], protect.wrap),
  timeout: setting("Connection timeout", [], timeout),
  target: setting("Save to", [], target.wrap),
};

const save = element("button", undefined, "Save");
const test = element("button", "secondary", "Test");
// How a test went, beside the buttons
const tested = element("span", "tested");
tested.role = "status";
const cancel = element("button", "secondary", "Cancel");
const buttons = element("div", "buttons");
buttons.append(
  save,
  test,
  cancel,
  link("Edit in settings.json", "servers"),
  tested,
);

const form = element("form");
form.noValidate = true;
form.append(...Object.values(rows).map((row) => row.row), buttons);
document.body.append(title, where, note, banner, form);
form.hidden = true;

// The form as typed
function typed(): Form {
  const chosen = (group: Map<string, HTMLInputElement>) =>
    [...group].find(([, radio]) => radio.checked)?.[0];
  return {
    name: name.value,
    host: host.value,
    port: port.value,
    user: user.value,
    auth: (chosen(auth.buttons) ?? "none") as Form["auth"],
    password: password.value,
    tls: tls.box.checked,
    protect: protect.box.checked,
    timeout: timeout.value,
    target: (chosen(target.buttons) ?? "user") as Form["target"],
  };
}

function fill(form: Form) {
  name.value = form.name;
  host.value = form.host;
  port.value = form.port;
  user.value = form.user;
  password.value = form.password;
  timeout.value = form.timeout;
  tls.box.checked = form.tls;
  protect.box.checked = form.protect;
  for (const [value, radio] of auth.buttons) {
    radio.checked = value === form.auth;
  }
  for (const [value, radio] of target.buttons) {
    radio.checked = value === form.target;
  }
}

function changed(): boolean {
  return (
    loaded !== undefined && JSON.stringify(typed()) !== JSON.stringify(loaded)
  );
}

// Show what depends on what's typed: the password box for a stored
// password, and the problems of the fields left. Whether the form can be
// saved.
function update(): boolean {
  if (!context) {
    return false;
  }
  const form = typed();
  const found = problems(form, context, stored);
  for (const [field, row] of Object.entries(rows) as [
    Field,
    (typeof rows)[Field],
  ][]) {
    const problem = left.has(field) ? found[field] : undefined;
    row.problem.textContent = problem ?? "";
    row.row.classList.toggle("invalid", problem !== undefined);
  }
  rows.password.row.hidden = form.auth !== "store";
  password.placeholder = stored ? "Stored" : "";
  rows.password.about.textContent = stored
    ? "Stored for this user, host and port. Type another to replace it."
    : "Kept in VS Code's secure storage for this user, host and port, never in settings.";
  return Object.keys(found).length === 0;
}

// Whether a password is stored for the login as typed, asked once it
// changes
let asked = "";
function lookup() {
  const login: Login = { user: user.value, host: host.value, port: port.value };
  const key = JSON.stringify(login);
  if (key !== asked) {
    asked = key;
    stored = false;
    vscode.postMessage({ type: "lookup", login });
  }
}

function show(message: Extract<ToForm, { type: "load" }>) {
  pending = undefined;
  banner.hidden = true;
  save.disabled = false;
  test.disabled = false;
  tested.textContent = "";
  form.hidden = false;
  loaded = message.form;
  context = message.context;
  stored = message.stored;
  asked = JSON.stringify({
    user: message.form.user,
    host: message.form.host,
    port: message.form.port,
  });
  left.clear();
  fill(message.form);
  const {
    editing,
    folder,
    timeout: ms,
    authExtension,
    workspaceOpen,
  } = message.context;
  title.textContent =
    editing === undefined ? "Add Server" : `Edit ${message.form.name}`;
  where.textContent = folder.length > 0 ? `In ${folder.join(" › ")}` : "";
  where.hidden = folder.length === 0;
  note.hidden = !message.context.connected;
  rows.target.row.hidden = editing !== undefined || !workspaceOpen;
  rows.timeout.about.textContent = `How long to wait to connect and log in, in milliseconds; 0 waits as long as it takes. Empty for the connect timeout setting, ${ms === 0 ? "none" : `${ms} ms`}.`;
  timeout.placeholder = String(ms);
  const extension = auth.notes.get("extension");
  extension?.replaceChildren(
    ...(authExtension
      ? [`From ${authExtension}, the `, link("auth extension", "authExtension")]
      : ["Set the ", link("auth extension", "authExtension"), " first"]),
  );
  update();
}

// A message saying why, with a button to load the settings as they are
function warn(text: string, reload?: string) {
  banner.replaceChildren(element("span", undefined, text));
  if (reload) {
    const button = element("button", "secondary", reload);
    button.type = "button";
    button.addEventListener("click", () => {
      if (pending) {
        show(pending);
      }
    });
    banner.append(button);
  }
  banner.hidden = false;
}

window.addEventListener("message", (event: MessageEvent<ToForm>) => {
  const message = event.data;
  switch (message.type) {
    case "load":
      // A form with changes keeps them until Reload
      if (changed()) {
        pending = message;
        warn("The settings have changed.", "Reload");
      } else {
        show(message);
      }
      break;
    case "gone":
      warn(`${context?.editing} is no longer in the settings.`);
      save.disabled = true;
      test.disabled = true;
      break;
    case "tested":
      test.disabled = false;
      tested.className = message.ok ? "tested" : "tested failed";
      tested.textContent = message.text;
      break;
    case "stored":
      if (JSON.stringify(message.login) === asked) {
        stored = message.stored;
        update();
      }
      break;
  }
});

form.addEventListener("input", (event) => {
  const id = (event.target as HTMLElement).id;
  if (id === "user" || id === "host" || id === "port") {
    lookup();
  }
  update();
});
form.addEventListener("change", update);
// A field's problem shows once it's left, not while it's first typed
form.addEventListener("focusout", (event) => {
  const id = (event.target as HTMLElement).id as Field;
  if (id in rows) {
    left.add(id);
    update();
  }
});

// Save or test, once every problem's shown and there are none
function submit(type: "save" | "test") {
  for (const field of Object.keys(rows) as Field[]) {
    left.add(field);
  }
  if (!update() || save.disabled) {
    return;
  }
  if (type === "test") {
    test.disabled = true;
    tested.className = "tested";
    tested.textContent = "Connecting…";
  }
  vscode.postMessage({ type, form: typed() });
}

// Enter in a box saves, as a form submits
form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit("save");
});
test.type = "button";
test.addEventListener("click", () => submit("test"));
cancel.type = "button";
cancel.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));

vscode.postMessage({ type: "ready" });
