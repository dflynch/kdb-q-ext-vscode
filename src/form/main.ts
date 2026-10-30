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

// A setting: its name, its box or boxes, what it does, and its problem
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
  row.append(name, ...controls, about, problem);
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

// A dropdown, as the Settings editor has for a choice
function choice(id: Field, options: [string, string][]) {
  const select = element("select");
  select.id = id;
  for (const [value, label] of options) {
    const option = element("option", undefined, label);
    option.value = value;
    select.append(option);
  }
  return select;
}

const name = text("name");
const host = text("host");
host.placeholder = "localhost";
const port = text("port");
port.placeholder = "5000";
const user = text("user");
user.placeholder = "Optional";
const password = text("password", "password");
const timeout = text("timeout");
const tls = tick("tls", "Use TLS");
// Where TLS gets its certificates, under its tick once it's ticked
const tlsNote = element("div", "note-under description");
const protect = tick(
  "protect",
  "Use protected evaluation so that an error returns its backtrace (switch it off when the server enforces an allowlist)",
);
const auth = choice("auth", [
  ["none", "None"],
  ["store", "Stored password"],
  ["prompt", "Ask each time"],
  ["extension", "Extension"],
]);
const target = choice("target", [
  ["user", "User settings"],
  ["workspace", "Workspace settings"],
]);

// What each choice means, under its dropdown; the extension's once the
// form knows it
const meanings: Record<string, (string | Node)[]> = {
  none: ["No password"],
  store: ["Kept in VS Code's secure storage"],
  prompt: ["Asked for at each connect, never kept"],
  extension: [],
  user: ["All your workspaces"],
  workspace: ["This workspace, for anyone who opens it"],
};
const authMeaning = element("div", "meaning description");
const targetMeaning = element("div", "meaning description");

const rows = {
  name: setting("Name", [], name),
  host: setting("Host", [], host),
  port: setting("Port", [], port),
  user: setting("User", [], user),
  auth: setting("Authentication", [], auth, authMeaning),
  password: setting("Password", [], password),
  options: setting("Options", [], tls.wrap, tlsNote, protect.wrap),
  timeout: setting("Timeout", [], timeout),
  target: setting("Save to", [], target, targetMeaning),
};
rows.timeout.row.classList.add("half");
rows.target.row.classList.add("half");

// Settings side by side
function line(...settings: { row: HTMLElement }[]) {
  const div = element("div", "line");
  div.append(...settings.map((setting) => setting.row));
  return div;
}

const save = element("button", undefined, "Save");
const test = element("button", "secondary", "Test");
// How a test went, beside the buttons
const tested = element("span", "tested");
tested.role = "status";
const cancel = element("button", "secondary", "Cancel");
// For a server already saved: there's nothing of an added one there yet
const json = link("Edit in settings.json", "servers");
const buttons = element("div", "buttons");
buttons.append(save, test, cancel, json, tested);

const form = element("form");
form.noValidate = true;
form.append(
  rows.name.row,
  line(rows.host, rows.port),
  line(rows.user, rows.auth),
  rows.password.row,
  line(rows.timeout),
  rows.options.row,
  line(rows.target),
  buttons,
);
document.body.append(title, where, note, banner, form);
form.hidden = true;

// The form as typed
function typed(): Form {
  return {
    name: name.value,
    host: host.value,
    port: port.value,
    user: user.value,
    auth: auth.value as Form["auth"],
    password: password.value,
    tls: tls.box.checked,
    protect: protect.box.checked,
    timeout: timeout.value,
    target: target.value as Form["target"],
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
  auth.value = form.auth;
  target.value = form.target;
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
  for (const [field, row] of Object.entries(rows)) {
    const problem = left.has(field as Field)
      ? found[field as Field]
      : undefined;
    row.problem.textContent = problem ?? "";
    row.row.classList.toggle("invalid", problem !== undefined);
  }
  authMeaning.replaceChildren(...meanings[form.auth]);
  targetMeaning.replaceChildren(...meanings[form.target]);
  rows.password.row.hidden = form.auth !== "store";
  tlsNote.hidden = !form.tls;
  password.placeholder = stored ? "Stored" : "";
  rows.password.about.textContent = stored
    ? "Stored for this user, host and port: type another to replace it"
    : "For this user, host and port";
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

// Names as a list in words: a, b and c
function listed(names: string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
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
  json.hidden = editing === undefined;
  rows.timeout.about.textContent = `In ms, 0 for none; empty for ${ms === 0 ? "none" : `${ms} ms`}`;
  timeout.placeholder = String(ms);
  const files = message.context.tlsFiles;
  tlsNote.replaceChildren(
    ...(files.length === 0
      ? [
          "Trusts your system's certificates. For a private CA or a client certificate, set them in ",
          link("settings.json", "tls"),
        ]
      : [`Using ${listed(files)} from `, link("settings.json", "tls")]),
  );
  meanings.extension = authExtension
    ? [`From ${authExtension}, the `, link("auth extension", "authExtension")]
    : ["Set the ", link("auth extension", "authExtension"), " first"];
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
