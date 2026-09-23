import type { EditorState, Extension } from "@codemirror/state";

export const CODE_FENCE_EXTENSION_CORE_VERSION: "1.2.0";

export type CodeFenceBlock = Readonly<{
  from: number;
  to: number;
  textFrom: number;
  source: string;
  language: string;
}>;

export function fenceInfo(
  state: EditorState,
  node: {
    node: { getChild(name: string): { from: number; to: number } | null };
  },
): string;

export function codeFences(state: EditorState): readonly CodeFenceBlock[];

export function makeCodeFenceExtension(
  options?: Readonly<{
    document?: Document;
    onCopy?: (
      source: string,
      language: string,
    ) => boolean | void | Promise<boolean | void>;
  }>,
): Extension;
