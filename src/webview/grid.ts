import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnApiModule,
  ColumnAutoSizeModule,
  CustomFilterModule,
  createGrid,
  type GridApi,
  type GridState,
  GridStateModule,
  type IDoesFilterPassParams,
  type IFilterComp,
  type IFilterParams,
  ModuleRegistry,
  RenderApiModule,
  RowApiModule,
  ScrollApiModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import type { Arrangement, Step } from "../messages";
import {
  type Comparison,
  type Condition,
  comparable,
  comparisons,
  field,
  passing,
} from "./filter";
import {
  contains,
  moved,
  type Place,
  type Selection,
  spans,
  step,
} from "./selection";
import { type Column, type Sheet, said } from "./table";

// The Grid view: a sheet in ag-grid. Only this file knows ag-grid.

ModuleRegistry.registerModules([
  // For right-aligned cells
  CellStyleModule,
  ClientSideRowModelModule,
  // For the rows and columns as shown, to export
  ClientSideRowModelApiModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  // For a column of numbers or times, compared as q compares them
  CustomFilterModule,
  // For how the grid is arranged, for a kept tab or a remade view
  GridStateModule,
  // For showing which cells are selected
  RenderApiModule,
  // For how many rows are shown, and finding a row by its index in the result
  // or by where it's shown
  RowApiModule,
  // For bringing a cell into sight to focus it
  ScrollApiModule,
  TextFilterModule,
]);

// Colours and fonts from VS Code's own variables, as the rest of the view's,
// so every theme, high contrast included, styles the grid
const theme = themeQuartz.withParams({
  backgroundColor: "var(--vscode-panel-background)",
  foregroundColor: "var(--vscode-foreground)",
  textColor: "var(--vscode-foreground)",
  accentColor: "var(--vscode-focusBorder)",
  borderColor: "var(--vscode-panel-border, transparent)",
  chromeBackgroundColor: "var(--vscode-panel-background)",
  headerBackgroundColor: "var(--vscode-panel-background)",
  headerTextColor: "var(--vscode-foreground)",
  rowHoverColor: "var(--vscode-list-hoverBackground)",
  oddRowBackgroundColor: "var(--vscode-panel-background)",
  selectedRowBackgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
  menuBackgroundColor: "var(--vscode-menu-background)",
  menuTextColor: "var(--vscode-menu-foreground)",
  inputBackgroundColor: "var(--vscode-input-background)",
  inputTextColor: "var(--vscode-input-foreground)",
  inputBorder: { color: "var(--vscode-input-border, transparent)" },
  fontFamily: "var(--vscode-font-family)",
  fontSize: "var(--vscode-font-size)",
  cellFontFamily: "var(--vscode-editor-font-family)",
  cellFontSize: "var(--vscode-editor-font-size)",
  // Dense, as results are read a row to a line
  spacing: 4,
  rowVerticalPaddingScale: 0.5,
  headerVerticalPaddingScale: 0.6,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  borderRadius: 0,
});

// Short, int, long, real and float
const numbers = [5, 6, 7, 8, 9];

// What of the grid's state is its arrangement, carried to a kept tab: not
// its widths, fitted anew, its scroll or focus, nor its hidden columns, as
// one hidden by mistake has no way back but running the query again
const arrangement = ["sort", "filter", "columnOrder"] as const;

// A row is its index in the result: the sheet reads the cells
type Row = { row: number };

// Shows a sheet in a place: a level's, the result or a value drilled into
export class Grid {
  private api?: GridApi<Row>;
  // Whether its rows are drawn, and so can take the focus; if not, the focus
  // to take once they are, as focus() was asked: none pending, or a cell or
  // the first
  private rendered = false;
  private focusWhenRendered?: { cell?: Step };
  // The cells selected, to copy, where more than the focused cell; and the
  // columns shown, by their ids, the index's apart, which its places count
  private selection?: Selection;
  private order: string[] = [];
  // The cell focused last, to tell a move from the same cell focused again
  private focusedAt?: Place;
  // A drag selecting cells: where the pointer is, and the next step while
  // it's held beyond the grid's edge, scrolling
  private drag?: { x: number; y: number; timer?: number };

