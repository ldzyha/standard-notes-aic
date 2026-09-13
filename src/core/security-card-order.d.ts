import type { ChangeSet, EditorState, Extension } from "@codemirror/state";
import type { SecurityBlock } from "./security-block.js";
export function securityCardMove(
  state: EditorState,
  source: SecurityBlock,
  target: SecurityBlock,
): {
  changes: ChangeSet;
  selection: { anchor: number };
} | null;
export function securityCardOrdering(): {
  register(
    element: HTMLElement,
    handle: HTMLButtonElement,
    getBlock: () => SecurityBlock | null,
  ): () => void;
  extension: Extension;
};
