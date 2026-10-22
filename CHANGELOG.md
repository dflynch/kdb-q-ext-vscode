# Change Log

All notable changes to the extension are documented in this file.

## [Unreleased]

### Changed

- New icons: a rounded q tile in the Marketplace, and a file icon with
  separate light and dark versions, so it stays clear in dark themes

### Fixed

- Dotted names that start with a reserved word, such as `null.x` or
  `select.y`, are highlighted as one name
- Negative times, such as `-12:34:56.789`, are highlighted as one literal
- `'[f;g]` (compose) is no longer highlighted as a signal
- The `.` in `\d .` is no longer highlighted as an operator

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
