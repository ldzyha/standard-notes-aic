import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";

export const SLASH_SNIPPETS_CORE_VERSION: "1.2.0";
export const SLASH_SNIPPET_PLACEHOLDER: string;

export type DocumentationSnippet = Readonly<{
  command: string;
  kind: "page" | "section" | "block";
  group:
    | "pages"
    | "structure"
    | "assurance"
    | "references"
    | "data"
    | "diagrams"
    | "content";
  title: string;
  question: string;
  template: string;
  searchTerms?: readonly string[];
}>;

export const DOCUMENTATION_SNIPPETS: readonly DocumentationSnippet[];
export const SLASH_SNIPPET_GROUP_NAMES: Readonly<
  Record<DocumentationSnippet["group"], string>
>;

export function slashSnippetSections(
  hasPageContent: boolean,
): Readonly<
  Record<
    DocumentationSnippet["group"],
    Readonly<{ name: string; rank: number }>
  >
>;

export function slashSnippetToken(lineBeforeCursor: string): string | null;

export function slashSnippetSearchText(entry: DocumentationSnippet): string;

export function slashSnippetTemplate(
  entry: DocumentationSnippet,
  sourceBeforeCursor?: string,
): string;

export function slashSnippetQuery(
  state: EditorState,
  pos: number,
): Readonly<{
  from: number;
  to: number;
  text: string;
  hasPageContent: boolean;
}> | null;

export function slashSnippetCompletions(
  context: CompletionContext,
): CompletionResult | null;

export function slashSnippetExtension(): Extension;
