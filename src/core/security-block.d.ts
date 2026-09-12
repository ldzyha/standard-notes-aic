import type { EditorState, Extension } from "@codemirror/state";

export const SECURITY_BLOCK_CORE_VERSION: "1.2.1";
export type SecurityBlock = Readonly<{
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  body: string;
}>;
export function securityBlocks(state: EditorState): readonly SecurityBlock[];
export function makeSecurityBlockExtension(
  options?: Readonly<{
    document?: Document;
    onCopy?: (
      value: string,
      label: string,
    ) => boolean | void | Promise<boolean | void>;
    onOpen?: (url: string) => void | Promise<void>;
    onReadClipboard?: () => Promise<string>;
  }>,
): Extension;
