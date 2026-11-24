# Navigation and editing

How Ink reads your q code: what navigation follows and what it can't know,
and the rules behind hover, parameter hints, completion, syntax errors and
editing. Back to the [README](../README.md).

## Go to Definition and references

Go to Definition (F12), Find All References, Go to Symbol in Workspace,
Cmd+T (Ctrl+T), the outline and breadcrumbs, and the highlighting of a
name wherever it occurs all follow q's namespaces. They know which names
are local to a lambda. They work across every `.q` file in the workspace,
including q 5 modules (`use` and `export`).

### Definitions and references

- A definition sets the whole value, such as `t:`, `t::`, `` `t set x `` or
  ``@[`t;();:;x]``.
- An amend changes part of the value, so it's a reference, not a
  definition. Examples are `t,:x`, `t[i]:x`, `` `t upsert x `` and
  ``update … from `t``.
- A definition at top level, run as the file loads, comes before one inside
  a lambda. Definitions inside lambdas are used only when no file defines
  the global at top level.

### Passed by reference

A use that names a global with a symbol passes it by reference. Examples
are ``@[value;`.timer.enabled;0b]`` and `` `t insert x ``. Find All
References lists these uses last, under **Passed by reference**. The peek
(Shift+F12) has no groups, so it lists them with the rest.

### Several definitions of one name

A global can be defined more than once, in one file or in several, such as
a setting with its defaults in one file and overrides in another. Go to
Definition then finds every definition. VS Code lists them by file and line
in a peek. The peek opens on the one nearest the cursor, which is in the
current file if that file has one. To jump straight there instead, set
`editor.gotoLocation.multipleDefinitions` to `goto`.

Go to Definition, hover, parameter hints and modules all order files by
how near they are:
1. the current file
2. files in the same directory
3. files that share more of the current file's directories, in order of
   how many they share
4. the rest, by path

Within a file, the latest definition comes first.

### q 5 modules

- ``use`foo`` goes to `foo.q` or `foo/init.q` anywhere in the workspace,
  because Ink doesn't read `QPATH`.
- `s.f`, ``s`f`` and ``s[`f]`` go to `f` in the module bound to `s`, as for
  any global, by ``s:use`foo``. Ink uses the current file's binding if the
  file defines `s`. Otherwise it uses every file that binds `s`, nearest
  first.
- A module is a file that assigns `export`. It runs in `.m.foo` up to its
  first `\d`. Its globals there without a leading dot belong to the module.
  Ink follows them only inside the module, never from another file. Go to
  Symbol in Workspace still lists them, as written in the module.

Edge cases:
- ``s`f`` and ``s[`f]`` also follow a view at top level, ``s::use`foo``, as
  q does. `s.f` doesn't, and neither does q.
- An `export` after a `\d` doesn't make the file a module, because q then
  finds no export.

### `\l` paths

F12 on the path in a `\l` line, such as `\l path/util.q`, goes to every
`.q` file in the workspace whose path ends with `path/util.q`. `\l` loads
from the directory q runs in, which Ink doesn't know.

Edge cases:
- Ink drops `.` anywhere in a path, any number of leading `..`, and empty
  segments, such as the one in `lib//util.q` or a leading `/`. `x/..`
  cancels out. An absolute path therefore matches as a suffix:
  `\l /opt/app/lib/util.q` finds any file ending in `opt/app/lib/util.q`.
- Paths split at `/` only, with no `\` or drive letters, because the q
  process's platform isn't known.
- A `\l` with an indented line after it goes nowhere: q joins that line on
  and loads nothing. The exception is a `\l` line that ends in a comment,
  because q reads a command only up to its first comment.
- A directory, such as a database, isn't followed.

### What Ink can't know

- **The namespace a file is loaded into.** `\l` runs a file in its loader's
  namespace, which the file doesn't say. Ink reads each file as if it were
  loaded in the root namespace.
- **Names built from strings at runtime**, such as `value "f",string x`. q
  can't resolve them until the code runs, so navigation can't either.
- **Names q defines**, such as those in `.z` and `.Q`. Go to Definition has
  nowhere to go, but hover shows KX's reference.
- **Globals defined outside the workspace.** They aren't found.

## Hover

On a q keyword, or a name in `.Q`, `.z`, `.h` or `.j`, hover shows its
syntax and what it does from [KX's reference](https://code.kx.com/q/ref/).
The text comes with Ink, so it works offline, and links to code.kx.com.

On your own global, or a name a module exports, hover shows:
- its signature if it's a function, or else its name
- the comment lines directly above its definition, exactly as written, as
  parameter hints show them
- the file it's defined in, if that's not the current file

The comment is shown only for a definition that starts at column 0, and
only if each comment line starts at column 0 too. An indented comment, such
as one inside a lambda, is about the code around it, so it isn't shown. A
comment at the end of a line could be about either line, so it isn't shown
either.

A global defined more than once shows the latest definition in the nearest
file: what the global holds once that file has loaded. A link opens a peek
of all the definitions, as Go to Definition does. See [Several definitions
of one name](#several-definitions-of-one-name).

A name in a query may be a column or a global. As Go to Definition does,
hover shows the global of that name, if there is one.

## Parameter hints

Typing a call's arguments in brackets, such as `f[a;b]`, shows the
function's signature with the current parameter highlighted.
- A name can have several signatures: q's own forms for it, then each of
  your definitions. Your definitions come nearest file first, and the
  latest first within a file. Press ↑ and ↓ to move between them.
- Cmd+Shift+Space (Ctrl+Shift+Space) shows the hint again.
  `editor.parameterHints.enabled` turns hints off.

Which calls get a hint:
- Only calls written with brackets. A call in prefix or infix notation,
  such as `count x` or `x bin y`, has none.
- q's functions that KX writes only in prefix notation, such as `.Q.s1 x`,
  show in bracket notation: `.Q.s1[x]`.
- Indexing isn't a call. Inside an argument that indexes, such as ``t[`c]``
  in ``f[t[`c];y]``, the hint for `f` stays.
- Inside a lambda argument, such as the one in `f[1;{x+y}]`, only calls in
  the lambda show a hint.
- `select[2]`, a qSQL query's row limit, has no hint. A call inside a query
  has its own.

## Completion

Completion appears in VS Code's suggestions as you type. It offers, in this
order:
1. the innermost lambda's parameters and locals. q has no closures, so an
   outer lambda's aren't in scope.
2. the workspace's globals in the root namespace
3. q's keywords

After `\d .ns`, completion offers `.ns`'s globals and the namespaces in it
by their names there, instead of the root's, as q reads names there. After
`\d .Q`, `\d .h` or `\d .j`, it offers q's own names in that namespace the
same way.

After a dot, completion offers a namespace's members and the namespaces in
it:
- `.` gives the namespaces.
- `.Q.` or `.z.` gives q's own names, each with KX's one-line summary.
- `.ns.` gives your own names, each function with its signature and its
  comment, as hover shows it.
- `s.` gives a module's exports, for `s` bound by ``s:use`mod``, as Go to
  Definition follows it.
- A symbol starting with a dot, such as `` `.ns. ``, offers its members for
  passing by reference. Any other symbol is data, so it offers nothing.

A module's own globals are offered only in the module, and there instead
of the root's.

Picking a suggestion inserts its name. Typing `[` then shows its parameter
hints.

Nothing is offered in:
- strings, comments or numbers
- system commands
- lines q hands to another language, such as `k)`, `p)` or `s)` lines, and
  the indented lines that continue them
- a lambda's parameter list
- anything after a lone `\` that ends the script

For q files, Ink sets `editor.wordBasedSuggestions` to `off`. Otherwise
suggestions would be padded with every word in the open files, comments
included.

## Syntax errors

As you type, the editor underlines brackets and strings that q would
refuse a script for, and lists them in the Problems panel. There are two
kinds:
- **A bracket or string left open.** The error, such as `) expected`, is
  placed where the close was expected. That's at the end of the statement,
  where q's own error points, or at the close that ended it too early, as
  in `{(x+1}`. The error links to where the bracket opened.
- **A closing bracket with no opener**, such as `unmatched ]`.

As in q, a line that starts at column 0 starts a new statement. A lambda
whose closing `}` is at column 0 is therefore an error. The `}` is
unmatched, and the `{` is left open:

```q
f:{[x]
  x+1
}
```

Only files open in the editor's tabs are checked. Set
`kdb-q-ext-vscode.diagnosticMode` to `workspace` to check every `.q` file
in the workspace as well, as saved.

## Editing

- Pressing Enter between brackets keeps the closing bracket indented.
- **kdb+/q: Toggle Block Comment**, Shift+Alt+A, puts the `/` and `\`
  markers on lines of their own at column 0, as q needs.
- Block comments fold.
