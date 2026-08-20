import snApi from "sn-extension-api";
import "sn-extension-api/dist/sn.min.css";
import { AicEditor } from "./editor";
import { markdownPlainPreview } from "./preview";
import "./styles.css";

declare global {
  interface Window {
    ReactNativeWebView?: unknown;
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("AIC editor root is missing");

const sample = `---
status: idea
tags: notes, aic
---

# AIC Markdown

Markdown remains the source of truth.

- [ ] Click this task
- [x] Keep completed work visible

| Feature | State |
| --- | --- |
| **Tables** | ready |
| Mermaid | ready |

\`\`\`mermaid
flowchart LR
  Markdown --> AIC
  AIC --> StandardNotes[Standard Notes]
\`\`\`
`;

const standalone = window.parent === window && !window.ReactNativeWebView;
let hydrated = standalone;
let saveText: (text: string) => void = () => {};
const editor = new AicEditor(root, {
  readOnly: !standalone,
  onChange: (text) => saveText(text),
});

let unsubscribe = () => {};

if (standalone) {
  const storageKey = "aic-standard-notes-standalone-document";
  editor.setDocument(localStorage.getItem(storageKey) ?? sample);
  saveText = (text) => localStorage.setItem(storageKey, text);
  document.documentElement.dataset.environment = "standalone";
} else {
  snApi.initialize({ debounceSave: 250 });
  unsubscribe = snApi.subscribe((text) => {
    editor.setDocument(text);
    hydrated = true;
    editor.setReadOnly(Boolean(snApi.locked));
    editor.refreshTheme();
  });
  saveText = (text) => {
    if (!hydrated || snApi.locked) return;
    snApi.text = text;
    snApi.preview = markdownPlainPreview(text);
  };
  document.documentElement.dataset.environment = "standard-notes";
}

const themeObserver = new MutationObserver(() => editor.refreshTheme());
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
themeObserver.observe(document.head, { childList: true, subtree: true });

window.addEventListener(
  "pagehide",
  () => {
    unsubscribe();
    themeObserver.disconnect();
    editor.destroy();
  },
  { once: true },
);
