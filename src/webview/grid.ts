import {
  CellStyleModule,
  ClientSideRowModelModule,
  type ColDef,
  ColumnAutoSizeModule,
  createGrid,
  type GridApi,
  ModuleRegistry,
  RowApiModule,
  TextFilterModule,
  themeQuartz,
} from "ag-grid-community";
import type { Sheet } from "./table";

// The Grid view: a sheet in ag-grid. Only this file knows ag-grid.

ModuleRegistry.registerModules([
  // For right-aligned columns
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  // For how many rows are shown
  RowApiModule,
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

// Shows one sheet at a time in a place, each replacing the last, so that
// nothing of an old result's sort, filter or scroll is left on a new one
export class Grid {
  private api?: GridApi<Row>;

  constructor(
    private readonly place: HTMLElement,
    // For ag-grid's styles, which the page's security policy allows by it
    private readonly nonce: string,
    // Told how many rows are shown, after each filter
    private readonly shown: (rows: number) => void,
  ) {}

  show(sheet: Sheet) {
    this.clear();
    const columnDefs = sheet.columns.map(
      (column, j): ColDef<Row, number> => ({
        colId: String(j),
        headerName: column.name,
        pinned: j < sheet.keys ? "left" : undefined,
        // Numbers line up by their digits
        type: numbers.includes(column.type) ? "rightAligned" : undefined,
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
      columnDefs,
      rowData: Array.from({ length: sheet.rows }, (_, row) => ({ row })),
      autoSizeStrategy: { type: "fitCellContents" },
      onModelUpdated: ({ api }) => this.shown(api.getDisplayedRowCount()),
    });
  }

  clear() {
    this.api?.destroy();
    this.api = undefined;
  }
}
