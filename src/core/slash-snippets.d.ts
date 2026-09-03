import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";

export const SLASH_SNIPPETS_CORE_VERSION: "1.1.0";
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
}>;

export const DOCUMENTATION_SNIPPETS: readonly DocumentationSnippet[];

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
