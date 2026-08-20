import { LanguageDescription } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "mjs", "cjs"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript(),
      ),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript", "mts", "cts"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true, jsx: true }),
      ),
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
    load: () => import("@codemirror/lang-css").then(({ css }) => css()),
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
    load: () => import("@codemirror/lang-html").then(({ html }) => html()),
  }),
];

export function aicMarkdownLanguage() {
  return markdown({
    base: markdownLanguage,
    extensions: [GFM],
    codeLanguages,
  });
}