  constructor(
    private readonly place: HTMLElement,
    // For ag-grid's styles, which the page's security policy allows by it
    private readonly nonce: string,
    // Told how many rows are shown, after each filter
    private readonly shown: (rows: number) => void,
    // Told of a cell double-clicked, or Enter pressed on, to drill into: its
    // row in the result, and its column in the sheet
    private readonly drill: (row: number, column: number) => void,
    // Told how the grid is arranged, each time its sort, filter or columns
    // change
    private readonly arranged: (arrangement: Arrangement["grid"]) => void,
  ) {
    // Caught on their way down, before ag-grid, which would take a press
    // as focusing a cell, and a key as moving the focus
    place.addEventListener("pointerdown", (event) => this.pressed(event), {
      capture: true,
    });
    place.addEventListener("keydown", (event) => this.keyed(event), {
      capture: true,
    });
  }

  // Show a sheet, arranged as it was, should it have been: sorted,
  // filtered, its columns moved
  show(sheet: Sheet, arranged: Arrangement["grid"] = {}) {
    // Each row's index in the result, at the left as a spreadsheet's row
    // headers: not a column of the sheet, so not a cell to drill into
    const index: ColDef<Row, number> = {
      colId: "index",
      headerName: "",
      pinned: "left",
      lockPosition: "left",
      suppressMovable: true,
      suppressNavigable: true,
      cellClass: ["index", "ag-right-aligned-cell"],
      valueGetter: ({ data }) => data?.row,
      comparator: (a, b) => (a ?? 0) - (b ?? 0),
    };
    const columnDefs = sheet.columns.map(
      (column, j): ColDef<Row, number> => ({
        colId: String(j),
        headerName: column.name,
        pinned: j < sheet.keys ? "left" : undefined,
        // Numbers line up by their digits, under a header like any other:
        // the cell half of ag-grid's rightAligned type
        cellClass: numbers.includes(column.type)
          ? "ag-right-aligned-cell"
          : undefined,
        valueGetter: ({ data }) => data?.row,
        valueFormatter: ({ value }) =>
          value === null || value === undefined ? "" : column.text(value),
        cellRenderer: column.shape && symbol(column),
        cellClassRules: {
          selected: ({ node, column }) =>
            this.isSelected(node.rowIndex, column.getColId()),
        },
        comparator: (a, b) => column.compare(a ?? 0, b ?? 0),
        ...(comparable(column.type)
          ? { filter: Comparing, filterParams: { sheetColumn: column } }
          : {
              filter: "agTextColumnFilter",
              filterValueGetter: ({ data }) =>
                data ? column.text(data.row) : "",
            }),
      }),
    );
    this.api = createGrid<Row>(this.place, {
      theme,
      styleNonce: this.nonce,
      columnDefs: [index, ...columnDefs],
      rowData: Array.from({ length: sheet.rows }, (_, row) => ({ row })),
      getRowId: ({ data }) => String(data.row),
      autoSizeStrategy: { type: "fitCellContents" },
      initialState: arranged as GridState,
      onStateUpdated: ({ sources, state }) => {
        if (arrangement.some((part) => sources.includes(part))) {
          this.arranged(
            Object.fromEntries(
              arrangement.flatMap((part) =>
                state[part] ? [[part, state[part]]] : [],
              ),
            ),
          );
        }
      },
      onModelUpdated: ({ api }) => this.shown(api.getDisplayedRowCount()),
      // Sorting, filtering or moving a column clears the selection, which
      // would otherwise be of other cells
      onSortChanged: () => this.select(undefined),
      onFilterChanged: () => this.select(undefined),
      onDisplayedColumnsChanged: ({ api }) => {
        this.order = api
          .getAllDisplayedColumns()
          .map((column) => column.getColId())
          .filter((id) => id !== "index");
        this.select(undefined);
      },
      // Moving the focus to another cell, by a click or a key, selects it
      // alone. The same cell again, as the page's focus follows ag-grid's,
      // keeps the selection.
      onCellFocused: () => {
        const focused = this.focused();
        const was = this.focusedAt;
        this.focusedAt = focused;
        if (focused?.row !== was?.row || focused?.column !== was?.column) {
          this.select(undefined);
        }
      },
      onFirstDataRendered: () => {
        this.rendered = true;
        if (this.focusWhenRendered) {
          this.focus(this.focusWhenRendered.cell);
          this.focusWhenRendered = undefined;
        }
      },
      onCellDoubleClicked: ({ data, column }) => {
        if (data && column.getColId() !== "index") {
          this.drill(data.row, Number(column.getColId()));
        }
      },
      onCellKeyDown: (cell) => {
        const { data, event } = cell;
        if (
          "column" in cell &&
          cell.column.getColId() !== "index" &&
          data &&
          event instanceof KeyboardEvent &&
          event.key === "Enter"
        ) {
          this.drill(data.row, Number(cell.column.getColId()));
        }
      },
    });
  }

