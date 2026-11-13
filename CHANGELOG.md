# Change Log

All notable changes to the extension are documented in this file.

## [Unreleased]

### Added

- Servers, added and edited in a form, **kdb+/q: Add Server** and **Edit
  Server**, or in settings, and removed by **Remove Server**, in folders to
  any depth if you like, with TLS, passwords kept in VS Code's secure
  storage, asked for at every connect, or given by another extension, and
  protected evaluation
- The **Servers** view, under the q in the activity bar: servers in their
  folders, with each connection's state; connect, disconnect, dismiss,
  edit and remove from a row, add servers and folders, rename and remove
  folders, and drag to move. A server with a problem in the settings is
  listed with it, to fix in the form
- **kdb+/q: Connect to Server** and **Disconnect from Server**, with the
  active connection, and how long its last query took, in the status bar.
  A connection that fails to open, or drops, is kept with why until it's
  connected again, or dismissed with **Dismiss Closed Connection**
- **kdb+/q: Run File on Server**, also the ▶ in the editor's title bar,
  which sends the whole file as one query, and shows the result in the
  **KDB+/Q** tab of the bottom panel as q's console prints it, and a
  table, keyed table, dictionary or list in a grid too, with each row's
  index, sorting, filters of the text shown, or of numbers and times
  compared as q compares them, typed as q writes them or picked, and a
  cell's value, double-clicked, as a result of its own
- **kdb+/q: Run Selected Text on Server**, which sends the selection, or
  the current line, the same way
- **kdb+/q: Keep Result**, also the pin in the **KDB+/Q** tab's title
  bar, which opens the latest result in an editor tab of its own, where the
  next query doesn't replace it, for comparing results side by side; it
  opens as it was left: the view, the cell drilled into, each grid's sort,
  filter and column order, and each chart's settings
- **kdb+/q: Export Result to CSV**, also a button in the **KDB+/Q** tab's
  title bar and a kept tab's, which saves the Grid shown, its rows as
  sorted and filtered, as q's `csv 0:` writes them, quoted as RFC 4180 has
  it; like q's, it won't write a column of lists or tables
- Copy in the Grid: click a cell, then drag, Shift+click or Shift+arrows
  for a rectangle, scrolling as a drag reaches the edge; a row's index for
  the row, Ctrl+Space for a column, Shift+Space for a row, Cmd+A (Ctrl+A)
  for all. Cmd+C (Ctrl+C) copies the cells as tab-separated text, the
  values Export to CSV writes, and **Copy with Headers** in the grid's menu
  adds the column names; neither copies a column of lists or tables
- A Chart view beside the Console and the Grid: a line, joining its points
  or as steps, of numeric columns by a time, a number or each row's index,
  or bars side by side for each row, labelled by any columns, or a
  histogram of a numeric or time column, binned as numpy's `auto` bins,
  in widths that read well, or into as many bins as typed, or a scatter
  of numeric columns by another, a million points at a time. It opens on a
  bar where the first column is a label, labelled by it or a keyed table's
  keys, else a line by the first time or number, of one series; its
  settings, at the right, choose the type and the columns, and its legend
  hides and shows a series. Drag across it to zoom, double-click to zoom
  out. It draws the whole result, as it came,
  a line sorted by its x, and says how many nulls and infinities it left
  out; a value at the cursor is as the Grid shows it, numbers on the axes
  as q writes them, and times as q writes them, never shifted to the
  machine's time zone; times are drawn and binned to the millisecond,
  finer digits cut off as q casts, so a timespan under a millisecond, such
  as a latency, is drawn as 0, and zoomed no closer than ten milliseconds;
  integers are written as q writes them, and a long past 2^53 is drawn as
  nearly as a double holds it, as a float is
- Settings: `servers`, `consoleSize`, `precision`, as q's `\P`, for floats
  and reals wherever a result is written, `sizeLimit`, the largest result
  taken, and `rowLimit`, the most rows shown, as the Grid's memory goes by
  its rows
