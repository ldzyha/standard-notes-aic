import type { ChangeSpec, EditorState, Extension } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";

export type ListKind = "bullet" | "ordered" | "task";
export type BlockKind = "paragraph" | "quote" | 1 | 2 | 3 | 4 | 5 | 6;
export type FormattingKind = ListKind | BlockKind;
export type ParsedListLine = {
  indent: string;
  marker: string | null;
  space: string;
  task: string | null;
  content: string;
};

export const FORMATTING_SHORTCUTS: readonly Readonly<{
  key: string;
  kind: FormattingKind;
}>[];
export function parseListLine(text: string): ParsedListLine;
export function formattingChanges(
  state: EditorState,
  kind: FormattingKind,
  options?: { toggle?: boolean },
): ChangeSpec[] | null;
export function toggleList(view: EditorView, kind: ListKind): boolean;
export function setBlockKind(view: EditorView, kind: BlockKind): boolean;
export function toggleHeading(
  view: EditorView,
  level: 1 | 2 | 3 | 4 | 5 | 6,
): boolean;
export function formattingShortcut(
  event: KeyboardEvent,
  apple?: boolean,
): FormattingKind | null;
export const formattingKeymap: readonly KeyBinding[];
export function markdownFormatting(): Extension;