  // Focus a cell, by its row in the result and its column, brought into
  // sight wherever sorting has put it; or, with none, the first cell shown.
  // So the keys work on coming to the grid. A cell drilled from may be
  // filtered out, by a filter typed half a second or less before drilling,
  // which ag-grid applies after its pause, while the grid is hidden; and a
  // kept tab keeps that filter. Then nothing is focused.
  focus(cell?: Step) {
    if (!this.rendered) {
      this.focusWhenRendered = { cell };
      return;
    }
    // Once its cells are in the page
    requestAnimationFrame(() => {
      const api = this.api;
      if (!api) {
        return;
      }
      if (!cell) {
        api.setFocusedCell(0, "0");
        return;
      }
      const index = api.getRowNode(String(cell[0]))?.rowIndex;
      if (typeof index !== "number") {
        return;
      }
      api.ensureIndexVisible(index);
      api.setFocusedCell(index, String(cell[1]));
    });
  }

  // The rows shown, by their index in the result, and the columns, by their
  // place in the sheet, in the order shown: sorted, filtered and moved. None
  // until the grid is drawn.
  shownOrder(): { rows: number[]; columns: number[] } | undefined {
    const api = this.api;
    if (!api) {
      return undefined;
    }
    const rows: number[] = [];
    api.forEachNodeAfterFilterAndSort(({ data }) => {
      if (data) {
        rows.push(data.row);
      }
    });
    const columns = api
      .getAllDisplayedColumns()
      .map((column) => column.getColId())
      .filter((id) => id !== "index")
      .map(Number);
    return { rows, columns };
  }

  // The cells selected, or the focused cell: their rows, by their index in
  // the result, and columns, by their place in the sheet, in the order
  // shown. None with no cell focused, or none of its rows shown, as when
  // filtered to none.
  selected(): { rows: number[]; columns: number[] } | undefined {
    const api = this.api;
    const focused = this.focused();
    const selection =
      this.selection ?? (focused && { anchor: focused, end: focused });
    if (!api || !selection) {
      return undefined;
    }
    const { rows, columns } = spans(selection);
    const indexes: number[] = [];
    for (let i = rows[0]; i <= rows[1]; i++) {
      const row = api.getDisplayedRowAtIndex(i)?.data?.row;
      if (row !== undefined) {
        indexes.push(row);
      }
    }
    return indexes.length
      ? {
          rows: indexes,
          columns: this.order.slice(columns[0], columns[1] + 1).map(Number),
        }
      : undefined;
  }

  clear() {
    this.stopDragging();
    this.api?.destroy();
    this.api = undefined;
  }

  // The focused cell's place, if a cell of the sheet is focused
  private focused(): Place | undefined {
    const cell = this.api?.getFocusedCell();
    const column = cell ? this.order.indexOf(cell.column.getColId()) : -1;
    return cell && column >= 0 && !cell.rowPinned
      ? { row: cell.rowIndex, column }
      : undefined;
  }

  // Focus a cell while selecting, which ag-grid says it has after the
  // selection is made: as the cell focused last, so the selection is kept
  private focusOn(place: Place) {
    this.focusedAt = place;
    this.api?.setFocusedCell(place.row, this.order[place.column]);
  }

