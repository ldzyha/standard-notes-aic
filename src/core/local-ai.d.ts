export const LOCAL_AI_MAX_TEXT: 14000;
export type LocalAIAvailability =
  "available" | "downloadable" | "downloading" | "unavailable";
export type LocalAIReview = Readonly<{
  text: string;
  notes: readonly string[];
  changed: boolean;
}>;
/** Markdown code, links, raw HTML and existing opaque Properties boundaries. */
export function localAIProtectedRanges(
  source: string,
): readonly Readonly<{ from: number; to: number }>[];
/** Throws if a protected part was inserted, removed or changed. */
export function validateLocalReplacement(
  original: string,
  replacement: string,
): string;
export function localAIAvailability(): Promise<LocalAIAvailability>;
/** Explicit user actions create a browser-owned model session; no network fallback. */
export function reviewLocalText(
  options: Readonly<{
    text: string;
    mode: "grammar" | "improve";
    signal: AbortSignal;
    onProgress?: (message: string) => void;
  }>,
): Promise<LocalAIReview>;
