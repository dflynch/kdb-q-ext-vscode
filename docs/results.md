# Running queries and reading results

What Ink sends, and how the Console, Grid and Chart show what comes back.
Back to the [README](../README.md).

## Running on a server

**kdb+/q: Run Selected Text on Server**, Cmd+Enter (Ctrl+Enter), sends the
selection, or the current line. **kdb+/q: Run File on Server**, the ▶ in
the editor's title bar, sends the whole file, including edits not yet
saved.

- The text is sent as one query, exactly as written, as a q client sends
  it.
- It isn't read as a script, as it is in the terminal. A server reads line
  breaks as spaces, so statements on separate lines need `;` between them.
  To run lines as a script, see
  [Running in a terminal](#running-in-a-terminal).
- With several selections, only the primary one is sent: the one made
  first.
- If no connection is open, the run asks which server to use. If a
  connection is still opening, the run waits for it.

Ink doesn't change your query. It doesn't wrap it to fetch extra metadata,
or add a row limit to it.

- With [protected evaluation](../README.md#protected-evaluation) on, the
  text is sent unchanged, beside the function that traps its errors.
- With it off, a gateway that allows only listed calls sees exactly what
  you typed.

Large results are refused. See [Limits and memory](#limits-and-memory).

## Running in a terminal

**kdb+/q: Run Selected Text in Terminal**, Shift+Enter, runs the selection,
or the current line, as a script in the active terminal, such as a q
session. Ink writes the text as it is to a file in the temp folder and
sends `\l` with the file's path. q reads the file as it reads any script:

- An indented line continues the statement before it.
- Comments are skipped.
- A `\d` lasts to the end of the script.
- The run stops at the first error.

Unlike a run on a server, several selections are all sent. They make one
script, in order from the top of the file.

As in any script, a result prints on one line, in the form `-3!` writes,
cut at the console's width. `show` prints it as the console does.

q must be able to read the file, so a q session on another machine, such
as one over ssh, can't load it. The files are removed when the window
closes.

## Timing

The status bar shows how long the last query took, such as `2 ms (3 ms
roundtrip)`. The first number is the time on the server, as `\t` gives it.
The second is the roundtrip. Without [protected
evaluation](../README.md#protected-evaluation), only the roundtrip is
known.

## The KDB+/Q panel

The result shows in the **KDB+/Q** panel, at the bottom beside Output and
Terminal, and replaces the last result. Running a query brings the panel
into view and leaves the cursor in the editor. Switching away and back
keeps the result as it was, with its sort, filters and scroll.

The panel has three tabs: **Console**, **Grid** and **Chart**. The one you
chose last is kept for the next result.

- A table, a keyed table, a dictionary or a list shows in all three.
- Anything else, such as an atom, a string or an error, shows in the
  Console only.

## Console

The Console shows the result as q's console prints it. An assignment shows
nothing. An error shows as q's error, such as `'type`, with its backtrace
when protected evaluation is on.

The Console is larger than q's default console of `\c 25 80`. It shows
1000 lines of 1000 characters by default, set by `consoleSize` in the form
`\c` takes. Where the text is cut, it shows `..`, as q does. Nulls are left
blank, as q leaves them.

### Where the Console differs from q

- A cell in a table, a matrix or a dictionary is cut at 256 characters, so
  that one long value doesn't widen every line of its column.
- A table or matrix wider than the console ends in `..`. q drops the
  columns without saying so.
- A keyed table, or any dictionary whose keys are a table, is cut at the
  line limit. q counts its entries instead, and can run two lines over.
- About 1 in 50,000 datetimes shows a millisecond less than q does.

## Grid

Cells read as q's console shows them in a column: symbols bare, strings in
quotes, nulls blank, and numbers lined up on the right.

- At the left is each row's index in the result, counted from 0.
- A dictionary, including a keyed table, shows its keys on the left, pinned
  as you scroll, then its values, as q's console lays it out. A key or value
  that's a table shows as its columns. A list shows as one column, named
  `key` or `value`.
- A list on its own is a `value` column, one item to a row.
- A table inside a cell shows as a table symbol and its shape, such as
  `3 × 2` for 3 rows of 2 columns. Hover over it to see the shape in words.
  A keyed table's symbol has its keys at the left.

Beside the tabs is the result's size, such as `312 of 1000000 rows,
5 columns` while it's filtered.

### Sorting

Click a header to sort by that column, in q's order, with nulls first.
Click again to reverse the sort, and a third time to clear it. Click the
index's header to put the rows back in the order they came.

Tables in cells sort by their shapes, after any other values.

### Filtering

Click the funnel in a column's header to filter it. Empty the filter's box
to clear it.

- Every column's filter can match the text shown.
- A column of numbers or times can also compare, as q does. The
  comparisons are equals, less than, greater than, between and the rest.
  Nulls are smaller than any value.

How you give a value:

- Type numbers and timespans as q writes them, such as `1.085` or
  `0D00:00:00.000001500`.
- Type a real with its suffix, such as `1.1e`. q doesn't count the float
  `1.1` equal to the real `1.1e`.
- Pick other times with a picker: a month, a date, a date and time, or a
  time of day, as fine as the column's type holds, down to the millisecond.
- A value that can't be read matches no rows.

How values compare:

- Floats, reals and datetimes are equal within q's tolerance.
- Everything else must be equal exactly. A timestamp of
  `09:30:00.000000001` doesn't equal `09:30` picked in the filter.

### Drilling into a cell

Double-click a cell, or press Enter on it, to see its value as a result of
its own. A table or a list in a cell shows in the Grid. A long string shows
in full in the Console.

A trail above the tabs, such as `⌂ › [427, 1] › [0, 2]`, says where the
value came from. `⌂` is the result. Each step gives a cell's row and
column, counted from 0:

- The row is the row's index in the result, however the Grid is sorted or
  filtered.
- The column counts as the result has its columns, keys first.

Click a step, or press Alt+Left, to go back. The Grid is as you left it.

### Copying

Select cells:

- Click a cell, then drag, Shift+click or press Shift+arrows for a
  rectangle.
- Click a row's index for the row.
- Ctrl+Space selects a column, Shift+Space a row, and Cmd+A (Ctrl+A)
  everything.

Cmd+C (Ctrl+C) copies the cells as tab-separated text, with the values that
Export to CSV writes. **Copy with Headers**, on the Grid's right-click menu,
adds the column names.

Neither copies a column of lists or tables. If the selection includes one,
nothing is copied, and a message names the column.

## Chart

The Chart draws the result as one of:

- **a line** of numeric columns against a time, a number or each row's
  index. It joins the points, or draws them as steps.
- **bars**, side by side for each row, labelled by any columns.
- **a histogram** of a numeric or time column. Ink picks the bin width from
  the values, or uses as many bins as you type.
- **a scatter** of numeric columns against another numeric column. Every
  point is drawn, and a million points draw as fast as the pixels they
  cover.

A result with no numbers or times has no chart.

The Chart picks how it opens:

- **Bars**, if the first column is neither a number nor a time, such as a
  symbol, string or boolean column. The bars are labelled by that column,
  or by a keyed table's keys.
- **A histogram** of the first time column, if there are times but no
  numbers.
- **A line** otherwise, of one series: the first number column that isn't
  the x. The x is the first time column, else the first number column, else
  each row's index.

The gear at the right shows and hides the Chart's settings, which choose
the type and the columns. The legend hides and shows a series. Drag across
the Chart to zoom, and double-click to zoom out.

### How the Chart draws values

- It draws the whole result, as it came. A line is sorted by its x.
- It says how many nulls and infinities it left out.
- A value at the cursor reads as the Grid shows it.
- Numbers on the axes are written as q writes them.
- Times are written as q writes them, and never shifted to the machine's
  time zone.
- Times are drawn and binned to the millisecond. Finer digits are cut off,
  as a q cast cuts them. A timespan under a millisecond, such as a latency,
  is therefore drawn as 0, and the Chart zooms no closer than ten
  milliseconds.
- Integers are written as q writes them. A long past 2^53 is drawn as
  nearly as a double holds it, as a float is.

### Histogram bins

Unless you type a number of bins, Ink works out a bin width from the
values. It takes the narrower of two standard rules:

- the spread of the values divided by one more than log₂ of their count,
  which suits few values
- twice the interquartile range divided by the cube root of their count,
  which suits many values

The width is then rounded up to one that reads well, such as 0.5 rather
than 0.48. Bins start at a whole number of widths, such as 1.5 rather than
1.53. Bins of times use clock steps, such as 1, 5 or 15 minutes. A
histogram has at most 10,000 bins.

## Pinning a result

**kdb+/q: Pin Result**, the pin in the panel's title bar, opens the latest
result in an editor tab of its own. The next query doesn't replace it.

The pinned result keeps:

- the Console, Grid or Chart tab it's shown in
- the cell drilled into, with the trail back
- each Grid's sort, filters and column order
- each Chart's settings

Above it are the server, the time the result arrived and the query. Hover
over the query to see all of it.

Pinned results close with VS Code. They aren't kept for the next session.

## Exporting to CSV

**kdb+/q: Export Result to CSV**, the export button in the panel's title
bar, saves the Grid to a file you choose. If you've drilled into a cell,
it saves that value's Grid.

- The rows are as shown, sorted and filtered.
- The columns are in the order shown, under a line of their names, without
  the index.
- It exports only from the Grid. With the Console or the Chart shown,
  there's nothing to export.

A pinned result has its own export button, and **kdb+/q: Export Pinned
Result to CSV**.

Values are written as q's `csv 0:` writes them:

- symbols and strings bare and whole
- nulls blank
- dates such as `2026-10-26`, and timestamps such as
  `2026-10-26D12:00:00.000000001`
- the rest as the Grid shows them

A value with a comma, a quote or a line break is put in quotes, with any
quote in it doubled, as other programs read CSV. q quotes only for a comma.

A mixed list, such as a column of lists or tables, isn't written. q won't
write one either, and no text would hold it whole. Nothing is exported, and
the message names the column. To export the rest, make it a column of
strings in q.

## Precision

`precision` works as q's `\P`. It's 1 to 17 significant digits, or 0 for
as many as each type holds: 17 for a float and 8 for a real.

It applies wherever a result's floats and reals are written: the Console,
the Grid, Copy, Export to CSV and the Chart's values at the cursor.

Like `\P`, it applies from the next run. A result already shown, or
pinned, stays as it was.

## Limits and memory

Two settings keep a result within the memory that shows it:

- **`sizeLimit`**, 100 MB by default: a result larger than this, as q sends
  it, is refused before it's read, and the connection is closed. It applies
  from the next connect.
- **`rowLimit`**, 5,000,000 by default: a result, or a cell's value drilled
  into, with more rows than this is refused. Like `precision`, it applies
  from the next run.

Why there are limits:

- The extension holds the latest result as it arrived. The **KDB+/Q** panel
  decodes it, and so does each pinned result's tab.
- The panel has about 4 GB of memory. Pinned results share one process, and
  its memory, between them.
- The Grid takes about 250 bytes a row, whatever the columns. A mixed
  list's items take up to about 200 bytes more each.

If the panel or a pinned result runs out of memory, or crashes, it turns
grey. VS Code and other extensions carry on.

- **Developer: Reload Window** brings it back, but loses the latest result
  and closes pinned results. Ink can't restart it itself, because VS Code
  doesn't tell extensions when this happens.
- A pinned result that has turned grey can only be closed.
- Pinned results share one process, so when one turns grey, so do the rest.