  // The last row and column shown
  private last(): Place {
    return {
      row: (this.api?.getDisplayedRowCount() ?? 0) - 1,
      column: this.order.length - 1,
    };
  }

  private isSelected(row: number | null, id: string): boolean {
    return (
      this.selection !== undefined &&
      row !== null &&
      contains(this.selection, { row, column: this.order.indexOf(id) })
    );
  }

  // Select cells, or none but the focused cell, and show which
  private select(selection: Selection | undefined) {
    if (!this.selection && !selection) {
      return;
    }
    this.selection = selection;
    this.api?.refreshCells();
  }

  // Select from where the selection was started, or the focused cell, to
  // a place, brought into sight
  private reach(end: Place) {
    const anchor = this.selection?.anchor ?? this.focused();
    if (!anchor || !this.api) {
      return;
    }
    this.select({ anchor, end });
    this.api.ensureIndexVisible(end.row);
    this.api.ensureColumnVisible(this.order[end.column]);
  }

  // A cell's place, from an element in it; the index's, as column -1
  private placeOf(target: EventTarget | null): Place | undefined {
    if (!(target instanceof Element)) {
      return undefined;
    }
    const cell = target.closest(".ag-cell");
    const row = cell?.closest(".ag-row")?.getAttribute("row-index");
    const id = cell?.getAttribute("col-id");
    if (!row || !id || !/^\d+$/.test(row)) {
      return undefined;
    }
    return { row: Number(row), column: this.order.indexOf(id) };
  }

