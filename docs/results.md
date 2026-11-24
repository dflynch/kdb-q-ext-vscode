# Running queries and reading results

What Ink sends, and how the Console, Grid and Chart show what comes back.
Back to the [README](../README.md).

## Running on a server

**kdb+/q: Run File on Server**, also the ▶ in the editor's title bar, sends
the whole file, including edits not yet saved, as one query, exactly as
written, as a q client such as kdb Studio does. Unlike in the terminal, it
isn't read as a script: a server reads line breaks as spaces. With no
connection open, it asks for a server, and with one opening, it waits.

**kdb+/q: Run Selected Text on Server** (Ctrl/Cmd+Enter) sends the
selection, or the current line, the same way. With several selections, only
the primary one is sent, the one made first.

Ink doesn't edit a query: it doesn't wrap it to fetch extra metadata, or
add a row limit to it. With [protected evaluation](../README.md#protected-evaluation)
on, the text is sent beside the function that traps its errors, unchanged;
with it off, a gateway that only allows listed calls sees exactly what you
typed. A result over `sizeLimit` is refused before it's read, and the
connection closed; one of more rows than `rowLimit` is refused once it's
read.

The result shows in the **KDB+/Q** tab of the bottom panel, beside Output and
Terminal, replacing the last. Running a query brings the tab into view and
leaves the cursor in the editor. Switching away and back keeps the result,
its sort, filter and scroll, as it was.

The status bar shows how long the last query took, as `2 ms (3 ms
roundtrip)`: the server's time, as `\t` gives, and the roundtrip. Without
protected evaluation, only the roundtrip is known.

## Console

The Console shows the result as q's console prints it: an assignment shows
nothing, and an error shows as `'type` with its backtrace.

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

## Grid

A table, a keyed table, a dictionary or a list also shows in a grid. The tab
has its views of the result, **Console**, **Grid** and **Chart**, and the
one you chose last is kept for the next result; anything else, an atom, a
string or an error, shows in the Console.

Cells read as q's console shows them in a column: symbols bare, strings in
quotes, nulls blank, and numbers lined up on the right. A dictionary, a
keyed table among them, is its keys, pinned on the left as it scrolls, then
its values, as q's console lays it out: a table's columns, or a list as a
`key` or a `value` column. A list is a `value` column, an item to a row. A
table inside a cell shows as a table symbol and its shape, `3 × 2` for 3
rows of 2 columns, said in words on hover; a keyed table's symbol has its
keys at the left. At the left is each row's index in the result, from 0.

### Sorting and filtering

Click a header to sort, by q's order, with nulls first, or the index's to
put the rows back as they came; tables in cells sort by their shapes, after
any other values.

A column's filter matches the text shown; a column of numbers or times also
compares, as q does: equals, less than, greater than, between and the rest,
with nulls smaller than any value. Numbers and timespans are typed as q
writes them, such as `1.085` or `0D00:00:00.000001500`, and a real as
`1.1e`, as q doesn't count the float `1.1` equal to it. Other times are
picked, to the millisecond, a time of day within a day. Floats, reals and
datetimes are equal within q's tolerance, and the rest exactly, so a
timestamp of `09:30:00.000000001` doesn't equal `09:30` picked. Beside the
tabs is the result's size, such as `312 of 1000000 rows, 5 columns` while
filtered.

### Drilling into a cell

Double-click a cell, or press Enter on it, to see its value as a result of
its own: a table or a list in a cell in the Grid, a long string in full in
the Console. A trail above the tabs, such as `⌂ › [427, 1] › [0, 2]`, says
where it came from: `⌂` is the result, and each step a cell's row and
column, counted from 0, the row its index, however it's sorted or filtered,
and the column as the result has it, keys first. Click a step, or press
Alt+Left, to go back, to find it as you left it.

### Copying

Click a cell, then drag, Shift+click or Shift+arrows for a rectangle,
scrolling as a drag reaches the edge; click a row's index for the row,
Ctrl+Space for a column, Shift+Space for a row, Cmd+A (Ctrl+A) for all.
Cmd+C (Ctrl+C) copies the cells as tab-separated text, the values Export to
CSV writes, and **Copy with Headers** in the grid's menu adds the column
names; neither copies a column of lists or tables.

## Chart

The Chart draws the result as:
- a line, joining its points or as steps, of numeric columns by a time, a
  number or each row's index
- bars side by side for each row, labelled by any columns
- a histogram of a numeric or time column, binned as numpy's `auto` bins,
  in widths that read well, or into as many bins as typed
- a scatter of numeric columns by another, a million points at a time

It opens on bars where the first column is a label, labelled by it or a
keyed table's keys, else a line by the first time or number, of one series.
Its settings, at the right, choose the type and the columns, and its legend
hides and shows a series. Drag across it to zoom, double-click to zoom out.

It draws the whole result, as it came, a line sorted by its x, and says how
many nulls and infinities it left out. A value at the cursor is as the Grid
shows it, numbers on the axes as q writes them, and times as q writes them,
never shifted to the machine's time zone. Times are drawn and binned to the
millisecond, finer digits cut off as q casts, so a timespan under a
millisecond, such as a latency, is drawn as 0, and zoomed no closer than
ten milliseconds. Integers are written as q writes them, and a long past
2^53 is drawn as nearly as a double holds it, as a float is.

## Pinning a result

**kdb+/q: Pin Result**, also the pin in the tab's title bar, opens the
latest result in an editor tab of its own, where the next query doesn't
replace it, in the view it's shown in, on the cell drilled into, with the
trail back, each grid's sort, filter and column order, and each chart's
settings. Above it are the server, the time and the query, all of it on
hovering. Split the editor, or drag the tab to a window of its own, to
compare results side by side. Pinned results close with VS Code.

## Exporting to CSV

**kdb+/q: Export Result to CSV**, also the export button in the tab's title
bar, saves the Grid, of the result or a cell's value drilled into, where you
choose: its rows as shown, sorted and filtered, and its columns in the order
shown, under a line of their names, without the index. It's for the Grid
only: with the Console shown, there's nothing to export.

Values are written as q's `csv 0:` writes them: symbols and strings bare and
whole, nulls blank, dates as `2026-10-26`, timestamps as
`2026-10-26D12:00:00.000000001`, the rest as the Grid shows them. A value
with a comma, a quote or a line break is put in quotes, a quote in it
doubled, as other programs read CSV, where q quotes only for a comma. A
mixed list, such as a column of lists or tables, isn't written, as q won't
write it either and no text would hold it whole: nothing is exported, and
the message names the column. Hide it, or make it a column of strings in q,
to export the rest. A pinned result has its own button, and **kdb+/q:
Export Pinned Result to CSV**.

## Precision

`precision` works as q's `\P`: from 1 to 17 significant digits, or 0 for as
many as each type holds, 17 for a float and 8 for a real. It applies wherever
a result's floats and reals are written: the Console, the Grid, Copy, Export
to CSV and the Chart's values at the cursor. Like `\P`, it applies from the
next run; a result already shown, or pinned, stays as it was.

## Limits and memory

A result over `sizeLimit` is refused before it's read, and the connection
closed. The extension holds the latest result as it arrived, and decodes it
in the **KDB+/Q** tab, and in each pinned result's tab, which have about 4 GB
of memory.
The Grid takes about 250 bytes a row, whatever the columns, and a mixed
list's items up to about 200 bytes more each, so a result, or a cell's value
drilled into, of more rows than `rowLimit` is refused; like `precision`, it
applies from the next run.

A tab that runs out of memory, or crashes, turns grey, while VS Code and
other extensions carry on. VS Code doesn't tell extensions when that
happens, or let them restart it: **Developer: Reload Window** brings it
back, but loses the latest result and closes pinned results. A pinned
result whose tab has turned grey can only be closed. Pinned results share
one process, so when one turns grey, so do the rest.

## Running in a terminal

**kdb+/q: Run Selected Text in Terminal** (Shift+Enter) runs the selection,
or the current line, in the active terminal, such as a q session, as a
script. It writes the text as it is to a file in the temp folder, and sends
`\l` with the file's path, so q reads it as it reads any script: an
indented line continues the statement before, comments are skipped, and a
`\d` lasts to the end. A run stops at the first error. Several selections
make one script, from the top of the file.

q must be able to read the file, so a q on another machine, such as one
over ssh, can't load it. The files are removed when the window closes.
