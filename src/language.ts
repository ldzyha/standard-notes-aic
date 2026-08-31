import { LanguageDescription } from "@codemirror/language";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "mjs", "cjs"],
    load: async () => javascript(),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript", "mts", "cts"],
    load: async () => javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    load: async () => javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    load: () =>
      import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    load: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: "SCSS",
    alias: ["scss"],
    load: () =>
      import("@codemirror/lang-sass").then(({ sass }) =>
        sass({ indented: false }),
      ),
  }),
  LanguageDescription.of({
    name: "Sass",
    alias: ["sass"],
    load: () =>
      import("@codemirror/lang-sass").then(({ sass }) =>
        sass({ indented: true }),
      ),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then(({ json }) => json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    load: async () => html(),
  }),
];

export function aicMarkdownLanguage() {
  return markdown({
    base: markdownLanguage,
    extensions: [GFM],
    codeLanguages,
  });
}
