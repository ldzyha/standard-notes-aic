import {
  AppUpdateLifecycle,
  OneShotInstallPrompt,
  type InstallPrompt,
} from "./app-lifecycle";
import { AicEditor } from "../editor";
import { attachLocalAI, type LocalAIControls } from "./ai-controls";
import logoUrl from "../../public/aic-logo.svg?url";
import { createUiButton, applyUiComponent } from "../core/ui-system.js";
import { PwaNote, canBindFile, downloadNote } from "./disk";
import "../styles.css";
import "../core/ui-system.css";
import "../core/icons.css";
import "../core/mermaid-viewport.css";
import "../core/slash-snippets.css";
import "../core/preview-layout.css";
import "../core/security-block.css";
import "../core/security-import-extension.css";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("AIC Notes root is missing.");
const note = new PwaNote();
const URL_TARGET = /^https?:\/\//iu;
let editor: AicEditor | null = null;
let aiControls: LocalAIControls | null = null;
let draft = "";
let dirty = false;
let working = false;
let conflict = false;
let saveTask: Promise<boolean> | null = null;
let saveFailed = false;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycle = 0;
let appUpdates: AppUpdateLifecycle | null = null;
let requestAppActivation = false;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}
function button(
  label: string,
  action: () => void | Promise<unknown>,
  options: {
    text?: string;
    icon?: string;
    iconOnly?: boolean;
    variant?: "default" | "ghost" | "danger" | "primary";
    size?: "compact" | "normal" | "touch";
  } = {},
) {
  const control = createUiButton(document, {
    label,
    variant: "ghost",
    text: label,
    ...options,
  });
  control.addEventListener("click", () => void run(action));
  return control;
}

const app = element("main", "pwa-shell");
const header = element("header", "pwa-header");
const brand = element("div", "pwa-brand");
const logo = element("img");
logo.src = logoUrl;
logo.alt = "";
logo.width = 28;
logo.height = 28;
brand.append(logo, element("strong", "", "AIC Notes"));
const status = applyUiComponent(
  element("span", "pwa-status", ""),
  "context",
  [],
  "status",
);
status.setAttribute("role", "status");
// One contextual action: reconnect, reload after a conflict, or retry.
const fixButton = button("Reconnect note file", fix, { variant: "primary" });
fixButton.hidden = true;
const menuButton = createUiButton(document, {
  label: "Note options",
  variant: "ghost",
  icon: "more",
  iconOnly: true,
  size: "touch",
});
menuButton.addEventListener("click", showMenu);
const updateButton = button("Update app", async () => {
  if (!(await save()) || dirty) return;
  // Activation is deferred until run releases its editing lock.
  requestAppActivation = true;
});
updateButton.hidden = true;
const installPrompts = new OneShotInstallPrompt((available) => {
  installButton.hidden = !available;
});
const installButton = button("Install AIC Notes", async () => {
  await installPrompts.consume()?.prompt();
});
installButton.hidden = true;
header.append(
  brand,
  status,
  fixButton,
  updateButton,
  installButton,
  menuButton,
);
const notice = applyUiComponent(element("div", "pwa-notice"), "notice", [
  "info",
]);
notice.setAttribute("role", "status");
notice.setAttribute("aria-live", "polite");
notice.hidden = true;
const content = element("section", "pwa-content");
app.append(header, notice, content);
root.append(app);

const publicOrigin = /^https?:$/u.test(location.protocol)
  ? location.origin
  : "https://aic.dzyha.com";
function helpLinks() {
  return [
    ["How to", "/how-to"],
    ["Releases", "/releases"],
    ["Terms", "/terms"],
  ].map(([label, path]) => {
    const link = applyUiComponent(element("a", "", label), "menu", [], "item");
    link.href = new URL(path!, publicOrigin).href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  });
}

function notify(message: string, error = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle("aic-notice--error", error);
}

