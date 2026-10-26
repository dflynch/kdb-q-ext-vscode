import {
  CellStyleModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnAutoSizeModule,
  createGrid,
  type GridApi,
  ModuleRegistry,
  RowApiModule,
  ScrollApiModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import type { Step } from "../messages";
import type { Sheet } from "./table";

// The Grid view: a sheet in ag-grid. Only this file knows ag-grid.

ModuleRegistry.registerModules([
  // For right-aligned cells
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  // For how many rows are shown, and finding a row by its index in the result
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

  constructor(
    private readonly place: HTMLElement,
    // For ag-grid's styles, which the page's security policy allows by it
    private readonly nonce: string,
    // Told how many rows are shown, after each filter
    private readonly shown: (rows: number) => void,
    // Told of a cell double-clicked, or Enter pressed on, to drill into: its
    // row in the result, and its column in the sheet
    private readonly drill: (row: number, column: number) => void,
  ) {}

  show(sheet: Sheet) {
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
        comparator: (a, b) => column.compare(a ?? 0, b ?? 0),
        filter: "agTextColumnFilter",
        filterValueGetter: ({ data }) => (data ? column.text(data.row) : ""),
      }),
    );
    this.api = createGrid<Row>(this.place, {
      theme,
      styleNonce: this.nonce,
      columnDefs: [index, ...columnDefs],
      rowData: Array.from({ length: sheet.rows }, (_, row) => ({ row })),
      getRowId: ({ data }) => String(data.row),
      autoSizeStrategy: { type: "fitCellContents" },
      onModelUpdated: ({ api }) => this.shown(api.getDisplayedRowCount()),
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
  // So the keys work on coming to the grid. A cell drilled from is shown,
  // but for a filter typed half a second or less before drilling, which
  // ag-grid applies after its pause, while the grid is hidden: a risk taken,
  // as filtering at every key takes up to 0.8 s a million rows.
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
        throw new Error("index", {
          cause: `drilled-from row ${cell[0]} not shown`,
        });
      }
      api.ensureIndexVisible(index);
      api.setFocusedCell(index, String(cell[1]));
    });
  }

  clear() {
    this.api?.destroy();
    this.api = undefined;
  }
}