- Navigation for q: the outline and breadcrumbs, highlighting a name where
  it occurs, Go to Definition, Find All References and Go to Symbol in
  Workspace, across the workspace's `.q` files, following namespaces,
  lambdas' locals and q 5 modules. `s.f`, ``s`f`` and ``s[`f]`` follow
  ``s:use`mod`` in the file, or, if the file doesn't define `s`, in any
  other file. ``s`f`` and ``s[`f]`` also follow a top-level view
  ``s::use`mod``, as q 5.0 does. A module's own globals are followed only
  in the module. ``s`f`` and ``s[`f]`` highlight together, apart from
  `s.f`, which q reads alike only through a module. Find All
  References lists the uses that pass a global by reference under a group
  of their own. Go to Definition has every definition of a global, where
  its whole value is set, which VS Code lists by file and line; the hover
  shows the nearest file's latest. An amend, as `t,:x` or `` `t upsert x ``, is a reference
- Go to Definition on the path a `\l` line names: the workspace's `.q`
  files whose paths end with it, as `\l common/util.q` has
  `code/common/util.q`, as the directory q runs in isn't known. `.`
  anywhere, any number of leading `..`, and empty segments, as in
  `lib//util.q` or a leading `/`, are dropped, and `x/..` cancels out, so
  an absolute path matches as a suffix. VS Code jumps to one, or lists
  several in a peek
- Hover for q: a keyword's, or a `.Q`, `.z`, `.h` or `.j` name's, syntax and
  description from KX's reference, linked; a global's, or a module
  export's, signature, then the comment above its definition, as written,
  with a link to its other definitions. A signature shows each parameter as
  written, typed (``[a:`j;b]``) or as a pattern (`[(src;dst);speed]`)
- Parameter hints for q: a call's signatures while typing its arguments in
  brackets, the current parameter highlighted: q's forms of a keyword, with
  KX's line and link, then each definition's, with its comment and file
- Syntax errors for q as you type: a bracket or string left open, marked
  where its close was expected, linked to where it opened, and a close with
  nothing to close. Open files only, or every `.q` file in the workspace
  with `kdb-q-ext-vscode.diagnosticMode`
- Completion for q: the lambda's parameters and locals, the workspace's
  globals in the root, or after `\d .ns` the namespace's, and q's keywords; after a dot, a namespace's members, q's own in
  `.Q`, `.z`, `.h` and `.j` with KX's line, or a module's exports, as `s.`
  for ``s:use`mod`` in the file or, if it doesn't define `s`, another;
  and a symbol starting with a dot, as `` `.ns. ``. VS
  Code's word-based suggestions are off for q
- A lambda's parameters and locals in the parameter colour wherever they're
  used, so its own names stand apart from globals, as a misspelt local
  does; a local is still a variable to themes that colour them apart

### Changed

- The extension is now named Ink: kdb+/q toolkit, with a new icon: an ink q
  on paper, its tail ending in a drop. q files and the kdb+/q icon in the
  Activity Bar and panel have the same q
- Run Selected Text is now Run Selected Text in Terminal, beside Run
  Selected Text on Server
- Ctrl/Cmd + Enter runs on the server, asking which one when none is
  connected, and Shift + Enter runs in the terminal
- Both Run commands are on the editor's right-click menu, and clicking the
  status bar opens a menu of the server commands, with **kdb+/q: Open
  Settings**
- New icons: a rounded q tile in the Marketplace, and a file icon with
  separate light and dark versions, so it stays clear in dark themes

### Fixed

- Dotted names that start with a reserved word, such as `null.x` or
  `select.y`, are highlighted as one name
- Negative times, such as `-12:34:56.789`, are highlighted as one literal
- `'[f;g]` (compose) is no longer highlighted as a signal
- A line after `q)` is read as q reads it, as at column 0: `q)\d .ns` and
  `q)\l a.q` are system commands, `q)/ c` a comment and `q)k)` a k line, in
  highlighting, completion, Go to Definition, the outline, syntax errors
  and Run. A `p)` or other language's line is highlighted as one, not as q
- The `.` in `\d .` is no longer highlighted as an operator
- Lowercase typed nulls and infinities, such as `0nz` and `-0wz` (how q
  prints a datetime infinity), are highlighted as one literal
- Names under a namespace member, such as `.z.ts.x`, are highlighted as one
  name
- In a parameter list, a type or filter after a parameter's colon, as in
  ``{[a:`j;b:f[1]] …}``, and a pattern, as `(a;b)`, are highlighted as
  code, not as more parameters, and comments as comments

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
