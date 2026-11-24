# Change Log

All notable changes to the extension are documented in this file.

## [2.0.0]

Ink now runs q on your kdb+ servers and shows the results, and reads your
workspace's q code for navigation, hover, completion and syntax errors.
See the [README](README.md) for a walkthrough.

### Breaking changes

- Cmd+Enter (Ctrl+Enter) runs the selection on a server. Shift+Enter runs
  it in the terminal, as Cmd+Enter did before.
- Three highlighting scopes are renamed. Colour customisations on the old
  names no longer apply:
  - `support.class.handle.q` is now `constant.language.symbol.handle.q`
  - `meta.preprocessor` is now `keyword.control.directive`
  - `keyword.other.qsql.q` is now `keyword.control.qsql.q`

### Added

- **Servers and connections:** the Servers view, under the `q)` icon in the
  Activity Bar, holds servers in folders. Add and edit them in a form, or in
  settings. Passwords are kept in VS Code's secure storage, asked for at
  each connect, or supplied by a sign-on extension. TLS and protected
  evaluation are per server. The status bar shows the active server and how
  long the last query took.
- **Running on a server:** **Run Selected Text on Server** and **Run File on
  Server** send the text as one query, exactly as written.
- **Results:** the **KDB+/Q** panel shows the latest result in three tabs:
  - **Console**, as q's console prints it
  - **Grid**, with sorting, filters that compare as q does, drilling into a
    cell, and copying
  - **Chart**, as a line, bars, a histogram or a scatter
- **Pin Result** keeps a result in an editor tab of its own, to compare with
  the next. **Export Result to CSV** saves the Grid as q's `csv 0:` writes
  it.
- **Settings:** `servers`, `consoleSize`, `precision`, `sizeLimit`,
  `rowLimit`, `authExtension`, the TLS files and `diagnosticMode`.
- **Navigation:** Go to Definition, Find All References, Go to Symbol in
  Workspace and the outline follow q's namespaces across the workspace,
  including q 5 modules and the paths in `\l` lines.
- **Hover:** KX's reference for q's keywords and `.Q`, `.z`, `.h` and `.j`
  names, and the signature and comments of your own globals.
- **Parameter hints and completion**, from KX's reference and your
  workspace.
- **Syntax errors** as you type: a bracket or string left open, and a
  closing bracket with no opener.
- A lambda's parameters and locals share the parameter colour, so a
  misspelt local stands out.

More in [Running queries and reading results](docs/results.md) and
[Navigation and editing](docs/navigation.md).

### Changed

- The extension is now named Ink: kdb+/q toolkit, with a new icon. The
  Activity Bar and panel show q's prompt, `q)`, and q files a purple q.
- Run Selected Text is now **Run Selected Text in Terminal**. It has q load
  the selection as a script, from a file in the temp folder, so it stops at
  the first error. A q that can't read this machine's temp folder, such as
  one over ssh, can't load it.
- Both Run commands are on the editor's right-click menu. Clicking the
  status bar opens a menu of the server commands.
- Handles, such as `` `:data/trades.csv ``, are coloured as symbols. System
  commands, such as `\l`, and `k)` are coloured as imports. qSQL's
  `select`, `from`, `by` and `where` are coloured as `if`, so they no longer
  look like symbols in Dark and Light Modern.

### Fixed

- `where` as a function, such as `where 101b`, is coloured as a built-in.
  Only the `where` that opens a where clause is coloured as qSQL.
- Dotted names that start with a reserved word, such as `null.x`, and names
  under a namespace member, such as `.z.ts.x`, are highlighted as one name.
- Negative times, such as `-12:34:56.789`, and lowercase typed nulls and
  infinities, such as `0nz` and `-0wz`, are highlighted as one literal.
- `'[f;g]` (compose) is no longer highlighted as a signal.
- A line after `q)` is highlighted as q reads it, as at column 0, and a
  `p)` or other language's line is highlighted as that language's, not as q.
- The `.` in `\d .` is no longer highlighted as an operator.
- In a parameter list, a type or filter after a parameter's colon, such as
  ``{[a:`j;b:f[1]] …}``, and a pattern, such as `(a;b)`, are highlighted
  as code, and comments as comments.

## [1.1.0]

### Added

- q 5 (KDB-X) keywords and namespace members: `use`, 25 `.Q` members,
  `.h.ka`, and `.z.A`, `.z.M`, `.z.m` and `.z.v`
- Highlighting for signal (`'`), `x`/`y`/`z` as implicit parameters, casts
  (`` `int$ ``, `"j"$`, `7h$`), attributes (`` `s# ``), internal functions
  (`-11!`) and `k)` lines
- **kdb+/q: Toggle Block Comment** (Shift+Alt+A), which puts the `/` and `\`
  markers on lines of their own at column 0. VS Code's built-in command
  wrapped the selection inline, which q can't parse
- Folding for `/` … `\` block comments
- Run Selected Text and Toggle Block Comment work with several selections

### Changed

- Requires VS Code 1.140 or later
- The extension is now named Quirk: kdb+/q toolkit in the Marketplace and
  Extensions view
- Highlighting colors: control flow, qSQL, built-in functions, `.Q`/`.z`,
  symbols, file handles and strings are now distinct in VS Code's default
  themes, and names, including function names, are no longer colored. See
  the README to customize them
- Run Selected Text warns when there is no active terminal
- The Ctrl/Cmd + Enter keybinding only applies when the editor has focus
- The commands only appear in the Command Palette for q files
- `.Q.Cf` and `.Q.Xf`, removed in q 5, are no longer highlighted

### Fixed

- Run Selected Text sends the selection as q reads a script:
  - each statement on its own line, so selections with more than one
    statement work
  - a `/` in a string is no longer taken for a comment
  - whitespace and line breaks in strings are kept
  - system commands, such as `\l /path/to/file.q`, are sent as is
  - an unterminated block comment hides the rest of the selection
- Highlighting no longer splits typed nulls and infinities (`0Ni`, `-0Wf`),
  timespans (`1D02:00:00`), bytes (`0x0`), numbers with temporal suffixes
  (`3n`, `1p`), dotted names (`a.b.c`) or file handles with paths
  (`` `:data/trades.csv ``)
- `.`, `,` and `_` are highlighted as operators, and `-` as part of a
  negative number where q reads it that way (`x -1`, but `x-1` is minus)
- All string escapes q accepts are highlighted: `\n`, `\t`, `\r` and octal
- Every name in a `{[a;b]}` parameter list is highlighted as a parameter
- System command arguments, such as the path in `\cd /tmp`, are no longer
  highlighted as comments
- A comment after `\t` or `\ts` is highlighted as a comment, not code
- Double-clicking, or Ctrl/Cmd + D, selects a whole dotted name or file
  handle
- Pressing Enter between brackets no longer moves the closing bracket to
  column 0, where q would read it as a new statement
- Block comments nest, as in q, for highlighting, Run Selected Text and
  Toggle Block Comment

## [1.0.2]

### Added

- Language configuration

## [1.0.1]

### Added

- Icon

## [1.0.0]

- Initial release
