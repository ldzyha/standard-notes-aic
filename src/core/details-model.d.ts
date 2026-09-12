export type DetailsSummary = Readonly<{
  title: string;
  checked: boolean | null;
  label: string;
  href: string;
  taskOffset: number;
}>;
export type DetailsBlock = Readonly<{
  from: number;
  to: number;
  end: number;
  headerFrom: number;
  headerTo: number;
  contentFrom: number;
  contentTo: number;
  closeFrom: number;
  closeTo: number;
  open: boolean;
  title: string;
  titleFrom: number;
  summary: DetailsSummary;
}>;
export function parseDetailsBlocks(value: string): DetailsBlock[];
export function detailsForDocument(doc: { toString(): string }): DetailsBlock[];
export function toggleDetailsMarker(value: string): string | null;
