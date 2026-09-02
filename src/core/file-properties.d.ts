export type FilePropertyStamp = Readonly<{
  fileName?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}>;

export function isMarkdownDocumentName(value: unknown): boolean;
export function isManagedNoteName(value: unknown): boolean;

export function stampFileProperties(
  markdown: unknown,
  stamp?: FilePropertyStamp,
): string;
