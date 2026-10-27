// The cells selected in a grid, to copy: a rectangle, from the cell it was
// started from to the one it reaches. Cells are by where they're shown,
// rows and columns counted from the first shown, so it knows nothing of
// sorting, filtering or moving columns, which clear it.

export type Place = { row: number; column: number };

export type Selection = { anchor: Place; end: Place };

// The rows and columns it covers, first to last
export function spans({ anchor, end }: Selection): {
  rows: [number, number];
  columns: [number, number];
} {
  return {
    rows: [Math.min(anchor.row, end.row), Math.max(anchor.row, end.row)],
    columns: [
      Math.min(anchor.column, end.column),
      Math.max(anchor.column, end.column),
    ],
  };
}

export function contains(selection: Selection, { row, column }: Place) {
  const { rows, columns } = spans(selection);
  return (
    row >= rows[0] &&
    row <= rows[1] &&
    column >= columns[0] &&
    column <= columns[1]
  );
}

// The place an arrow key moves to, kept within the last shown
export function moved(
  { row, column }: Place,
  key: string,
  last: Place,
): Place | undefined {
  const within = (n: number, most: number) => Math.max(0, Math.min(n, most));
  switch (key) {
    case "ArrowUp":
      return { row: within(row - 1, last.row), column };
    case "ArrowDown":
      return { row: within(row + 1, last.row), column };
    case "ArrowLeft":
      return { row, column: within(column - 1, last.column) };
    case "ArrowRight":
      return { row, column: within(column + 1, last.column) };
  }
  return undefined;
}

// How many rows or columns a drag beyond the grid's edge scrolls at a
// time: one at the edge, more the further out it's held
export function step(beyond: number): number {
  return 1 + Math.floor(Math.max(0, beyond) / 20);
}
