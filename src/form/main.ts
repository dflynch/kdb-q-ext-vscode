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

// A setting: its name, its box or boxes, what it does, and its problem.
// A setting with one box has its name as the box's label, and what's
// under the box describes it, for a screen reader; one with tick boxes is
// a group named by it.
function setting(
  label: string,
  description: (string | Node)[],
  ...controls: HTMLElement[]
) {
  const row = element("div", "setting");
  const [first, ...under] = controls;
  const field =
    first instanceof HTMLInputElement || first instanceof HTMLSelectElement
      ? first
      : undefined;
  const name = element("label", "label", label);
  const about = element("div", "description");
  about.append(...description);
  const problem = element("div", "problem");
  row.append(name, ...controls, about, problem);
  if (field) {
    name.htmlFor = field.id;
    const notes = [...under, about, problem];
    notes.forEach((note, i) => {
      note.id = `${field.id}-${i}`;
    });
    field.setAttribute("aria-describedby", notes.map((n) => n.id).join(" "));
  } else {
    name.id = `${label.toLowerCase()}-label`;
    row.role = "group";
    row.setAttribute("aria-labelledby", name.id);
  }
  return { row, about, problem, field };
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
  const said = element("span");
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
const port = text("port");
const user = text("user");
user.placeholder = "Optional";
const password = text("password", "password");
const timeout = text("timeout");
timeout.placeholder = "No limit";
const tls = tick("tls", "Use TLS");
// Where TLS gets its certificates, under its tick once it's ticked
const tlsNote = element("div", "note-under description");
const protect = tick("protect", "Use protected evaluation");
const protectNote = element("div", "note-under description");
protectNote.append(
  "Wrap with ",
  element("code", undefined, ".Q.trp"),
  " so that an error returns a backtrace (may be blocked by a server that enforces an allowlist)",
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
  options: setting("Options", [], tls.wrap, tlsNote, protect.wrap, protectNote),
  timeout: setting("Connection timeout", ["Milliseconds"], timeout),
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
const cancel = element("button", "secondary", "Cancel");
// For a server already saved: there's nothing of an added one there yet
const json = link("Edit in settings.json", "servers");
const buttons = element("div", "buttons");
buttons.append(save, test, cancel, json);
// How a test went, or why a save failed, under the buttons
const tested = element("div", "tested");
tested.role = "status";

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
  tested,
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
// password, and the problems of the fields left. The fields with problems,
// shown or not.
function update(): Field[] {
  if (!context) {
    return ["name"];
  }
  const form = typed();
  const found = problems(form, context, stored);
  for (const [field, row] of Object.entries(rows)) {
    const problem = left.has(field as Field)
      ? found[field as Field]
      : undefined;
    row.problem.textContent = problem ?? "";
    row.row.classList.toggle("invalid", problem !== undefined);
    if (row.field) {
      row.field.ariaInvalid = problem === undefined ? null : "true";
    }
  }
  authMeaning.replaceChildren(...meanings[form.auth]);
  targetMeaning.replaceChildren(...meanings[form.target]);
  rows.password.row.hidden = form.auth !== "store";
  tlsNote.hidden = !form.tls;
  password.placeholder = stored ? "Stored" : "";
  rows.password.about.textContent = stored
    ? "Stored for this user, host and port: type another to replace it"
    : "For this user, host and port";
  return Object.keys(found) as Field[];
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
  const first = loaded === undefined;
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
  const { editing, folder, scopes, authExtension, workspaceOpen } =
    message.context;
  title.textContent =
    editing === undefined ? "Add Server" : `Edit ${message.form.name}`;
  // Its folders, and for one edited, the settings it's in
  const places = [
    ...(folder.length > 0 ? [folder.join(" › ")] : []),
    ...(scopes.length > 0
      ? [
          `${listed(scopes.map((scope) => (scope === "user" ? "User" : "Workspace")))} settings`,
        ]
      : []),
  ];
  where.textContent = places.length > 0 ? `In ${places.join(", in ")}` : "";
  where.hidden = places.length === 0;
  note.hidden = !message.context.connected;
  rows.target.row.hidden = editing !== undefined || !workspaceOpen;
  json.hidden = editing === undefined;
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
    : ["From the ", link("auth extension", "authExtension"), " setting"];
  update();
  if (first && editing === undefined) {
    name.focus();
  }
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
        warn(
          "The settings have changed. Reloading discards your edits.",
          "Reload",
        );
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
    case "unsaved":
      save.disabled = false;
      test.disabled = false;
      tested.className = "tested failed";
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

// What a test or a save said no longer holds once the server's changed
function changing(event: Event) {
  const id = (event.target as HTMLElement).id;
  if (id === "user" || id === "host" || id === "port") {
    lookup();
  }
  if (!test.disabled) {
    tested.textContent = "";
  }
  update();
}
form.addEventListener("input", changing);
form.addEventListener("change", changing);
// A field's problem shows once it's left, not while it's first typed
form.addEventListener("focusout", (event) => {
  const id = (event.target as HTMLElement).id as Field;
  if (id in rows) {
    left.add(id);
    update();
  }
});

// Save or test, once every problem's shown and there are none, or with
// the first box that has one focused. A test needs no name.
function submit(type: "save" | "test") {
  if (save.disabled) {
    return;
  }
  const needed = (Object.keys(rows) as Field[]).filter(
    (field) => type === "save" || (field !== "name" && field !== "target"),
  );
  for (const field of needed) {
    left.add(field);
  }
  const wrong = update().filter((field) => needed.includes(field));
  if (wrong.length > 0) {
    const boxes = [...form.querySelectorAll("input, select")];
    (
      boxes.find((box) => wrong.includes(box.id as Field)) as HTMLElement
    )?.focus();
    return;
  }
  test.disabled = true;
  tested.className = "tested";
  if (type === "test") {
    tested.textContent = "Connecting…";
  } else {
    save.disabled = true;
    tested.textContent = "";
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
// Escape cancels, as in a dialog
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) {
    vscode.postMessage({ type: "cancel" });
  }
});

vscode.postMessage({ type: "ready" });
