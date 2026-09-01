export const STRUCTURED_PREVIEW_CORE_VERSION: "2.1.0";

export type TableModel = {
  header: readonly string[];
  aligns: readonly ("left" | "center" | "right" | "")[];
  rows: readonly (readonly string[])[];
};
export type PropertyRow = {
  key: string;
  value: string;
  indent?: number;
  depth?: number;
  sequence?: boolean;
  scalar?: boolean;
  spacing?: string;
};

export function serializeTable(model: TableModel, lineEnding?: string): string;
export function updateTableCell(
  model: TableModel,
  rowIndex: number,
  columnIndex: number,
  value: string,
): TableModel;
export function addTableRow(model: TableModel): TableModel;
export function addTableColumn(model: TableModel, label?: string): TableModel;
export function moveItem<T>(items: readonly T[], from: number, to: number): T[];
export function moveTableRow(
  model: TableModel,
  from: number,
  to: number,
): TableModel;
export function moveTableColumn(
  model: TableModel,
  from: number,
  to: number,
): TableModel;
export function validPropertyKey(value: string): boolean;
export function parseFrontmatterRows(source: string): PropertyRow[] | null;
export function uniquePropertyKey(
  rows: readonly PropertyRow[],
  seed?: string,
): string;
export function serializeFrontmatter(
  rows: readonly PropertyRow[],
  lineEnding?: string,
): string;
export function updateProperty(
  rows: readonly PropertyRow[],
  index: number,
  field: "key" | "value",
  value: string,
): PropertyRow[];
export function addProperty(rows: readonly PropertyRow[]): PropertyRow[];
export function moveProperty(
  rows: readonly PropertyRow[],
  from: number,
  to: number,
): PropertyRow[];
export function createLinkControl(
  document: Document,
  options: {
    label: string;
    url: string;
    openable?: boolean;
    readOnly?: boolean;
    onOpen?: () => void | Promise<void>;
    onCopy?: () => boolean | void | Promise<boolean | void>;
    onEdit?: () => void | Promise<void>;
  },
): HTMLSpanElement;
