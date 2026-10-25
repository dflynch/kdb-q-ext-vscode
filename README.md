# Quirk: kdb+/q toolkit

A lightweight extension for kdb+/q programming.

## Scope

Quirk is for writing q, and in time for querying kdb+ and reading what comes
back, without leaving VS Code. It's one extension with nothing to install
alongside it. Today it highlights q, edits it, runs it in a terminal, and
connects to kdb+ to run queries and show their results as q's console does,
and tables in a grid (see [Features](#features)).

### Planned

- In the grid: double-clicking a cell to see its whole value, or a table
  inside it as a result of its own, and copying a selection as the text you
  see
- Go to definition, references, outline and workspace symbol search that
  follow q's namespaces and know which names are local to a lambda

### The query you send is the query you wrote

Quirk never edits a query: it won't wrap it to fetch extra metadata, or add
a row limit to it. With [protected evaluation](#protected-evaluation) on, the
text is sent beside the function that traps its errors, unchanged; turn it
off and a gateway that only allows listed calls sees exactly what you typed.
Row limits only change what the grid shows. A result over the size limit,
`sizeLimit`, is refused, and the connection closed.

### Out of scope

- Rename, formatting, diagnostics and `.k` files
- Names built from strings at runtime, such as `value "f",string x`: q can't
  resolve them until the code runs, so navigation won't either
- Starting or bundling q: Quirk connects to kdb+ processes you started, and
  Run Selected Text in Terminal sends your code to a q session you started

## Features

- Syntax highlighting for q, including the q 5 (KDB-X) keywords and
  `.Q`/`.z`/`.h`/`.j` namespaces
- Connect to kdb+ processes, over TLS if need be, with passwords kept in
  VS Code's secure storage, asked for, or given by another extension
- Run the file, the selected text or the current line on the connected
  server, and see the result as q's console shows it, with how long it took
- Run the selected text, or the current line, in the active terminal (e.g. a
  q session). With several selections, each runs in turn
- Editing that keeps q's layout valid: pressing Enter between brackets keeps
  the closing bracket indented, Toggle Block Comment puts the `/` and `\`
  markers on lines of their own at column 0, and block comments fold

### Servers

Add a server with **kdb+/q: Add Server**, which asks for each setting and
saves it to your user or workspace settings, or write it in `settings.json`:

```json
"kdb-q-ext-vscode.servers": {
  "dev": { "host": "localhost", "port": 5000 },
  "gateway": {
    "host": "gw.example.com",
    "port": 6000,
    "user": "admin",
    "auth": "prompt",
    "tls": true,
    "protect": false
  }
}
```

- **Passwords** aren't kept in settings. **kdb+/q: Set Server Password**
  keeps one in VS Code's secure storage, for the user, host and port, and
  **Clear Server Password** removes it. `"auth": "prompt"` asks for it at
  every connect instead, and never keeps it
- **TLS** is `true`, or the files it needs besides the system's: a `ca` to
  trust, and a client certificate as `cert` and `key` in PEM, or `pfx`.
  Paths are absolute or start with `~/`. A client certificate's passphrase
  is kept by **kdb+/q: Set Certificate Passphrase**
- **`timeout`** is how long to wait to connect and log in, in milliseconds,
  overriding `connectTimeout`; 0 waits as long as it takes, as `hopen` does

#### Protected evaluation

On by default, each query runs under `.Q.trp`, so an error comes back with
its backtrace, and the status bar can show the server's time running it.
Turn it off with `"protect": false` for a server whose `.z.pg` is customised
or only takes strings, such as a gateway: the query is then sent as a
string. An error protected evaluation should have caught, or a response it
didn't give, comes with a hint to turn it off.

#### Sign-on from another extension

For a firm's own sign-on, `"auth": { "extension": "publisher.name", … }`
asks that extension for credentials at every connect, so a token is always
fresh. The extension exports `credentials(request)`, which returns, or
resolves to, `{ user?, password }`; a user it gives replaces the server's.
The request is `{ name, host, port, user?, fields }`, where `fields` is the
rest of the `auth` object.

### Connecting

**kdb+/q: Connect to Server** picks a server and makes its connection the
active one, opening it if it isn't open. Several can be open at once.
**Disconnect from Server** closes one.

The status bar shows the active connection, and opens a menu of the server
commands when clicked:
- A plug, joined when connected and pulled apart when not, spinning while
  it connects or runs a query, and a warning color when the connection
  closed without being disconnected
- How long the last query took, as `2 ms (3 ms roundtrip)`: the server's
  time, as `\t` gives, and the roundtrip. Without protected evaluation, only
  the roundtrip is known
- The server's settings in its tooltip, without secrets

### Running on a server

**kdb+/q: Run File on Server**, also the ▶ in the editor's title bar, sends
the whole file, including edits not yet saved, as one query, exactly as
written, as a q client such as kdb Studio does. Unlike the terminal, nothing
is split or removed: a server reads line breaks as spaces. With no
connection open, it asks for a server, and with one opening, it waits.

**kdb+/q: Run Selected Text on Server** sends the selection, or the current
line, the same way. With several selections, only the first is sent.

The result shows in the **kdb+/q** tab of the bottom panel, beside Output and
Terminal, as q's console prints it, replacing the last: an assignment shows
nothing, and an error shows as `'type` with its backtrace. Running a query
brings the tab into view and leaves the cursor in the editor. Switching away
and back keeps the result, its sort, filter and scroll, as it was.

A table, a keyed table or a dictionary also shows in a grid. The tab has two
views of the result, **Console** and **Grid**, and the one you chose last is
kept for the next result; anything else, or an error, shows in the Console.
Cells read as q's console shows them in a column: symbols bare, strings in
quotes, nulls blank, and numbers lined up on the right. A keyed table's keys
stay pinned on the left as it scrolls, and a dictionary is a `key` and a
`value` column. A table inside a cell shows as `table, 3 rows`. Click a
header to sort, by q's order, with nulls first; its filter matches the text
shown. Beside the tabs is the result's size, such as `312 of 1000000 rows,
5 columns` while filtered.

There's more of it than q's console shows: 1000 lines of 1000 characters by
default, set by `consoleSize` as `\c` takes them, with `..` where it's cut,
as q has. Nulls are left blank as q leaves them. Where the text differs from
q's:
- A cell in a table, a matrix or a dictionary is cut at 256 characters, so
  that one long value doesn't widen every line of its column
- A table or matrix wider than the console ends in `..`, where q drops the
  columns without saying so
- A dictionary whose keys are a table is cut at the line limit, where q
  counts its entries and can run two lines over
- About 1 in 50,000 datetimes shows a millisecond less than q does

### Running in a terminal

**kdb+/q: Run Selected Text in Terminal** sends the selection, or the
current line, to the active terminal, such as a q session. The q REPL only
accepts single-line input, so the selected text is sent one statement at a
time, following the same rules as a q script:
- A line starting at column 0 begins a new statement, and an indented line
  continues the previous one
- Comments are removed, including block comments and everything after a lone
  `\`
- System commands, such as `\l`, are sent as is
- A string that spans lines keeps its line breaks, as `\n`

### Customizing colors

VS Code's default themes have fewer colors than q has kinds of token, so
some kinds share a color, such as file handles and `.Q`/`.z`. Each kind has
its own scope, so you can give it a color of your own in `settings.json`:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "support.class.handle.q", "settings": { "foreground": "#d19a66" } },
    { "scope": "constant.numeric.date.q", "settings": { "foreground": "#56b6c2" } }
  ]
}
```

Each scope below also covers the more specific scopes that start with it,
such as `constant.numeric.date.q`, and `source.q` keeps a rule to q files.

| Tokens                                                  | Scope                               |
| ------------------------------------------------------- | ----------------------------------- |
| `if`, `$[`, `do`, `while`, `exit`, `'` (signal)         | `source.q keyword.control`          |
| `select`, `from`, `by`, `where`, …                      | `keyword.other.qsql.q`              |
| `count`, `each`, `0:`, `-11!`, …                        | `source.q support.function.builtin` |
| `` `int$ ``, `"j"$`, `` `$ `` (casts)                   | `support.type.cast.q`               |
| `` `s# ``, `` `u# ``, `` `p# ``, `` `g# `` (attributes) | `storage.modifier.attribute.q`      |
| `.Q.dd`, `.z.p`, `.h.ht`, `.j.j`                        | `source.q support.class.namespace`  |
| `` `:data/trades.csv ``                                 | `support.class.handle.q`            |
| `` `sym ``                                              | `constant.language.symbol.q`        |
| `0N`, `0w`, dates, times, numbers                       | `source.q constant.numeric`         |
| `x`, `y`, `z` and `{[a;b]` parameters                   | `source.q variable.parameter`       |
| `/ \ ' ': /: \:` (iterators)                            | `keyword.operator.iterator.q`       |
| `\l`, `\t`, … and `k)`                                  | `source.q meta.preprocessor`        |

Run **Developer: Inspect Editor Tokens and Scopes** to see the scope of any
token.

## Commands

The Run and Toggle Block Comment commands, and their keybindings, apply in
q files. The Run commands are on the editor's right-click menu, and the
server commands on the status bar's.

| Command                               | Keybinding       |
| ------------------------------------- | ---------------- |
| kdb+/q: Run File on Server            |                  |
| kdb+/q: Run Selected Text on Server   | Ctrl/Cmd + Enter |
| kdb+/q: Run Selected Text in Terminal | Shift + Enter    |
| kdb+/q: Toggle Block Comment          | Shift + Alt + A  |
| kdb+/q: Connect to Server             |                  |
| kdb+/q: Disconnect from Server        |                  |
| kdb+/q: Add Server                    |                  |
| kdb+/q: Open Settings                 |                  |
| kdb+/q: Set Server Password           |                  |
| kdb+/q: Clear Server Password         |                  |
| kdb+/q: Set Certificate Passphrase    |                  |
| kdb+/q: Clear Certificate Passphrase  |                  |

Shift + Enter stands aside while the suggestion list is open, where it
accepts a suggestion. Ctrl/Cmd + Enter replaces VS Code's Insert Line Below
in q files. Other extensions can bind it too, such as GitHub Copilot, to
open its completions panel; if one does, choose which runs in **Preferences:
Open Keyboard Shortcuts**.

## Settings

| Setting                           | Default        | What it does                                                 |
| --------------------------------- | -------------- | ------------------------------------------------------------ |
| `kdb-q-ext-vscode.servers`        | `{}`           | The servers to connect to, by name (see [Servers](#servers)) |
| `kdb-q-ext-vscode.connectTimeout` | `2000`         | How long to wait to connect and log in, in ms; 0 waits       |
| `kdb-q-ext-vscode.consoleSize`    | `[1000, 1000]` | How much of a result to show, as lines then width            |
| `kdb-q-ext-vscode.sizeLimit`      | `10`           | The largest result to take, in MB, uncompressed              |

A result over `sizeLimit` is refused and the connection closed. The extension
holds the latest result as it arrived, and decodes it in the **kdb+/q** tab,
where some results take up to 60 times their size: a tab that runs out of
memory goes blank, while VS Code and other extensions carry on.
