# Change Log

All notable changes to the "kdb-q-ext-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed

- Run Selected Text sends each statement on its own line, so selections
  containing more than one statement run as they would in a q script
- Run Selected Text no longer mistakes a "/" in a string for a comment
- Run Selected Text preserves whitespace in strings
- Run Selected Text sends system commands, such as `\l /path/to/file.q`, as is
- Run Selected Text ignores the rest of an unterminated block comment
- Run Selected Text keeps the line breaks in a string that spans lines
- Highlighting no longer splits typed nulls and infinities (`0Ni`, `-0Wf`),
  timespans (`1D02:00:00`), bytes (`0x0`), dotted names (`a.b.c`) or file
  handles with paths (`` `:data/trades.csv ``)
- `.`, `,` and `_` are highlighted as operators, and `-` as part of a
  negative number where q reads it that way (`x -1`, but `x-1` is minus)
- All string escapes q accepts are highlighted: `\n`, `\t`, `\r` and octal
- Every name in a `{[a;b]}` parameter list is highlighted as a parameter
- System command arguments, such as the path in `\cd /tmp`, are no longer
  highlighted as comments. This includes `\t:n` and `\ts:n`, and commands
  q passes to the operating system, such as `\ls /tmp`
- Numbers with temporal type suffixes, such as `3n`, `12t` and `1p`, are
  one literal
- Double-clicking, or Ctrl/Cmd + D, selects a whole dotted name (`a.b.c`)
  or file handle (`` `:data/trades.csv ``)
- Pressing Enter between brackets no longer moves the closing bracket to
  column 0, where q would read it as a new statement
- Toggle Block Comment (Shift+Alt+A) comments out the selected lines with
  `/` and `\` marker lines at column 0, which works inside functions too, and
  removes the markers of a block it is run in. It used to wrap the selection
  inline, which q can't parse

### Added

- q 5 (KDB-X) keywords and namespace members: `use`, 25 `.Q` members and
  `.h.ka`
- Highlighting for signal (`'`), `x`/`y`/`z` as implicit parameters, and
  `k)` lines
- Highlighting for casts (`` `int$ ``, `"j"$`, `` `$ ``, `7h$`), attributes
  (`` `s# ``) and internal functions (`-11!`)
- `.z.A`, `.z.M`, `.z.m` and `.z.v`, which q 5 defines
- Folding for `/` … `\` block comments
- A README section on customizing colors, with the scope for each kind of
  token

### Changed

- Run Selected Text warns when there is no active terminal
- The Ctrl/Cmd + Enter keybinding only applies when the editor has focus
- Highlighting scopes were reworked so control flow, qSQL, built-in
  functions, `.Q`/`.z`, symbols, file handles and strings are distinct in
  VS Code's default themes; names, including function names, are no
  longer colored
- `.Q.Cf` and `.Q.Xf`, removed in q 5, are no longer highlighted

## [1.0.2]

### Added

- Language configuration

## [1.0.1]

### Added

- Icon

## [1.0.0]

- Initial release
