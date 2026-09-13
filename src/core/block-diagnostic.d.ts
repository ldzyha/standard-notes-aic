export type BlockSourceRange = Readonly<{ from: number; to: number }>;
export type BlockDiagnostic = BlockSourceRange &
  Readonly<{
    /** Fixed classification/advice; never contains authored source or parser messages. */
    code: string;
    message: string;
    /** One-based, relative to the block body. Columns count UTF-16 code units. */
    line: number;
    column: number;
  }>;
/** Clamps UTF-16 source offsets. Does not retain or include source text. */
export function blockDiagnostic(
  body: string,
  code: string,
  message: string,
  from?: number,
  to?: number,
): BlockDiagnostic;
