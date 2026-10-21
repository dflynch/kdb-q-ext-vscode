# kdb-q-ext-vscode

A lightweight extension for kdb+/q programming.

## Features

- Syntax highlighting for q, including the q 5 (KDB-X) keywords and
  `.Q`/`.z`/`.h`/`.j` namespaces
- Editing that keeps q's layout valid: pressing Enter between brackets keeps
  the closing bracket indented (with `editor.autoIndent` at its default,
  `full`, or `advanced`), and block comments fold
- Run the selected text, or the current line, from \*.q files in the active
  terminal (e.g. a q session)

### Running selected text

The q REPL only accepts single-line input, so the selected text is sent one
statement at a time, following the same rules as a q script:
- A line starting at column 0 begins a new statement, and an indented line
  continues the previous one
- Comments are removed, including block comments and everything after a lone
  `\`
- System commands, such as `\l`, are sent as is

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

| Tokens                                          | Scope                                 |
| ----------------------------------------------- | ------------------------------------- |
| `if`, `$[`, `do`, `while`, `exit`, `'` (signal) | `keyword.control.*.q`                 |
| `select`, `from`, `by`, `where`, …              | `keyword.other.qsql.q`                |
| `count`, `each`, `0:`, …                        | `support.function.builtin.q`, `…io.q` |
| `.Q.dd`, `.z.p`, `.h.ht`, `.j.j`                | `support.class.namespace.*.q`         |
| `` `:data/trades.csv ``                         | `support.class.handle.q`              |
| `` `sym ``                                      | `constant.language.symbol.q`          |
| `0N`, `0w`, dates, times, numbers               | `constant.numeric.*.q`                |
| `x`, `y`, `z` and `{[a;b]` parameters           | `variable.parameter.q`, `…implicit.q` |
| `/ \ ' ': /: \:` (iterators)                    | `keyword.operator.iterator.q`         |
| `\l`, `\t`, … and `k)`                          | `meta.preprocessor.*.q`               |

Run **Developer: Inspect Editor Tokens and Scopes** to see the scope of any
token.

## Commands

| Command                   | Keybinding       | When                                   |
| ------------------------- | ---------------- | -------------------------------------- |
| kdb+/q: Run Selected Text | Ctrl/Cmd + Enter | editorTextFocus && editorLangId == 'q' |

## Release Notes

### 1.0.0

Initial release

### 1.0.1

Add icon

### 1.0.2

Add language configuration