  // A press on a cell: on a row's index, selecting the row, from the row
  // the selection was started from with Shift; on another, with Shift,
  // selecting from the focused cell to it, the focus left where it is; or,
  // without, or with no cell focused, selecting it alone, and starting a
  // drag. A right-click in the
  // selection keeps it, to copy.
  private pressed(event: PointerEvent) {
    const place = this.placeOf(event.target);
    const api = this.api;
    if (!place || !api || !this.order.length) {
      return;
    }
    // Kept from ag-grid, and, as no mousedown follows, from moving the
    // page's focus
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.button === 2) {
      if (this.isSelected(place.row, this.order[place.column] ?? "")) {
        handled();
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (place.column < 0) {
      handled();
      const from = event.shiftKey
        ? (this.selection?.anchor.row ?? this.focused()?.row ?? place.row)
        : place.row;
      // A cell of the row in sight takes the focus, the page's too, for
      // the keys and Copy, the grid scrolled no further
      const inSight = api
        .getAllDisplayedVirtualColumns()
        .map((column) => column.getColId())
        .find((id) => id !== "index");
      this.focusOn({
        row: from,
        column: Math.max(0, this.order.indexOf(inSight ?? "")),
      });
      this.select({
        anchor: { row: from, column: 0 },
        end: { row: place.row, column: this.order.length - 1 },
      });
      return;
    }
    const anchor = this.selection?.anchor ?? this.focused();
    if (event.shiftKey && anchor) {
      handled();
      // Back to the cell it's selected from, should the focus be elsewhere
      this.focusOn(anchor);
      this.reach(place);
      return;
    }
    // Even on the cell it was started from, where the focus doesn't move
    this.select(undefined);
    this.stopDragging();
    this.drag = { x: event.clientX, y: event.clientY };
    window.addEventListener("mousemove", this.dragged);
    window.addEventListener("mouseup", this.dropped);
  }

  private readonly dragged = (event: MouseEvent) => {
    // A release outside the page isn't seen: the button no longer held is
    if (!(event.buttons & 1) || !this.drag) {
      this.stopDragging();
      return;
    }
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.dragTo();
  };

  private readonly dropped = () => this.stopDragging();

  private stopDragging() {
    clearTimeout(this.drag?.timer);
    this.drag = undefined;
    window.removeEventListener("mousemove", this.dragged);
    window.removeEventListener("mouseup", this.dropped);
  }

  // Select from the cell pressed on to the cell under the pointer, or,
  // held beyond the grid's edge, or near it, past the last cell in sight,
  // a step at a time, scrolling, faster the further out
  private dragTo() {
    const drag = this.drag;
    const viewport = this.place.querySelector(".ag-grid-viewport");
    const rows = this.place.querySelector(".ag-grid-scrolling-rows");
    const anchor = this.selection?.anchor ?? this.focused();
    if (!drag || !viewport || !rows || !anchor) {
      return;
    }
    clearTimeout(drag.timer);
    // The rows in sight, below the header, the pinned columns among them
    const shown = viewport.getBoundingClientRect();
    const all = rows.getBoundingClientRect();
    const edge = {
      top: Math.max(shown.top, all.top),
      bottom: Math.min(shown.bottom, all.bottom),
      left: shown.left,
      right: shown.right,
    };
    // Near enough to the edge to scroll, though within it, as a pointer
    // past the page's edge may go unseen
    const near = 8;
    const within = (n: number, low: number, high: number) =>
      Math.max(low + near, Math.min(n, high - near));
    const under = this.placeOf(
      document.elementFromPoint(
        within(drag.x, edge.left, edge.right),
        within(drag.y, edge.top, edge.bottom),
      ),
    );
    const end = this.selection?.end ?? anchor;
    const last = this.last();
    let row = under?.row ?? end.row;
    let column = under && under.column >= 0 ? under.column : end.column;
    const above = edge.top + near - drag.y;
    const below = drag.y - (edge.bottom - near);
    const before = edge.left + near - drag.x;
    const after = drag.x - (edge.right - near);
    if (above > 0) {
      row = Math.max(0, end.row - step(above));
    } else if (below > 0) {
      row = Math.min(last.row, end.row + step(below));
    }
    if (before > 0) {
      column = Math.max(0, end.column - step(before));
    } else if (after > 0) {
      column = Math.min(last.column, end.column + step(after));
    }
    if (row !== end.row || column !== end.column) {
      this.reach({ row, column });
    }
    if (Math.max(above, below, before, after) > 0) {
      drag.timer = setTimeout(() => this.dragTo(), 50);
    }
  }

  // Keys that select, as a spreadsheet's: Shift and an arrow to extend the
  // selection; Cmd+A, Ctrl+A elsewhere, for every cell; Ctrl+Space for the
  // focused cell's column, Shift+Space for its row. Only on a cell: a
  // header has keys of its own, and a filter is typed in.
  private keyed(event: KeyboardEvent) {
    const focused = this.focused();
    if (!onCell(event.target) || !focused || event.altKey) {
      return;
    }
    const mac = navigator.userAgent.includes("Mac");
    const command = mac ? event.metaKey : event.ctrlKey;
    const last = this.last();
    let selection: Selection | undefined;
    if (command && !event.shiftKey && event.key.toLowerCase() === "a") {
      selection = { anchor: { row: 0, column: 0 }, end: last };
    } else if (event.key === " " && event.ctrlKey && !event.shiftKey) {
      selection = {
        anchor: { row: 0, column: focused.column },
        end: { row: last.row, column: focused.column },
      };
    } else if (event.key === " " && event.shiftKey && !command) {
      selection = {
        anchor: { row: focused.row, column: 0 },
        end: { row: focused.row, column: last.column },
      };
    } else if (event.shiftKey && !event.metaKey && !event.ctrlKey) {
      const end = moved(this.selection?.end ?? focused, event.key, last);
      if (end) {
        event.preventDefault();
        event.stopPropagation();
        this.reach(end);
      }
      return;
    }
    if (selection) {
      event.preventDefault();
      event.stopPropagation();
      this.select(selection);
    }
  }
}

// The filter of a column of numbers or times, as ag-grid takes one: a
// comparison, and a value typed or picked, or two for a range. Applied at
// once on Enter, else half a second after the last change, as ag-grid's
// text filter is, so typing doesn't filter at every key.
class Comparing implements IFilterComp<Row> {
  private readonly gui = document.createElement("div");
  private readonly choice = document.createElement("select");
  private readonly values = document.createElement("div");
  private column!: Column;
  // What's applied, none when it filters nothing, and the rows it passes
  private condition: Condition | null = null;
  private test?: (row: number) => boolean;
  private timer?: number;

