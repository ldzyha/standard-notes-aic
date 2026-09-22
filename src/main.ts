import "sn-extension-api/dist/sn.min.css";
import { AicEditor, type SaveFeedback } from "./editor";
import { markdownPlainPreview } from "./preview";
import { NoteDraftRegistry } from "./note-draft-registry";
import {
  StandardNotesHost,
  type StandardNotesSaveTarget,
} from "./standard-notes-host";
import "./styles.css";
import "./core/ui-system.css";
import "./core/icons.css";
import "./core/mermaid-viewport.css";
import "./core/slash-snippets.css";
import "./core/preview-layout.css";
import "./core/security-block.css";
import "./core/security-import-extension.css";

declare global {
  interface Window {
    ReactNativeWebView?: unknown;
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("AIC editor root is missing");

const sample = `\`\`\`aic
# Properties
Status | idea
Tags | notes, aic
\`\`\`

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
const saveFeedback = new Map<string, SaveFeedback>();
const inFlight = new Map<string, Promise<boolean>>();
const queued = new Set<string>();
const editor = new AicEditor(root, {
  readOnly: !standalone,
  onSave: commitDraft,
  onChange: (text) => {
    // Read-only belongs at the interaction boundary. If any mutation reaches
    // the document, never silently discard its draft tracking.
    if (!hydrated || !activeNoteId) return;
    drafts.edit(text);
    if (saveFeedback.get(activeNoteId) !== "saving")
      saveFeedback.set(activeNoteId, "dirty");
    reflectSaveState();
  },
});

let unsubscribe = () => {};
let unsubscribeBefore = () => {};
let activeNoteId: string | null = standalone ? "standalone" : null;

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
  unsubscribeBefore = standardNotesHost.onBeforeContextChange((previousId) => {
    if (activeNoteId === previousId && drafts.current?.dirty)
      void commitDraft("boundary", previousId);
  });
  unsubscribe = standardNotesHost.subscribe((snapshot) => {
    remoteGeneration += 1;
    if (!snapshot.id) {
      const previousId = activeNoteId;
      activeNoteId = null;
      if (previousId) pruneFeedback(previousId);
      editor.switchDocument("unavailable", snapshot.text);
      editor.setReadOnly(true);
      editor.setSaveState("unavailable");
      return;
    }
    if (snapshot.kind === "metadata" && activeNoteId === snapshot.id) {
      editor.setReadOnly(snapshot.locked);
      reflectSaveState();
      return;
    }
    const previousDraft = drafts.snapshot(snapshot.id);
    const active = drafts.activate(
      snapshot.id,
      snapshot.text,
      remoteGeneration,
    );
    if (!active.dirty && previousDraft?.text !== active.text)
      saveFeedback.delete(snapshot.id);
    const previousId = activeNoteId;
    if (activeNoteId === snapshot.id) editor.updateDocument(active.text);
    else {
      activeNoteId = snapshot.id;
      editor.switchDocument(snapshot.id, active.text);
    }
    if (previousId) pruneFeedback(previousId);
    hydrated = true;
    editor.setReadOnly(snapshot.locked);
    reflectSaveState();
    editor.refreshTheme();
  });
  document.documentElement.dataset.environment = "standard-notes";
}

function reflectSaveState(): void {
  const active = drafts.current;
  const feedback = active
    ? active.pending
      ? "saving"
      : active.dirty
        ? saveFeedback.get(active.id) === "failed"
          ? "failed"
          : "dirty"
        : saveFeedback.get(active.id) === "saved"
          ? "saved"
          : "none"
    : "none";
  editor.setSaveState(
    !active || active.id !== activeNoteId
      ? "unavailable"
      : active.dirty || active.pending
        ? "dirty"
        : active.text.trim().length === 0
          ? "placeholder"
          : "saved",
    Boolean(active?.pending),
    feedback,
  );
}

function pruneFeedback(id: string): void {
  if (id !== activeNoteId && !drafts.snapshot(id)?.dirty && !inFlight.has(id))
    saveFeedback.delete(id);
}

async function runSaveChain(
  id: string,
  target: StandardNotesSaveTarget | null,
): Promise<boolean> {
  try {
    for (;;) {
      queued.delete(id);
      const commit = drafts.beginFor(id, "explicit");
      if (!commit) break;
      saveFeedback.set(id, "saving");
      reflectSaveState();
      let saved = false;
      try {
        if (standalone) {
          localStorage.setItem(
            "aic-standard-notes-standalone-document",
            commit.text,
          );
          saved = true;
        } else if (target) {
          const result = await target.save(
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
      const latest = drafts.snapshot(id);
      saveFeedback.set(
        id,
        saved ? (latest?.dirty ? "dirty" : "saved") : "failed",
      );
      const hasQueuedSave = queued.delete(id);
      // A boundary can be queued while the original request is pending even
      // without a newer edit. A failed ACK must require an explicit retry.
      if (!saved || !hasQueuedSave || !latest?.dirty) break;
    }
    return saveFeedback.get(id) === "saved" && !drafts.snapshot(id)?.dirty;
  } finally {
    // Publish the settled feedback only after this note can accept Retry.
    inFlight.delete(id);
    queued.delete(id);
    target?.dispose();
    pruneFeedback(id);
    reflectSaveState();
  }
}

function commitDraft(
  reason: "action" | "boundary" = "action",
  id: string | null = activeNoteId,
): Promise<boolean> {
  if (!hydrated || !id) return Promise.resolve(false);
  const active = drafts.snapshot(id);
  if (!active) return Promise.resolve(false);
  if (
    !standalone &&
    id === activeNoteId &&
    (host?.currentNoteId !== id || host.locked)
  )
    return Promise.resolve(false);
  if (reason === "boundary" && saveFeedback.get(id) === "failed")
    return Promise.resolve(false);
  const latest = drafts.snapshot(id);
  if (!latest?.dirty) return Promise.resolve(true);
  const running = inFlight.get(id);
  if (running) {
    queued.add(id);
    return running;
  }
  const target = standalone ? null : (host?.captureSaveTarget(id) ?? null);
  if (!standalone && !target) {
    saveFeedback.set(id, "failed");
    reflectSaveState();
    return Promise.resolve(false);
  }
  let resolve!: (saved: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  inFlight.set(id, pending);
  void runSaveChain(id, target).then(resolve, () => resolve(false));
  return pending;
}

const saveShortcut = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void commitDraft("action");
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
    void commitDraft("boundary");
    document.removeEventListener("keydown", saveShortcut);
    unsubscribe();
    unsubscribeBefore();
    host?.dispose();
    themeObserver.disconnect();
    editor.destroy();
  },
  { once: true },
);
