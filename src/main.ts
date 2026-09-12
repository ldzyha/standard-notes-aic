import "sn-extension-api/dist/sn.min.css";
import { AicEditor } from "./editor";
import { markdownPlainPreview } from "./preview";
import { NoteDraftRegistry } from "./note-draft-registry";
import { StandardNotesHost } from "./standard-notes-host";
import { stampFileProperties } from "./core/file-properties.js";
import "./styles.css";
import "./core/icons.css";
import "./core/mermaid-viewport.css";
import "./core/slash-snippets.css";
import "./core/preview-layout.css";
import "./core/diagram-builder.css";
import "./core/diagram-palette.css";
import "./core/diagram-session.css";
import "./core/security-block.css";
import "./core/security-import-extension.css";

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
  onSave: commitDraft,
  onChange: (text) => {
    // Read-only belongs at the interaction boundary. If any mutation reaches
    // the document, never silently discard its draft tracking.
    if (!hydrated || !activeNoteId) return;
    drafts.edit(text);
    reflectSaveState();
  },
});

let unsubscribe = () => {};
let activeNoteId: string | null = standalone ? "standalone" : null;
let activeFileProperties: Readonly<{
  id: string;
  fileName: string | null;
  createdAt: string | null;
}> | null = null;

if (standalone) {
  const storageKey = "aic-standard-notes-standalone-document";
  const initial = localStorage.getItem(storageKey) ?? sample;
  drafts.activate("standalone", initial, remoteGeneration);
  editor.switchDocument("standalone", initial);
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
      activeNoteId = null;
      activeFileProperties = null;
      editor.switchDocument("unavailable", snapshot.text);
      editor.setReadOnly(true);
      editor.setSaveState("unavailable");
      return;
    }
    if (snapshot.kind === "metadata" && activeNoteId === snapshot.id) {
      activeFileProperties = {
        id: snapshot.id,
        fileName: snapshot.fileName,
        createdAt: snapshot.createdAt,
      };
      editor.setReadOnly(snapshot.locked);
      reflectSaveState();
      return;
    }
    const active = drafts.activate(
      snapshot.id,
      snapshot.text,
      remoteGeneration,
    );
    activeFileProperties = {
      id: snapshot.id,
      fileName: snapshot.fileName,
      createdAt: snapshot.createdAt,
    };
    if (activeNoteId === snapshot.id) editor.updateDocument(active.text);
    else {
      activeNoteId = snapshot.id;
      editor.switchDocument(snapshot.id, active.text);
    }
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
    !active || active.id !== activeNoteId
      ? "unavailable"
      : active.dirty || active.pending
        ? "dirty"
        : active.text.trim().length === 0
          ? "placeholder"
          : "saved",
    Boolean(active?.pending),
  );
}

async function commitDraft(): Promise<boolean> {
  if (!hydrated || (!standalone && host?.locked)) return false;
  const active = drafts.current;
  if (!active || active.id !== activeNoteId || active.pending) return false;
  if (activeFileProperties?.id === active.id) {
    const stamped = stampFileProperties(active.text, {
      fileName: activeFileProperties.fileName,
      createdAt: activeFileProperties.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (stamped !== active.text) {
      drafts.edit(stamped);
      editor.updateDocument(stamped);
    }
  }
  const commit = drafts.begin("explicit");
  if (!commit) return !drafts.current?.dirty;
  reflectSaveState();
  let saved = false;
  try {
    if (standalone) {
      localStorage.setItem(
        "aic-standard-notes-standalone-document",
        commit.text,
      );
      saved = true;
    } else if (host) {
      const result = await host.save(
        commit.id,
        commit.operationId,
        commit.text,
        markdownPlainPreview(commit.text),
      );
      saved =
        result.id === commit.id &&
        result.operationId === commit.operationId &&
        result.status === "acknowledged";
    }
  } catch (error) {
    console.error("AIC note save failed", error);
  }
  drafts.acknowledge({ ...commit, saved });
  reflectSaveState();
  return Boolean(saved && activeNoteId === commit.id && !drafts.current?.dirty);
}

const saveShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void commitDraft();
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
    host?.dispose();
    themeObserver.disconnect();
    editor.destroy();
  },
  { once: true },
);
