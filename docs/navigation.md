# Navigation and editing

How Ink reads your q code: what navigation follows and what it can't know,
and the rules behind hover, parameter hints, syntax errors and completion.
Back to the [README](../README.md).

## Navigation

Navigation follows q's namespaces and knows which names are local to a
lambda: the outline and breadcrumbs, highlighting a name where it occurs,
Go to Definition, Find All References, and **Go to Symbol in Workspace**
(Cmd+T / Ctrl+T) across every `.q` file in the workspace, including
modules' `use` and `export`.

Find All References lists the uses that pass a global by reference, naming
it by a symbol as in ``@[value;`.timer.enabled;0b]`` or `` `t insert x ``,
under **Passed by reference**, after the rest; the peek (Shift+F12) lists
them with the rest, as it has no groups. A definition sets the whole value,
as `t:`, `t::`, `` `t set x `` or ``@[`t;();:;x]`` do; an amend changes it,
as `t,:x`, `t[i]:x`, `` `t upsert x `` or ``update … from `t`` do, so is a
reference.

### What it can't know

- Each file is read as if loaded in the root namespace: `\l` runs a file
  in its loader's namespace, which the file doesn't say
- A global defined more than once, in a file or in several, such as a
  setting with its defaults and overrides, has every definition, which
  VS Code lists by file and line in a peek opened at the one nearest the
  cursor: in the file's own, if it has one. Set
  `editor.gotoLocation.multipleDefinitions` to `goto` to jump there
- ``use`foo`` goes to `foo.q` or `foo/init.q` anywhere in the workspace,
  as `QPATH` isn't read. `s.f`, ``s`f`` and ``s[`f]`` follow the module
  bound to `s`, as any global: by ``s:use`foo`` in the file, if it defines
  `s`, else in every file that binds it, nearest first. ``s`f`` and
  ``s[`f]`` also follow a top-level view ``s::use`foo``, as q does; `s.f`
  doesn't, as q doesn't. A module, a file that assigns `export`, runs in
  `.m.foo` up to its first `\d`. Its globals there without a leading dot
  are its own, followed only in the module, never from another file; Go to
  Symbol in Workspace still lists them, as written in the module. An
  `export` after a `\d` doesn't make the file a module, as q then finds no
  export
- `\l path/util.q` goes to each `.q` file whose path ends with
  `path/util.q`, with the cursor on the path, as `\l` loads from the
  directory q runs in, which isn't known. `.` anywhere, any number of
  leading `..`, and empty segments, as in `lib//util.q` or a leading `/`,
  are dropped, and `x/..` cancels out, so an absolute path matches as a
  suffix: `\l /opt/app/lib/util.q` finds any file ending in
  `opt/app/lib/util.q`. Paths are split at `/` only, with no `\` or drive
  letters, as the q process's platform isn't known. A `\l` with an
  indented line after it goes nowhere, as q joins the line on and loads
  nothing, unless the `\l` line ends in a comment, as q reads a command
  only up to its first comment. A directory, as a database, isn't followed
- Names built from strings at runtime, such as `value "f",string x`: q
  can't resolve them until the code runs, so navigation won't either
- Names q defines (`.z`, `.Q`), and globals defined outside the workspace

## Hover

On a q keyword or a name in `.Q`, `.z`, `.h` or `.j`, hover shows its
syntax and what it does, from [KX's reference](https://code.kx.com/q/ref/),
linked.

On a global, or a name a module exports, defined at the start of a line, it
shows its signature, or its name, then the comment lines directly above it,
exactly as written, as parameter hints show them, and, if it's another, the
file it's in. A comment indented, as in a lambda, is about the code it's
in, and one trailing a line could be about either line, so neither is
shown. A global defined more than once shows the nearest file's latest
definition, what the global holds once that file has loaded, with a link
that peeks at all of them, as Go to Definition does. A name in a query may
be a column or a global, so, as Go to Definition does, it shows the global
of that name, if there is one.

## Parameter hints

Typing a call's arguments in brackets, as `f[a;b]`, shows its signature
with the current parameter highlighted, in VS Code's own widget: each of
q's forms for the name, then each definition's, nearest file first and, in
a file that defines it again, the latest first, ↑ and ↓ to move between
them. Inside an argument that indexes, as ``t[`c]``, the call's own stays;
inside a lambda, as in `f[1;{x+y}]`, only the lambda's own calls show one.
Ctrl+Shift+Space (Cmd+Shift+Space on macOS) shows it again, and
`editor.parameterHints.enabled` turns it off.

q's functions KX writes only in prefix notation, as `.Q.s1 x`, show in
bracket notation, `.Q.s1[x]`; a call written in prefix or infix notation,
as `count x` or `x bin y`, has none, nor has `select[2]`, a qSQL query's
row limit; a call in a query has its own.

## Syntax errors

Syntax errors show as you type, in the Problems panel, for the brackets and
strings q would refuse a script for: one left open, as `) expected` where
its close was expected (at the end of the statement, as q's own error
points, or at the close that ended it, as in `{(x+1}`), linked to where it
opened, and a close with nothing to close, as `unmatched ]`. A line at
column 0 starts a new statement, as in q, so a lambda's closing `}` there
is unmatched, and its `{` left open.

Only files open in the editor's tabs are checked; set
`kdb-q-ext-vscode.diagnosticMode` to `workspace` to check every `.q` file in
the workspace too, as saved.

## Completion

Completion is in VS Code's own suggestions as you type: the innermost
lambda's parameters and locals first (q has no closures, so an outer
lambda's aren't in scope), then the workspace's globals in the root, then
q's keywords. After `\d .ns`, `.ns`'s globals, q's own in `.Q`, `.h` or
`.j`, and its namespaces are offered by their names in it instead of the
root's, as q reads names there.

After a dot, a namespace's members and the namespaces in it: `.` gives the
namespaces, `.Q.` q's own, with KX's line, and `.ns.` your own, with each
function's signature, and its comment as the hover shows it; `s.` a
module's exports, for `s` bound by ``s:use`mod``, as Go to Definition
follows it. A module's own globals are offered only in the module, and
there instead of the root's. A symbol starting with a dot, as `` `.ns. ``,
offers its members for passing by reference; any other symbol is data, so
offers nothing.

Nothing is offered in strings, comments, numbers, system commands or
another language's lines, nor in a lambda's parameter list. Picking one
inserts its name, or replaces the whole name with `editor.suggest.insertMode`
set to `replace`; typing `[` then shows its parameter hints. VS Code's
word-based suggestions, every word in the open files, comments included,
are off for q, as `editor.wordBasedSuggestions` in the `[q]` settings.

## Editing

- Pressing Enter between brackets keeps the closing bracket indented
- **Toggle Block Comment** (Shift+Alt+A) puts the `/` and `\` markers on
  lines of their own at column 0
- Block comments fold
