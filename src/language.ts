import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { codeLanguages } from "./core/code-languages.js";

export function aicMarkdownLanguage() {
  return markdown({
    base: markdownLanguage,
    extensions: [GFM],
    codeLanguages,
  });
}
