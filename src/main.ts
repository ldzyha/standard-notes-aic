import "sn-extension-api/dist/sn.min.css";
import { AicEditor } from "./editor";
import { markdownPlainPreview } from "./preview";
import { NoteDraftRegistry } from "./note-draft-registry";
import { StandardNotesHost } from "./standard-notes-host";
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
let remoteGeneration = 0;
const drafts = new NoteDraftRegistry();
const host = standalone ? null : new StandardNotesHost();
const editor = new AicEditor(root, {
  readOnly: !standalone,
  onChange: (text) => {
    if (!hydrated || (!standalone && host?.locked)) return;
    drafts.edit(text);
    reflectSaveState();
  },
});

let unsubscribe = () => {};

if (standalone) {
  const storageKey = "aic-standard-notes-standalone-document";
  const initial = localStorage.getItem(storageKey) ?? sample;
  drafts.activate("standalone", initial, remoteGeneration);
  editor.setDocument(initial);
  reflectSaveState();
  document.documentElement.dataset.environment = "standalone";
} else {
  const standardNotesHost = host;
  if (!standardNotesHost)
    throw new Error("Standard Notes host adapter is unavailable");
  standardNotesHost.initialize();
  unsubscribe = standardNotesHost.subscribe((snapshot) => {
    remoteGeneration += 1;
    if (!snapshot.id) {
      editor.setDocument(snapshot.text);
      editor.setReadOnly(true);
      editor.setSaveState("unavailable");
      return;
    }
    const active = drafts.activate(
      snapshot.id,
      snapshot.text,
      remoteGeneration,
    );
    editor.setDocument(active.text);
    hydrated = true;
    editor.setReadOnly(snapshot.locked);
    reflectSaveState();
    editor.refreshTheme();
  });
  document.documentElement.dataset.environment = "standard-notes";
}

function reflectSaveState(): void {
  const active = drafts.current;
  editor.setSaveState(
    !active
      ? "unavailable"
      : active.dirty
        ? "dirty"
        : active.text.trim().length === 0
          ? "placeholder"
          : "saved",
  );
}

function commitDraft(): void {
  if (!hydrated || (!standalone && host?.locked)) return;
  const active = drafts.current;
  if (!active) return;
  const commit = drafts.begin("explicit");
  if (!commit) return;
  let saved = false;
  try {
    if (standalone) {
      localStorage.setItem(
        "aic-standard-notes-standalone-document",
        commit.text,
      );
      saved = true;
    } else if (host) {
      saved = host.save(
        active.id,
        commit.text,
        markdownPlainPreview(commit.text),
      );
    }
  } catch (error) {
    console.error("AIC note save failed", error);
  }
  drafts.acknowledge({ ...commit, saved });
  reflectSaveState();
}

const saveShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    commitDraft();
  }
};
document.addEventListener("keydown", saveShortcut);

const themeObserver = new MutationObserver(() => editor.refreshTheme());
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
themeObserver.observe(document.head, { childList: true, subtree: true });

window.addEventListener(
  "pagehide",
  () => {
    document.removeEventListener("keydown", saveShortcut);
    unsubscribe();
    themeObserver.disconnect();
    editor.destroy();
  },
  { once: true },
);
