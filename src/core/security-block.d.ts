import type {
  EditorState,
  Extension,
  StateEffectType,
} from "@codemirror/state";

export const SECURITY_BLOCK_CORE_VERSION: "1.5.0";
export type SecurityBlock = Readonly<{
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  body: string;
  /** One-based document line of the opening fence or frontmatter delimiter. */
  openingLine: number;
  /** Security fence delimiters; absent for Properties frontmatter. */
  closed?: boolean;
  fence?: string;
  fieldSyntax?: "pipes";
  sectionSyntax?: "separators";
  unsupportedSyntax?: true;
}>;
export function securityBlocks(state: EditorState): readonly SecurityBlock[];
export function propertiesBlocks(state: EditorState): readonly SecurityBlock[];
export type PropertyRelationship = Readonly<{
  relation: string;
  label: string;
  path: string;
  depth?: number;
  exists?: boolean;
  isCurrent?: boolean;
}>;
export const setPropertyRelationships: StateEffectType<
  readonly PropertyRelationship[]
>;
type BlockOptions = Readonly<{
  document?: Document;
  onCopy?: (
    value: string,
    label: string,
  ) => boolean | void | Promise<boolean | void>;
  onOpen?: (url: string) => void | Promise<void>;
  onReadClipboard?: () => Promise<string>;
}>;
export function makeSecurityBlockExtension(options?: BlockOptions): Extension;
export function makePropertiesBlockExtension(
  options?: BlockOptions &
    Readonly<{
      initialRelationships?: () => readonly PropertyRelationship[];
      onRelationshipOpen?: (path: string) => void | Promise<void>;
    }>,
): Extension;
