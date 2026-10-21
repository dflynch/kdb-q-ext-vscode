# kdb-q-ext-vscode

A lightweight extension for kdb+/q programming.

## Features

- Syntax highlighting for q, including the q 5 (KDB-X) keywords and
  `.Q`/`.z`/`.h`/`.j` namespaces
- Run the selected text, or the current line, in the active terminal (e.g. a
  q session)
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

Both keybindings apply in q files.

| Command                      | Keybinding       |
| ---------------------------- | ---------------- |
| kdb+/q: Run Selected Text    | Ctrl/Cmd + Enter |
| kdb+/q: Toggle Block Comment | Shift + Alt + A  |
