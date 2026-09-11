export const AGENTIC_NOTES_START: "<!-- aic:agentic-notes:start -->";
export const AGENTIC_NOTES_END: "<!-- aic:agentic-notes:end -->";
export const AGENTIC_NOTES_HEADING: "## Agentic Notes";

export type AgenticFailure = Readonly<{
  ok: false;
  code: string;
  path?: string;
}>;
export type AgenticTarget = Readonly<{ path: string; kind: "file" | "folder" }>;
export type AgenticSection = Readonly<{
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  body: string;
}>;

/** Full YAML validation; malformed or unsupported visibility is fail-closed. */
export function agenticNoteVisibility(
  source: string,
): Readonly<{ ok: true; visible: boolean }> | AgenticFailure;
/** Does not expose section content from private or malformed notes. */
export function inspectAgenticNotes(
  source: string,
): Readonly<{ ok: true; section: AgenticSection | null }> | AgenticFailure;
/** Pure expected-source comparison, not a host lock or atomic disk write. */
export function patchAgenticNotes(options: {
  source: string;
  expectedSource: string;
  body: string;
}): Readonly<{ ok: true; source: string; changed: boolean }> | AgenticFailure;

/** Forward .note.md convention, never reverse-guesses an owner. */
export function agenticNotePathFor(target: AgenticTarget): string | null;

export type AgenticContextNote = Readonly<{
  path: string;
  scope: AgenticTarget;
  role: "project" | "ancestor" | "current";
  source: string;
  agenticBody: string | null;
}>;
/**
 * All paths are normalized project-relative paths, never URIs or absolute paths.
 * The caller must provide all existing possible owners for the relevant scope
 * notes (including sibling extension collisions, not necessarily a global scan),
 * enforce realpath/workspace boundaries and avoid stale snapshots.
 * caseSensitive defaults to false (conservative on Windows and Linux).
 * currentNotePath is an explicit canonical current binding, not an arbitrary
 * override. Existing notes only; excludes private/invalid notes with no content.
 */
export function resolveAgenticContext(options: {
  target: AgenticTarget;
  projectNotePath: string;
  notes: readonly Readonly<{ path: string; source: string }>[];
  targets: readonly AgenticTarget[];
  currentNotePath?: string;
  caseSensitive?: boolean;
}):
  | Readonly<{
      ok: true;
      notes: readonly AgenticContextNote[];
      excluded: readonly Readonly<{ path: string; code: string }>[];
    }>
  | AgenticFailure;