  init(params: IFilterParams<Row> & { sheetColumn: Column }) {
    this.column = params.sheetColumn;
    this.gui.className = "comparison";
    this.gui.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.applyNow(params);
      }
    });
    this.choice.ariaLabel = "Filtering option";
    for (const [type, label] of comparisons) {
      this.choice.append(new Option(label, type));
    }
    this.choice.addEventListener("change", () => {
      this.fields();
      this.edited(params);
    });
    this.values.addEventListener("input", () => this.edited(params));
    this.gui.append(this.choice, this.values);
    this.fields();
  }

  getGui() {
    return this.gui;
  }

  afterGuiAttached() {
    this.inputs()[0]?.focus();
  }

  isFilterActive() {
    return this.test !== undefined;
  }

  doesFilterPass({ data }: IDoesFilterPassParams<Row>) {
    return this.test?.(data.row) ?? true;
  }

  getModel(): Condition | null {
    return this.condition;
  }

  setModel(model: Condition | null) {
    clearTimeout(this.timer);
    const known = comparisons.some(([type]) => type === model?.type);
    this.choice.value = known && model ? model.type : "equals";
    this.fields();
    const [from, to] = this.inputs();
    from.value = (known && model?.filter) || "";
    if (to) {
      to.value = (known && model?.filterTo) || "";
    }
    this.take();
  }

  destroy() {
    clearTimeout(this.timer);
  }

  // An input for each value the comparison takes, as the column's values
  // are given, but typed for Contains; keeping what's there where it's the
  // same kind of value
  private fields() {
    const range = this.choice.value === "inRange";
    const was = this.inputs();
    const given =
      this.choice.value === "contains"
        ? { type: "text" }
        : field(this.column.type);
    const inputs = (range ? ["From", "To"] : ["Filter value"]).map(
      (label, i) => {
        const input = document.createElement("input");
        input.type = given.type;
        if (given.step) {
          input.step = given.step;
        }
        input.ariaLabel = label;
        input.placeholder = range ? label : "Filter…";
        if (was[0]?.type === given.type) {
          input.value = was[i]?.value ?? "";
        }
        return input;
      },
    );
    this.values.replaceChildren(...inputs);
  }

  private inputs(): HTMLInputElement[] {
    return [...this.values.querySelectorAll("input")];
  }

  private edited(params: IFilterParams<Row>) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.applyNow(params), 500);
  }

  private applyNow(params: IFilterParams<Row>) {
    clearTimeout(this.timer);
    this.take();
    params.filterChangedCallback();
  }

  // Takes what's typed or picked as what's applied
  private take() {
    const [from, to] = this.inputs().map((input) => input.value);
    const condition: Condition = {
      type: this.choice.value as Comparison,
      filter: from,
      ...(to === undefined ? {} : { filterTo: to }),
    };
    this.test = passing(this.column, condition);
    this.condition = this.test ? condition : null;
  }
}

// Whether the page's focus, or an event, is on a cell of a grid, not its
// headers or a filter, for the keys that select and copy
export function onCell(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".ag-cell") !== null;
}

// A column's cells, but a table as its symbol before its shape, and its
// shape in words on hover. The symbols are VS Code's own: a keyed table's
// has its keys at the left, as the Grid pins them. Always an element, as a
// string is HTML.
function symbol(column: Column) {
  return ({
    value,
    valueFormatted,
  }: {
    value?: number | null;
    valueFormatted?: string | null;
  }) => {
    const cell = document.createElement("span");
    const shape =
      value === null || value === undefined ? undefined : column.shape?.(value);
    if (shape) {
      const icon = document.createElement("span");
      icon.className = `codicon codicon-${shape.keyed ? "layout-sidebar-left" : "table"}`;
      icon.ariaHidden = "true";
      cell.append(icon, " ");
      cell.title = `${said(shape)}: double-click to open`;
    }
    cell.append(valueFormatted ?? "");
    return cell;
  };
}