function showMenu() {
  const origin = document.activeElement as HTMLElement | null;
  const dialog = applyUiComponent(
    element("dialog", "pwa-dialog pwa-sheet"),
    "menu",
    ["compact"],
  );
  dialog.setAttribute("aria-label", "Note options");
  const items: HTMLElement[] = [];
  if (note.exists) {
    items.push(
      button("Download note", () => downloadNote(editorText(), note.name), {
        icon: "export-file",
      }),
      button(
        canBindFile() ? "Open note file…" : "Replace from file…",
        openOther,
        { icon: "document" },
      ),
      applyUiComponent(element("hr"), "menu", [], "separator"),
    );
  }
  items.push(
    ...helpLinks(),
    button("Close menu", () => close(), { text: "Done" }),
  );
  for (const item of items)
    if (item.tagName !== "HR") applyUiComponent(item, "menu", [], "item");
  function close() {
    dialog.close();
    dialog.remove();
    if (origin?.isConnected) origin.focus();
  }
  dialog.append(...items);
  dialog.addEventListener("cancel", close);
  dialog.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button, a, dialog") !== dialog)
      close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

async function run(action: () => void | Promise<unknown>) {
  if (working) return;
  const started = lifecycle;
  working = true;
  editor?.setReadOnly(true);
  app.setAttribute("aria-busy", "true");
  try {
    await action();
  } catch (error) {
    if (started === lifecycle)
      notify(
        error instanceof Error ? error.message : "This action did not finish.",
        true,
      );
  } finally {
    working = false;
    editor?.setReadOnly(readOnly());
    app.removeAttribute("aria-busy");
    reflect();
    if (requestAppActivation) {
      requestAppActivation = false;
      appUpdates?.activate();
    }
    appUpdates?.reconsider();
  }
}

function readOnly(): boolean {
  return working || note.access !== "ready";
}
function editorText(): string {
  return dirty ? draft : note.text;
}

function reflect() {
  app.dataset.hasNote = String(!!editor);
  menuButton.hidden = !note.exists;
  const state = saveTask
    ? "Saving…"
    : saveFailed
      ? "Save failed"
      : dirty
        ? "Unsaved"
        : note.access === "reconnect"
          ? `${note.name} · read-only copy`
          : note.handle
            ? `Saved to ${note.name}`
            : "Saved in this browser";
  status.textContent = editor ? state : "";
  status.dataset.state = saveTask
    ? "saving"
    : saveFailed
      ? "failed"
      : dirty
        ? "dirty"
        : "saved";
  editor?.setSaveState(
    dirty ? "dirty" : "saved",
    !!saveTask,
    saveTask ? "saving" : saveFailed ? "failed" : dirty ? "dirty" : "none",
  );
  const fixLabel =
    note.access === "reconnect"
      ? "Reconnect note file"
      : conflict
        ? "Reload note file"
        : saveFailed
          ? "Retry save"
          : "";
  fixButton.hidden = !editor || !fixLabel;
  fixButton.textContent = fixLabel;
  fixButton.setAttribute("aria-label", fixLabel);
}

/** First run, or a bound file that is gone: choose or create the note. */
function renderChooser() {
  clearEditor();
  const panel = element("div", "pwa-start");
  const heading = element("h1", "pwa-title", "Choose your note file");
  const text = element(
    "p",
    "pwa-empty",
    canBindFile()
      ? "AIC Notes edits one Markdown file. Every page of the note is in it."
      : "This browser keeps the note in its own storage. Use Download note to keep a copy as a file.",
  );
  const actions = element("div", "pwa-actions");
  actions.append(
    button("Open note file", () => choose(false), {
      icon: "document",
      variant: "primary",
    }),
    button("Create new note", () => choose(true), { icon: "note-add" }),
  );
  panel.append(heading, text, actions);
  content.replaceChildren(panel);
  reflect();
}

function clearEditor() {
  lifecycle++;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  aiControls?.dispose();
  aiControls = null;
  editor?.destroy();
  editor = null;
  dirty = false;
  saveFailed = false;
  conflict = false;
  content.replaceChildren();
}

function render() {
  if (!note.exists || note.access === "missing") {
    renderChooser();
    if (note.access === "missing")
      notify(
        `${note.name} was moved or deleted. Open it again, or create a new file: it starts with the last saved text.`,
        true,
      );
    return;
  }
  clearEditor();
  const mounted = lifecycle;
  const container = element("div", "pwa-editor");
  content.append(container);
  editor = new AicEditor(container, {
    initialText: note.text,
    readOnly: readOnly(),
    onChange: (value) => {
      if (mounted === lifecycle) edit(value);
    },
    onSave: () => (mounted === lifecycle ? save() : false),
    onOpenTarget: (target) => {
      if (URL_TARGET.test(target)) window.open(target, "_blank", "noopener");
    },
    // A browser cannot open a file path: the card shows the path only.
    canOpenTarget: (target) => URL_TARGET.test(target),
  });
  editor.switchDocument("note", note.text);
  aiControls = attachLocalAI(editor.toolbar?.element ?? container, {
    compact: true,
    editor,
    identity: () => `note/${mounted}`,
    isReadonly: readOnly,
    onNotice: notify,
  });
  if (note.access === "reconnect")
    notify(
      `This is the last copy saved in this browser. Reconnect ${note.name} to edit it.`,
    );
  reflect();
}

function edit(text: string) {
  if (readOnly()) return;
  draft = text;
  dirty = text !== note.text;
  saveFailed = false;
  reflect();
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = dirty
    ? setTimeout(() => {
        autosaveTimer = null;
        void save();
      }, 600)
    : null;
}

async function save(): Promise<boolean> {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (saveTask) return saveTask;
  if (!dirty || conflict) return !dirty;
  const text = draft;
  const started = lifecycle;
  saveTask = (async () => {
    try {
      const warning = await note.save(text);
      if (started !== lifecycle) return false;
      dirty = draft !== note.text;
      saveFailed = false;
      notify(warning ?? "");
      return !dirty;
    } catch (error) {
      if (started !== lifecycle) return false;
      saveFailed = true;
      conflict = /changed outside/u.test(String(error));
      notify(error instanceof Error ? error.message : "Save failed.", true);
      return false;
    } finally {
      saveTask = null;
      if (started === lifecycle) {
        reflect();
        if (dirty && !saveFailed)
          autosaveTimer = setTimeout(() => void save(), 600);
      }
    }
  })();
  reflect();
  return saveTask;
}

async function choose(create: boolean) {
  if (await note.choose(create)) {
    notify("");
    render();
  }
}

/** Another file (or, without file access, another file's text) becomes the note. */
async function openOther() {
  if (
    !canBindFile() &&
    !confirm(
      "Replace the note in this browser with a file? Download the note first to keep its text.",
    )
  )
    return;
  if (!(await save()) && !confirm("Discard the unsaved draft?")) return;
  await choose(false);
}

async function fix() {
  if (note.access === "reconnect" || conflict) {
    if (
      conflict &&
      !confirm(
        `Replace your draft with the text in ${note.name}? Download the note first to keep the draft.`,
      )
    )
      return;
    // The permission prompt needs this click, so it comes first.
    await note.reconnect();
    notify("");
    render();
  } else await save();
}

window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});
window.addEventListener("pagehide", (event) => {
  appUpdates?.suspend(event.persisted);
  void save();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) appUpdates?.resume();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompts.offer(event as InstallPrompt);
});
window.addEventListener("appinstalled", () => {
  installPrompts.consume();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void run(save);
  }
});

async function start() {
  try {
    await note.load();
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "The note could not be read.",
      true,
    );
  }
  render();
  if (
    /^https?:$/u.test(location.protocol) &&
    "serviceWorker" in navigator &&
    import.meta.env.PROD
  ) {
    appUpdates = new AppUpdateLifecycle(navigator.serviceWorker, {
      canReload: () => !dirty && !saveFailed && !saveTask && !working,
      reload: () => location.reload(),
      onError: (message) => notify(message, true),
      onState: (state) => {
        const label =
          state === "installing"
            ? "Downloading…"
            : state === "activating"
              ? "Updating…"
              : state === "reload"
                ? "Reload app update"
                : "Update app";
        updateButton.hidden = state === "none";
        updateButton.disabled =
          state === "installing" || state === "activating";
        updateButton.textContent = label;
        updateButton.setAttribute("aria-label", label);
      },
    });
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    appUpdates.attach(registration);
    // Updates are checked by the browser and on focus, never against a notes server.
    window.addEventListener("focus", () => {
      void registration.update().catch(() => {});
    });
  }
}
void start().catch((error: unknown) =>
  notify(
    error instanceof Error ? error.message : "AIC Notes did not start.",
    true,
  ),
);
