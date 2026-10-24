# Quirk: kdb+/q toolkit

A lightweight extension for kdb+/q programming.

## Scope

Quirk is for writing q, and in time for querying kdb+ and reading what comes
back, without leaving VS Code. It's one extension with nothing to install
alongside it. Today it highlights q, edits it and runs it in a terminal (see
[Features](#features)).

### Planned

- Connecting to a kdb+ process and running a query against it
- Results in a grid, shown as the q console shows them, using q's default
  display settings: a long keeps every digit and a timestamp keeps its
  nanoseconds. One deliberate difference: where the console leaves a null
  blank in a table, the grid shows which type of null it is. Copying a
  selection copies the text you see. The aim is a faithful view of the
  result, not text that's promised to read back into q
- Results as text too, as a q client shows them when they arrive, nulls
  left blank as q leaves them. There's more of it than q's console shows:
  1000 lines of 1000 characters, with `..` where it's cut, as q has. Where
  the text differs from q's:
  - A cell in a table, a matrix or a dictionary is cut at 256 characters, so
    that one long value doesn't widen every line of its column
  - A table or matrix wider than that ends in `..`, where q drops the
    columns past 1000 without saying so
  - A dictionary whose keys are a table is cut at the line limit, where q
    counts its entries and can run two lines over
  - About 1 in 50,000 datetimes shows a millisecond less than q does
- Go to definition, references, outline and workspace symbol search that
  follow q's namespaces and know which names are local to a lambda

### The query you send is the query you wrote

Quirk won't wrap a query to fetch extra metadata, or add a row limit to it.
Gateways that only allow listed calls see exactly what you typed. Row limits
only change what the grid shows. A result over the size limit is refused,
with a message saying how big it was and how to raise the limit.

### Out of scope

- Rename, formatting, diagnostics and `.k` files
- Names built from strings at runtime, such as `value "f",string x`: q can't
  resolve them until the code runs, so navigation won't either
- Starting or bundling q: Run Selected Text in Terminal sends your code to a
  q session you started, which remains the right tool for anything stateful

## Features

- Syntax highlighting for q, including the q 5 (KDB-X) keywords and
  `.Q`/`.z`/`.h`/`.j` namespaces
- Run the selected text, or the current line, in the active terminal (e.g. a
  q session). With several selections, each runs in turn
- Editing that keeps q's layout valid: pressing Enter between brackets keeps
  the closing bracket indented, Toggle Block Comment puts the `/` and `\`
  markers on lines of their own at column 0, and block comments fold

### Running selected text

The q REPL only accepts single-line input, so the selected text is sent one
statement at a time, following the same rules as a q script:
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

Both commands, and their keybindings, apply in q files.

| Command                               | Keybinding       |
| ------------------------------------- | ---------------- |
| kdb+/q: Run Selected Text in Terminal | Ctrl/Cmd + Enter |
| kdb+/q: Toggle Block Comment          | Shift + Alt + A  |
