import {
  AppUpdateLifecycle,
  OneShotInstallPrompt,
  type InstallPrompt,
} from "./app-lifecycle";
import { AicEditor } from "../editor";
import { createScopeTabs, type ScopeTabs } from "../core/scope-tabs.js";
import { scopedNotes, type NoteScope, type ScopedNote } from "./note-scopes";
import { attachLocalAI, type LocalAIControls } from "./ai-controls";
import logoUrl from "../../public/aic-logo.svg?url";
import { createUiButton, applyUiComponent } from "../core/ui-system.js";
import { PwaRepository } from "./controller";
import { MemoryPwaPersistence } from "./storage";
import { validateEnvelope } from "../browser/vault-crypto";
import { validateDomainProperties } from "../browser/library";
import { getVsCodeSource } from "./vscode-host";
import {
  openEncryptedSource,
  createEncryptedSource,
  rememberSource,
  reopenSource,
  requestSourcePermission,
  IndexedDbSourceBindings,
  type EncryptedSource,
} from "./source";
import {
  createPwaFile,
  createWorkspace,
  serializePayload,
  validatePayload,
  fileText,
  type PwaPayload,
  type PwaFile,
} from "./model";
import {
  pickFiles,
  pickFolder,
  isMarkdownPath,
  retainEmptyDirectories,
  exportPlainFile,
  restoreFolder,
  type PickedFiles,
} from "./files";
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
const hostSource = getVsCodeSource();
const repository = new PwaRepository(
  hostSource ? new MemoryPwaPersistence() : undefined,
);
const sources = new Map<
  string,
  { source: EncryptedSource; expected: string }
>();
const disconnectedSources = new Set<string>();
const cancelDialogs = new Set<() => void>();
let activeId: string | null = null;
let localWorkspace = false;
let payload: PwaPayload | null = null;
let selectedId: string | null = null;
let dirty = false;
let working = false;
let generation = 0;
let lifecycle = 0;
let editor: AicEditor | null = null;
let aiControls: LocalAIControls | null = null;
let textArea: HTMLTextAreaElement | null = null;
let activeScope: NoteScope = "current";
let scopeTabs: ScopeTabs | null = null;
const scopeEditors = new Map<
  NoteScope,
  { editor: AicEditor; ai: LocalAIControls; panel: HTMLElement }
>();
const expandedFolders = new Map<string, boolean>();
let saveTask: Promise<boolean> | null = null;
let saveFailed = false;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let mountedIdentity: string | null = null;
let screen: "browser" | "editor" = "browser";
let registration: ServiceWorkerRegistration | null = null;
let opening: AbortController | null = null;
let fileQuery = "";
let visibleFileCount = 100;
let listedWorkspace: string | null = null;
let appUpdates: AppUpdateLifecycle | null = null;
let lastUsed = Date.now();

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
  text = label,
  options: {
    icon?: string;
    iconOnly?: boolean;
    variant?: "default" | "ghost" | "danger" | "primary";
  } = {},
) {
  const control = createUiButton(document, {
    label,
    variant: "ghost",
    text: options.iconOnly ? "" : text,
    size: options.iconOnly ? "touch" : "normal",
    ...options,
  });
  control.addEventListener("click", () => {
    if (
      [
        "Note options",
        "Workspace options",
        "Help and about",
        "Note details",
        "Open notes",
        "Close menu",
        "Browse notes",
        "Close notes browser",
      ].includes(label)
    ) {
      void action();
    } else void run(action);
  });
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
const status = element("span", "pwa-status", "On this device");
const updateButton = button("Update app", async () => {
  if (!(await save())) return;
  if (dirty) return;
  // Activation is deferred until run releases its editing lock.
  requestAppActivation = true;
});
updateButton.hidden = true;
updateButton.classList.add("pwa-header__update");
const installButton = button("Install AIC Notes", async () => {
  const prompt = installPrompts.consume();
  if (prompt) await prompt.prompt();
});
installButton.hidden = true;
const installPrompts = new OneShotInstallPrompt((available) => {
  installButton.hidden = !available;
});
let requestAppActivation = false;
const cancelOpenButton = createUiButton(document, {
  label: "Cancel folder opening",
  text: "Cancel opening",
});
cancelOpenButton.hidden = true;
cancelOpenButton.addEventListener("click", () => opening?.abort());
const help = element("nav", "pwa-help");
help.setAttribute("aria-label", "About AIC Notes");
const publicOrigin = /^https?:$/u.test(location.protocol)
  ? location.origin
  : "https://aic.dzyha.com";
for (const [label, path] of [
  ["Terms", "/terms"],
  ["Releases", "/releases"],
  ["How to", "/how-to"],
]) {
  const link = element("a", "pwa-help__link", label);
  link.href = new URL(path!, publicOrigin).href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  help.append(link);
}
header.append(
  brand,
  button(
    "Help and about",
    () =>
      showSheet(
        "Help and about",
        [...help.children].map((link) => link.cloneNode(true) as HTMLElement),
      ),
    "",
    { icon: "help", iconOnly: true },
  ),
  updateButton,
  installButton,
  cancelOpenButton,
);
const notice = applyUiComponent(element("div", "pwa-notice"), "notice", [
  "info",
]);
notice.setAttribute("role", "status");
notice.setAttribute("aria-live", "polite");
notice.hidden = true;
const layout = element("div", "pwa-layout");
const sidebar = element("aside", "pwa-sidebar");
sidebar.setAttribute("aria-label", "Notes browser");
const entityHeader = element("div", "pwa-sidebar__heading");
entityHeader.append(
  element("strong", "", "Workspaces"),
  button("Workspace options", openWorkspaceOptions, "", {
    icon: "workspace",
    iconOnly: true,
  }),
);
const workspaceSelect = applyUiComponent(
  element("select", "pwa-workspace-select"),
  "field",
  [],
  "control",
);
workspaceSelect.setAttribute("aria-label", "Choose workspace");
workspaceSelect.addEventListener("change", () => {
  const [kind, id] = workspaceSelect.value.split(":");
  if (id)
    void run(() =>
      kind === "local" ? selectLocalWorkspace(id) : selectEntity(id),
    );
});
const entities = element("nav", "pwa-entities");
entities.hidden = true;
entities.setAttribute("aria-label", "Workspaces");
const importButton = button("Open encrypted file", importEncrypted);
const protectedButton = button(
  "Create protected workspace",
  createEntity,
  "New protected workspace",
);
const fileHeading = element("strong", "pwa-file-heading", "Notes");
const fileFilter = applyUiComponent(
  element("input", "pwa-files__filter"),
  "field",
  [],
  "control",
);
fileFilter.type = "search";
fileFilter.placeholder = "Search notes…";
fileFilter.setAttribute("aria-label", "Find Markdown file");
fileFilter.autocomplete = "off";
fileFilter.hidden = true;
fileFilter.addEventListener("input", () => {
  fileQuery = fileFilter.value;
  visibleFileCount = 100;
  renderFileNavigation();
});
const fileSummary = element("span", "pwa-files__summary");
fileSummary.hidden = true;
fileSummary.setAttribute("role", "status");
fileSummary.setAttribute("aria-live", "polite");
const fileList = element("nav", "pwa-files");
fileList.setAttribute("aria-label", "Notes");
sidebar.append(
  entityHeader,
  workspaceSelect,
  entities,
  fileHeading,
  fileFilter,
  fileSummary,
  fileList,
);
const content = element("section", "pwa-content");
const actions = element("div", "pwa-actions");
const title = element("h1", "pwa-title", "Start editing");
const details = element("p", "pwa-details");
const noteHeader = element("div", "pwa-note-header");
const backButton = button("Browse notes", showNotesBrowser, "", {
  icon: "folder",
  iconOnly: true,
});
const titleButton = button("Rename note", renameNote, "");
titleButton.classList.add("pwa-note-header__title");
titleButton.append(title);
const headerNewNote = button("New note", newNote, "", {
  icon: "note-add",
  iconOnly: true,
});
const retryButton = button("Retry save", save, "Retry");
retryButton.hidden = true;
const noteMore = button("Note options", () => showNoteOptions(), "", {
  icon: "more",
  iconOnly: true,
});
noteHeader.append(
  backButton,
  titleButton,
  status,
  retryButton,
  headerNewNote,
  noteMore,
);
const browserActions = element("div", "pwa-browser-actions");
browserActions.append(
  button("New note", newNote, "New note", {
    icon: "note-add",
    variant: "primary",
  }),
  button("Open files", () => openFiles(), "Files", { icon: "document" }),
  button("Open folder", () => openFiles(true), "Folder", {
    icon: "folder",
  }),
);
sidebar.insertBefore(browserActions, fileHeading);
const editorContainer = element("div", "pwa-editor");
content.append(noteHeader, details, actions, editorContainer);
layout.append(sidebar, content);
app.append(header, notice, layout);
root.append(app);

const phoneLayout = window.matchMedia("(max-width: 700px)");
let notesDrawer: HTMLDialogElement | null = null;
let drawerOrigin: HTMLElement | null = null;
let drawerHistoryClosing = false;
function retireNotesDrawer() {
  closeNotesDrawer(false, false);
}
function closeNotesDrawer(restoreFocus = true, consumeHistory = true) {
  const dialog = notesDrawer;
  if (!dialog) return;
  notesDrawer = null;
  cancelDialogs.delete(retireNotesDrawer);
  layout.insertBefore(sidebar, content);
  dialog.close();
  dialog.remove();
  if (consumeHistory && history.state?.aicNotesDrawer) {
    drawerHistoryClosing = true;
    history.back();
  }
  if (restoreFocus && drawerOrigin?.isConnected) drawerOrigin.focus();
  drawerOrigin = null;
  editor?.view?.requestMeasure();
}
function showNotesBrowser() {
  if (!phoneLayout.matches) {
    screen = "browser";
    reflectScreen();
    if (!fileFilter.hidden) fileFilter.focus();
    else if (!workspaceSelect.hidden) workspaceSelect.focus();
    return;
  }
  if (notesDrawer) return;
  drawerOrigin = document.activeElement as HTMLElement | null;
  const dialog = element("dialog", "pwa-notes-drawer");
  dialog.setAttribute("aria-label", "Notes browser");
  const heading = element("div", "pwa-notes-drawer__heading");
  const close = button("Close notes browser", () => closeNotesDrawer(), "", {
    icon: "close",
    iconOnly: true,
  });
  close.classList.add("pwa-notes-drawer__close");
  heading.append(element("h2", "", "Notes"), close);
  dialog.append(heading, sidebar);
  notesDrawer = dialog;
  cancelDialogs.add(retireNotesDrawer);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeNotesDrawer();
  });
  document.body.append(dialog);
  history.pushState({ aicNotesScreen: screen, aicNotesDrawer: true }, "");
  dialog.showModal();
  if (!fileFilter.hidden) fileFilter.focus();
  else if (!workspaceSelect.hidden && workspaceSelect.options.length)
    workspaceSelect.focus();
  else close.focus();
}
phoneLayout.addEventListener("change", () => {
  if (!phoneLayout.matches) closeNotesDrawer(false);
});

function notify(message: string, error = false) {
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle("aic-notice--error", error);
}
function reflectScreen() {
  if (!payload || !selectedId) screen = "browser";
  if (screen === "editor" && app.dataset.screen === "browser" && selectedId)
    history.pushState({ aicNotesScreen: "editor" }, "");
  app.dataset.screen = screen;
  app.dataset.hasNote = String(!!selectedId);
  backButton.hidden = !selectedId;
  noteMore.hidden = !selectedId;
  headerNewNote.hidden = !selectedId || payload?.kind !== "workspace";
  titleButton.disabled = !selectedFile();
  if (selectedFile()) {
    titleButton.setAttribute("aria-label", "Rename note");
    titleButton.title = "Rename note";
  } else {
    titleButton.removeAttribute("aria-label");
    titleButton.removeAttribute("title");
  }
  browserActions.hidden = !payload && app.dataset.hasWorkspaces !== "true";
  for (const control of browserActions.querySelectorAll<HTMLButtonElement>(
    "button",
  ))
    control.hidden =
      !payload &&
      !["New note", "Open files", "Open folder", "Workspace options"].includes(
        control.getAttribute("aria-label") ?? "",
      );
  if (screen === "editor") editor?.view?.requestMeasure();
}
function reflectSave() {
  editor?.setSaveState(
    dirty ? "dirty" : "saved",
    !!saveTask,
    saveTask ? "saving" : saveFailed ? "failed" : dirty ? "dirty" : "none",
  );
  const destination = localWorkspace
    ? "Saved on this device"
    : activeId && sources.has(activeId)
      ? "Saved to encrypted file"
      : "Saved on this device";
  status.dataset.state = saveTask
    ? "saving"
    : saveFailed
      ? "failed"
      : dirty
        ? "dirty"
        : "saved";
  status.textContent = saveTask
    ? "Saving…"
    : saveFailed
      ? "Save failed"
      : dirty
        ? "Unsaved"
        : "Saved";
  status.title = saveTask
    ? "Saving…"
    : saveFailed
      ? "Save failed"
      : dirty
        ? "Unsaved changes"
        : destination;
  status.setAttribute("aria-label", status.title);
  retryButton.hidden = !saveFailed;
}
function showSheet(
  heading: string,
  controls: HTMLElement[],
  focusOrigin = document.activeElement as HTMLElement | null,
) {
  const origin = focusOrigin;
  const dialog = element("dialog", "pwa-dialog pwa-sheet");
  dialog.setAttribute("aria-label", heading);
  dialog.append(element("h2", "", heading), ...controls);
  const cancel = () => {
    cancelDialogs.delete(cancel);
    dialog.close();
    dialog.remove();
    if (origin?.isConnected) origin.focus();
  };
  cancelDialogs.add(cancel);
  dialog.append(button("Close menu", cancel, "Done"));
  dialog.addEventListener("cancel", cancel);
  dialog.addEventListener(
    "click",
    (event) => {
      if (
        (event.target as HTMLElement)
          .closest("button")
          ?.getAttribute("aria-label") !== "Close menu" &&
        (event.target as HTMLElement).closest("button")
      )
        cancel();
    },
    { capture: true },
  );
  document.body.append(dialog);
  dialog.showModal();
}
function showNoteOptions() {
  const file = selectedFile();
  showSheet("Note options", [
    ...(file
      ? [
          button("Rename note", renameNote),
          button(
            "Advanced note path",
            () => renameNote(true),
            "Change relative path",
          ),
          button("Export Markdown", () => exportPlainFile(file)),
        ]
      : []),
    button("Note details", () =>
      showSheet("Note details", [
        element("p", "", details.textContent ?? ""),
        element(
          "p",
          "",
          "Local workspace saves do not update original files or Drive. Export Markdown or all notes to copy changes back. Built-in AI, when available, runs on this device; writing works without it.",
        ),
      ]),
    ),
  ]);
}
function openWorkspaceOptions() {
  const openedFromDrawer = !!notesDrawer;
  if (openedFromDrawer) closeNotesDrawer(false);
  showWorkspaceOptions(openedFromDrawer ? backButton : undefined);
}
function showWorkspaceOptions(focusOrigin?: HTMLElement | null) {
  const workspaceActions = !hostSource
    ? [
        button("New workspace", createLocalWorkspace, "New workspace", {
          icon: "workspace",
        }),
        importButton,
        protectedButton,
      ]
    : [];
  if (!payload) {
    showSheet("Workspace options", workspaceActions, focusOrigin);
    return;
  }
  showSheet(
    "Workspace options",
    [
      ...workspaceActions,
      button("Rename workspace", renameEntity),
      ...(payload.kind === "workspace"
        ? [
            button("Add files", () => addFiles()),
            button("Add folder", () => addFiles(true)),
            button("Export all notes", restore),
          ]
        : []),
      ...(localWorkspace
        ? [button("Save encrypted copy", encryptWorkspace)]
        : [
            button(
              "Export encrypted copy",
              encryptedExport,
              "Export encrypted copy",
            ),
            ...(!hostSource
              ? [button("Save encrypted file", saveEncryptedAs)]
              : []),
            ...(activeId && sources.has(activeId)
              ? [button("Reopen shared file", reloadSource)]
              : []),
          ]),
      button(localWorkspace ? "Close workspace" : "Lock workspace", lockAll),
      ...(localWorkspace
        ? [
            element("hr"),
            button(
              "Remove local workspace",
              removeLocalWorkspace,
              "Remove from this device…",
              { variant: "danger" },
            ),
          ]
        : []),
    ],
    focusOrigin,
  );
}
async function run(action: () => void | Promise<unknown>) {
  if (working) return;
  const started = lifecycle;
  working = true;
  editor?.setReadOnly(true);
  if (textArea) textArea.disabled = true;
  app.setAttribute("aria-busy", "true");
  try {
    await action();
  } catch (error) {
    if (started !== lifecycle) return;
    notify(
      error instanceof Error
        ? error.message
        : "This action could not finish. Your saved files are unchanged.",
      true,
    );
  } finally {
    working = false;
    editor?.setReadOnly(false);
    if (textArea) textArea.disabled = false;
    app.removeAttribute("aria-busy");
    reflectSave();
    if (requestAppActivation) {
      requestAppActivation = false;
      appUpdates?.activate();
    }
    appUpdates?.reconsider();
  }
}

type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "password";
  optional?: boolean;
  value?: string;
};
function ask(
  title: string,
  specs: FieldSpec[],
  submitText: string,
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dialog = element("dialog", "pwa-dialog");
    const form = element("form");
    form.append(element("h2", "", title));
    for (const spec of specs) {
      const label = applyUiComponent(
        element("label", "pwa-dialog__field"),
        "field",
      );
      label.append(
        applyUiComponent(element("span", "", spec.label), "field", [], "label"),
      );
      const input = applyUiComponent(element("input"), "field", [], "control");
      input.name = spec.name;
      input.type = spec.type ?? "text";
      input.required = !spec.optional;
      input.value = spec.value ?? "";
      if (spec.type === "password") {
        input.autocomplete = "off";
        input.spellcheck = false;
      }
      label.append(input);
      form.append(label);
    }
    const footer = element("div", "pwa-dialog__actions");
    const cancel = createUiButton(document, { label: "Cancel" });
    const submit = createUiButton(document, { label: submitText });
    submit.type = "submit";
    footer.append(cancel, submit);
    form.append(footer);
    dialog.append(form);
    document.body.append(dialog);
    let settled = false;
    const finish = (value: Record<string, string> | null) => {
      if (settled) return;
      settled = true;
      cancelDialogs.delete(cancelDialog);
      for (const input of form.querySelectorAll("input")) input.value = "";
      dialog.close();
      dialog.remove();
      if (screen === "editor") editor?.view?.focus();
      else fileFilter.focus();
      resolve(value);
    };
    const cancelDialog = () => finish(null);
    cancelDialogs.add(cancelDialog);
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", () => finish(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(
        Object.fromEntries(new FormData(form).entries()) as Record<
          string,
          string
        >,
      );
    });
    dialog.showModal();
  });
}

async function refreshEntities() {
  const started = lifecycle;
  const [records, localRecords] = await Promise.all([
    repository.list(),
    hostSource ? Promise.resolve([]) : repository.listLocal(),
  ]);
  if (started !== lifecycle) return false;
  app.dataset.hasWorkspaces = String(records.length + localRecords.length > 0);
  entities.replaceChildren();
  workspaceSelect.replaceChildren();
  const placeholder = element("option", "", "Choose workspace…");
  placeholder.value = "";
  workspaceSelect.append(placeholder);
  for (const [index, record] of localRecords.entries()) {
    const name = record.payload.label || `Workspace ${index + 1}`;
    const row = button(
      `Open ${name}`,
      () => selectLocalWorkspace(record.id),
      `${name} · unencrypted`,
    );
    row.classList.add("pwa-entities__item");
    row.setAttribute(
      "aria-current",
      String(localWorkspace && record.id === activeId),
    );
    entities.append(row);
    const option = element("option", "", name);
    option.value = `local:${record.id}`;
    option.selected = localWorkspace && record.id === activeId;
    workspaceSelect.append(option);
  }
  for (const [index, record] of records.entries()) {
    const unlocked = repository.snapshot(record.id);
    const name = unlocked?.label || `Protected workspace ${index + 1}`;
    const row = button(
      `Open ${name}`,
      () => selectEntity(record.id),
      `${unlocked ? "◦" : "⌑"} ${name}`,
    );
    row.classList.add("pwa-entities__item");
    row.setAttribute(
      "aria-current",
      String(!localWorkspace && record.id === activeId),
    );
    entities.append(row);
    const option = element("option", "", name);
    option.value = `protected:${record.id}`;
    option.selected = !localWorkspace && record.id === activeId;
    workspaceSelect.append(option);
  }
  fileHeading.hidden = !payload;
  return true;
}
function activateLocal(
  id: string,
  next: PwaPayload,
  selection: string | null = null,
) {
  activeId = id;
  localWorkspace = true;
  payload = next;
  selectedId = selection;
  screen = selection ? "editor" : "browser";
  if (selection) closeNotesDrawer(false);
  saveFailed = false;
  dirty = false;
}
async function createLocalWorkspace() {
  const started = lifecycle;
  if (hostSource || !(await save()) || started !== lifecycle) return;
  const record = await repository.createLocal();
  if (started !== lifecycle) return;
  activateLocal(record.id, record.payload);
  if (!(await refreshEntities())) return;
  renderContent();
}
async function selectLocalWorkspace(id: string) {
  const started = lifecycle;
  if (!(await save()) || started !== lifecycle) return;
  const next = await repository.readLocal(id);
  if (started !== lifecycle) return;
  activateLocal(id, next);
  if (!(await refreshEntities())) return;
  renderContent();
}
async function chooseMarkdown(folder: boolean): Promise<PickedFiles | null> {
  const controller = new AbortController();
  const started = lifecycle;
  opening = controller;
  cancelOpenButton.hidden = false;
  notify(
    folder
      ? "Choose a folder to open Markdown notes…"
      : "Choose Markdown files…",
  );
  try {
    const options = {
      markdownOnly: true,
      signal: controller.signal,
      onProgress: (progress: {
        phase: "scanning" | "reading";
        scanned: number;
        selected: number;
        read: number;
        total?: number;
      }) => {
        if (
          opening !== controller ||
          controller.signal.aborted ||
          started !== lifecycle
        )
          return;
        notify(
          progress.phase === "scanning"
            ? `Looking for Markdown… ${progress.scanned} entries checked · ${progress.selected} notes found`
            : `Reading Markdown… ${progress.read} of ${progress.total ?? progress.selected} notes`,
        );
      },
    };
    // Call the picker before any await to preserve browser user activation.
    const result = folder
      ? await pickFolder(options)
      : await pickFiles(options);
    if (controller.signal.aborted || started !== lifecycle) return null;
    if (!result) {
      notice.textContent = "";
      notice.hidden = true;
    }
    return result;
  } finally {
    if (opening === controller) {
      opening = null;
      cancelOpenButton.hidden = true;
      if (controller.signal.aborted && started === lifecycle)
        notify("Opening canceled. Your current notes are unchanged.");
    }
  }
}
async function openFiles(folder = false) {
  const started = lifecycle;
  if (hostSource) return;
  // Picker invocation must happen before any async save/dialog.
  const picked = await chooseMarkdown(folder);
  if (!picked || !(await save()) || started !== lifecycle) return;
  if (!picked.files.length) {
    notify("This selection contains no .md files.");
    return;
  }
  const candidate = {
    ...createWorkspace(
      folder
        ? (picked.directories[0] ?? picked.files[0]?.path.split("/")[0])
        : undefined,
    ),
    ...picked,
  };
  notify("Saving the Markdown workspace on this device…");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (started !== lifecycle) return;
  serializePayload(candidate);
  const record = await repository.createLocal(undefined, candidate);
  if (started !== lifecycle) return;
  activateLocal(record.id, record.payload, picked.files[0]?.id ?? null);
  if (!(await refreshEntities())) return;
  renderContent();
  notify(
    "Markdown files opened without encryption. Changes save on this device; export copies to update your files.",
  );
}
async function encryptWorkspace() {
  const started = lifecycle;
  if (
    !localWorkspace ||
    payload?.kind !== "workspace" ||
    !(await save()) ||
    started !== lifecycle
  )
    return;
  const answer = await ask(
    "Create an encrypted copy. The unencrypted workspace stays on this device until you remove it.",
    [
      {
        name: "password",
        label: "Passphrase (at least 12 characters)",
        type: "password",
      },
      { name: "confirm", label: "Repeat passphrase", type: "password" },
    ],
    "Create encrypted copy",
  );
  if (!answer) return;
  if (answer.password !== answer.confirm)
    throw new Error("The passphrases do not match.");
  if (started !== lifecycle || payload?.kind !== "workspace") return;
  const record = await repository.create(
    answer.password ?? "",
    payload.label,
    payload,
  );
  if (started !== lifecycle) return;
  activeId = record.id;
  localWorkspace = false;
  payload = repository.snapshot(record.id);
  dirty = false;
  saveFailed = false;
  if (!(await refreshEntities())) return;
  renderContent();
  notify(
    "Encrypted copy created. Save an encrypted file for transfer, or remove the original local workspace from this device.",
  );
}
async function removeLocalWorkspace() {
  if (!localWorkspace || !activeId) return;
  const answer = await ask(
    "Remove this unencrypted workspace from this device? Unsaved changes will be removed too. Original files are unchanged.",
    [],
    "Remove workspace",
  );
  if (!answer) return;
  await repository.removeLocal(activeId);
  closeNotesDrawer(false);
  activeId = null;
  localWorkspace = false;
  payload = null;
  selectedId = null;
  dirty = false;
  saveFailed = false;
  if (!(await refreshEntities())) return;
  renderContent();
}
async function createEntity() {
  if (!(await save())) return;
  if (hostSource && (await hostSource.read()))
    throw new Error(
      "This editor already owns an encrypted file. Reopen it with its passphrase.",
    );
  const answer = await ask(
    "Create a protected workspace",
    [
      { name: "label", label: "Name (optional)", optional: true },
      {
        name: "password",
        label: "Passphrase (at least 12 characters)",
        type: "password",
      },
      { name: "confirm", label: "Repeat passphrase", type: "password" },
    ],
    "Create protected workspace",
  );
  if (!answer) return;
  if (answer.password !== answer.confirm)
    throw new Error("The passphrases do not match.");
  const record = await repository.create(answer.password ?? "", answer.label);
  activeId = record.id;
  localWorkspace = false;
  payload = repository.snapshot(record.id);
  selectedId = null;
  dirty = false;
  if (hostSource) {
    sources.set(record.id, { source: hostSource, expected: "" });
    dirty = true;
    await save();
  }
  if (!(await refreshEntities())) return;
  renderContent();
  void navigator.storage?.persist?.().catch(() => false);
}
async function selectEntity(id: string) {
  if (!(await save())) return;
  if (!sources.has(id) && !hostSource) {
    try {
      const remembered = await reopenSource(id);
      if (remembered) {
        const text = await remembered.read();
        const saved = await repository.exportEncrypted(id);
        if (JSON.stringify(validateEnvelope(JSON.parse(text))) !== saved) {
          await openSource(remembered, text, id);
          return;
        }
        sources.set(id, { source: remembered, expected: text });
      } else if (await new IndexedDbSourceBindings().read(id)) {
        disconnectedSources.add(id);
        notify(
          "Reconnect this workspace's shared file before saving, or export an encrypted copy.",
          true,
        );
      }
    } catch {
      disconnectedSources.add(id);
      notify(
        "The shared file is unavailable. You can unlock its cached copy and export an encrypted backup.",
        true,
      );
    }
  }
  let next = repository.snapshot(id);
  if (!next) {
    const answer = await ask(
      "Unlock workspace",
      [{ name: "password", label: "Passphrase", type: "password" }],
      "Unlock",
    );
    if (!answer) return;
    next = await repository.unlock(id, answer.password ?? "");
  }
  activeId = id;
  localWorkspace = false;
  payload = next;
  selectedId = null;
  dirty = false;
  saveFailed = false;
  if (!(await refreshEntities())) return;
  renderContent();
}
async function importEncrypted() {
  if (hostSource) {
    await reloadSource();
    return;
  }
  if ("showOpenFilePicker" in window) {
    const source = await openEncryptedSource();
    if (!source) return;
    await requestSourcePermission(source);
    const text = await source.read();
    if (
      activeId &&
      dirty &&
      disconnectedSources.has(activeId) &&
      JSON.stringify(validateEnvelope(JSON.parse(text))) ===
        JSON.stringify(
          validateEnvelope(
            JSON.parse(
              sources.get(activeId)?.expected ??
                (await repository.exportEncrypted(activeId)),
            ),
          ),
        )
    ) {
      sources.set(activeId, { source, expected: text });
      disconnectedSources.delete(activeId);
      await rememberSource(activeId, source);
      await save();
      return;
    }
    if (!(await prepareOpen())) return;
    await openSource(source, text);
    return;
  }
  const input = element("input");
  input.type = "file";
  input.accept = ".json,.aic,.aicnotes";
  const file = await new Promise<File | null>((resolve) => {
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  if (!file) return;
  if (!(await prepareOpen())) return;
  if (file.size > 9 * 1024 * 1024)
    throw new Error("Encrypted bundles are limited to 9 MiB.");
  await openSource(null, await file.text());
}
async function prepareOpen(): Promise<boolean> {
  if (await save()) return true;
  return !!(await ask(
    "Discard the unsaved draft and open another file? Export an encrypted copy first to keep it.",
    [],
    "Discard and open",
  ));
}
async function openSource(
  source: EncryptedSource | null,
  text: string,
  existingId?: string,
) {
  const envelope = validateEnvelope(JSON.parse(text));
  const records = await repository.list();
  const id =
    existingId ??
    records.find((record) => record.envelope.kdf.salt === envelope.kdf.salt)
      ?.id;
  const answer = await ask(
    "Open encrypted file",
    [{ name: "password", label: "Passphrase", type: "password" }],
    "Unlock",
  );
  if (!answer) return;
  const record = await repository.importEncrypted(
    text,
    answer.password ?? "",
    id,
  );
  if (source) {
    sources.set(record.id, { source, expected: text });
    disconnectedSources.delete(record.id);
    if (!hostSource) {
      try {
        await rememberSource(record.id, source);
      } catch {
        notify(
          "The file is connected for this session. Select it again after restarting the browser.",
        );
      }
    }
  }
  activeId = record.id;
  localWorkspace = false;
  payload = repository.snapshot(record.id);
  selectedId = null;
  dirty = false;
  saveFailed = false;
  if (!(await refreshEntities())) return;
  renderContent();
  notify(
    record.cacheWarning
      ? `File opened; device cache could not be updated. ${record.cacheWarning}`
      : source
        ? "Shared encrypted file opened. AIC leaves synchronization to you."
        : "Encrypted content opened in the local cache. Export a file to transfer changes.",
  );
}
async function reloadSource() {
  const bound = activeId ? sources.get(activeId)?.source : hostSource;
  if (!bound) return;
  if (dirty) {
    const answer = await ask(
      "Discard unsaved changes and reopen the shared file? Export an encrypted copy first if you need this draft.",
      [],
      "Discard and reopen",
    );
    if (!answer) return;
  }
  const text = await bound.read();
  if (!text) return;
  await openSource(bound, text, activeId ?? undefined);
}
async function saveEncryptedAs() {
  const started = lifecycle;
  if (!activeId || !payload) return;
  if (!("showSaveFilePicker" in window)) {
    await encryptedExport();
    return;
  }
  const source = await createEncryptedSource();
  if (!source || started !== lifecycle || !activeId || !payload) return;
  const current = await source.read();
  if (started !== lifecycle || !activeId || !payload) return;
  if (
    current &&
    JSON.stringify(validateEnvelope(JSON.parse(current))) !==
      JSON.stringify(
        validateEnvelope(
          JSON.parse(
            sources.get(activeId)?.expected ??
              (await repository.exportEncrypted(activeId)),
          ),
        ),
      )
  ) {
    throw new Error(
      "That file contains different data. Open it to read its latest version, or choose a new empty file.",
    );
  }
  const id = activeId;
  const next = structuredClone(payload);
  const savedGeneration = generation;
  const result = await repository.saveToSource(id, next, (text) =>
    source.write(text, current),
  );
  if (started !== lifecycle) return;
  sources.set(id, { source, expected: result.ciphertext });
  disconnectedSources.delete(id);
  if (
    activeId === id &&
    generation === savedGeneration &&
    JSON.stringify(payload) === JSON.stringify(next)
  )
    dirty = false;
  try {
    await rememberSource(id, source);
  } catch {
    /* The acknowledged source remains authoritative. */
  }
  if (started !== lifecycle) return;
  saveFailed = false;
  reflectSave();
  notify(
    result.cacheWarning
      ? `Shared file saved; device cache could not be updated. ${result.cacheWarning}`
      : "Encrypted file saved. Your sync service can now transfer this same file.",
  );
}

function clearEditor() {
  generation += 1;
  mountedIdentity = null;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  scopeTabs?.dispose();
  scopeTabs = null;
  for (const item of scopeEditors.values()) {
    item.ai.dispose();
    item.editor.destroy();
  }
  scopeEditors.clear();
  activeScope = "current";
  aiControls = null;
  editor = null;
  textArea = null;
  editorContainer.replaceChildren();
}
function selectedScopeNote(
  scope: NoteScope = activeScope,
): ScopedNote | undefined {
  return payload && selectedId
    ? scopedNotes(payload, selectedId)[scope]
    : undefined;
}
function selectedFile(): PwaFile | undefined {
  return selectedScopeNote()?.file;
}
function updateText(text: string, scope: NoteScope = activeScope) {
  if (!payload || !selectedId) return;
  const scoped = selectedScopeNote(scope);
  if (!scoped) return;
  if (payload.kind === "workspace") {
    const file = scoped.file;
    if (!file) return;
    const replacement = createPwaFile(
      file.path,
      new TextEncoder().encode(text),
      file.mediaType,
      Date.now(),
    );
    Object.assign(file, replacement, { id: file.id });
  } else {
    const note =
      scope === "current"
        ? payload.library.notes.find((note) => note.id === scoped.id)
        : scope === "shared"
          ? payload.library.domains.find((note) => note.id === scoped.id)
          : payload.library.global;
    if (!note || note.id !== scoped.id) return;
    note.markdown = text;
    note.updatedAt = Date.now();
    note.revision += 1;
  }
  dirty = true;
  saveFailed = false;
  reflectSave();
  if (localWorkspace) {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void save();
    }, 600);
  }
}
async function save(): Promise<boolean> {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (saveTask) return saveTask;
  if (!dirty || !activeId || !payload) return true;
  const id = activeId;
  const next = structuredClone(payload);
  const savedGeneration = generation;
  const saveLifecycle = lifecycle;
  const savingLocal = localWorkspace;
  const savingSharedText =
    payload.kind === "browser-library" && activeScope !== "current"
      ? selectedScopeNote()?.markdown
      : undefined;
  const task = Promise.resolve().then(async () => {
    try {
      if (savingSharedText !== undefined)
        validateDomainProperties(savingSharedText);
      if (savingLocal && next.kind === "workspace") {
        await repository.updateLocal(id, next);
      } else {
        const bound = sources.get(id);
        if (disconnectedSources.has(id))
          throw new Error(
            "Reconnect the shared file before saving, or export an encrypted copy of this draft.",
          );
        if (bound) {
          if (!(await requestSourcePermission(bound.source)))
            throw new Error("Allow access to the shared file before saving.");
          if (saveLifecycle !== lifecycle) return false;
          const result = await repository.saveToSource(id, next, (text) =>
            bound.source.write(text, bound.expected),
          );
          if (saveLifecycle !== lifecycle) return false;
          bound.expected = result.ciphertext;
          if (result.cacheWarning)
            notify(
              `Shared file saved; device cache could not be updated. ${result.cacheWarning}`,
            );
        } else await repository.update(id, next);
      }
      if (saveLifecycle !== lifecycle) return false;
      if (
        activeId === id &&
        generation === savedGeneration &&
        JSON.stringify(payload) === JSON.stringify(next)
      )
        dirty = false;
      saveFailed = false;
      return !dirty;
    } catch (error) {
      if (saveLifecycle !== lifecycle) return false;
      saveFailed = true;
      notify(
        error instanceof Error
          ? error.message
          : "Save failed. Keep this window open and retry.",
        true,
      );
      editor?.setSaveState("dirty", false, "failed");
      return false;
    } finally {
      saveTask = null;
      if (saveLifecycle === lifecycle) {
        reflectSave();
        if (dirty && localWorkspace && !saveFailed)
          autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            void save();
          }, 600);
      }
    }
  });
  saveTask = task;
  reflectSave();
  return task;
}
async function lockAll() {
  const closingLocal = localWorkspace;
  if (!(await save())) {
    const answer = await ask(
      "Lock and discard this unsaved draft? Export an encrypted copy first to keep it.",
      [],
      "Discard and lock",
    );
    if (!answer) return;
  }
  lifecycle++;
  repository.lockAll();
  payload = null;
  closeNotesDrawer(false);
  activeId = null;
  localWorkspace = false;
  selectedId = null;
  dirty = false;
  clearEditor();
  if (!(await refreshEntities())) return;
  renderContent();
  notify(closingLocal ? "Workspace closed." : "Protected workspaces locked.");
}
async function newNote() {
  if (!payload && !hostSource) await createLocalWorkspace();
  if (!payload || payload.kind !== "workspace" || !(await save())) return;
  let path = "note.md";
  const occupied = new Set(
    [...payload.files.map((file) => file.path), ...payload.directories].map(
      (path) => path.normalize("NFC").toLowerCase(),
    ),
  );
  for (let suffix = 2; occupied.has(path); suffix++) path = `note-${suffix}.md`;
  const file = createPwaFile(
    path,
    new Uint8Array(),
    "text/markdown",
    Date.now(),
  );
  const candidate = structuredClone(payload);
  candidate.files.push(file);
  candidate.directories = retainEmptyDirectories(
    candidate.files,
    candidate.directories,
  );
  serializePayload(candidate);
  payload = validatePayload(candidate);
  selectedId = file.id;
  screen = "editor";
  dirty = true;
  renderContent();
  await save();
  closeNotesDrawer(false);
  editor?.view?.focus();
}
async function renameNote(advanced = false) {
  const file = selectedFile();
  if (!file || payload?.kind !== "workspace" || !(await save())) return;
  const parent = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
    : "";
  const answer = await ask(
    advanced ? "Change note path" : "Rename note",
    [
      {
        name: "name",
        label: advanced ? "Relative path (.md)" : "Note name",
        value: advanced
          ? file.path
          : file.path.slice(parent.length).replace(/\.md$/iu, ""),
      },
    ],
    "Rename note",
  );
  if (
    !answer ||
    !payload ||
    payload.kind !== "workspace" ||
    selectedFile()?.id !== file.id
  )
    return;
  const name = answer.name?.trim() ?? "";
  if (!advanced && (!name || /[\\/]/u.test(name)))
    throw new Error(
      "Use a note name without folders. Change relative path for folders.",
    );
  const path = advanced
    ? name
    : parent + name + (isMarkdownPath(name) ? "" : ".md");
  if (!isMarkdownPath(path)) throw new Error("Use a .md filename.");
  const scopeIdentities = (value: PwaPayload) =>
    JSON.stringify(
      Object.entries(scopedNotes(value, selectedId!)).map(([scope, note]) => [
        scope,
        note?.id,
      ]),
    );
  const priorScopes = scopeIdentities(payload);
  const candidate = structuredClone(payload);
  if (
    candidate.files.some((other) => other.id !== file.id && other.path === path)
  )
    throw new Error(
      "A note with that path already exists. The note was not renamed.",
    );
  const renamed = candidate.files.find((other) => other.id === file.id)!;
  renamed.path = path;
  candidate.directories = retainEmptyDirectories(
    candidate.files,
    candidate.directories,
  );
  serializePayload(candidate);
  payload = validatePayload(candidate);
  if (scopeIdentities(payload) !== priorScopes) {
    selectedId = file.id;
    clearEditor();
  }
  dirty = true;
  renderContent();
  await save();
}
async function addFiles(folder = false) {
  const started = lifecycle;
  if (!payload || payload.kind !== "workspace") return;
  // Open the picker before awaiting save to preserve browser user activation.
  const picked = await chooseMarkdown(folder);
  if (
    !picked ||
    !(await save()) ||
    started !== lifecycle ||
    payload?.kind !== "workspace"
  )
    return;
  if (!picked.files.length) {
    notify("This selection contains no .md files.");
    return;
  }
  const paths = new Set(payload.files.map((file) => file.path));
  if (picked.files.some((file) => paths.has(file.path)))
    throw new Error(
      "An imported path already exists. Add files did not change this workspace. Open a separate workspace or rename the source first.",
    );
  const candidate = structuredClone(payload);
  candidate.files.push(...picked.files);
  // Existing imports may store parents that the file paths already preserve.
  // Retain actual empty folders without charging redundant parents to the quota.
  candidate.directories = retainEmptyDirectories(candidate.files, [
    ...new Set([...candidate.directories, ...picked.directories]),
  ]);
  serializePayload(candidate);
  payload = validatePayload(candidate);
  dirty = true;
  selectedId = picked.files[0]?.id ?? null;
  renderContent();
  if (await save()) {
    notify(
      localWorkspace
        ? "Markdown files stored without encryption on this device. Original files are unchanged."
        : "Markdown files encrypted and stored on this device. Original files are unchanged.",
    );
  }
}
async function renameEntity() {
  if (!payload || !(await save())) return;
  const answer = await ask(
    "Rename workspace",
    [
      {
        name: "label",
        label: "Name (optional)",
        optional: true,
        value: payload.label ?? "",
      },
    ],
    "Save name",
  );
  if (!answer) return;
  const candidate = structuredClone(payload);
  if (answer.label) candidate.label = answer.label;
  else delete candidate.label;
  serializePayload(candidate);
  payload = validatePayload(candidate);
  dirty = true;
  if (await save()) {
    if (!(await refreshEntities())) return;
    renderContent();
  }
}
function download(data: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const anchor = element("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function encryptedExport() {
  if (!activeId || !payload) return;
  download(
    await repository.exportDraftEncrypted(activeId, payload),
    "aic-notes.aicnotes",
  );
  notify(
    "Encrypted file exported. Its filename and workspace name are not needed to unlock it.",
  );
}
async function restore() {
  if (payload?.kind !== "workspace") return;
  if (!(await restoreFolder(payload.files, payload.directories))) return;
  notify(
    "Plaintext export completed. Keep your encrypted bundle for protected transfer.",
  );
}

function renderFileNavigation() {
  fileList.replaceChildren();
  if (payload?.kind !== "workspace") {
    fileFilter.hidden = true;
    fileFilter.value = "";
    fileQuery = "";
    listedWorkspace = null;
    fileSummary.hidden = true;
    fileSummary.textContent = "";
    return;
  }
  if (listedWorkspace !== activeId) {
    listedWorkspace = activeId;
    expandedFolders.clear();
    fileQuery = "";
    fileFilter.value = "";
    visibleFileCount = 100;
  }
  fileFilter.hidden = false;
  fileSummary.hidden = false;
  const query = fileQuery.trim().toLocaleLowerCase();
  const matches = payload.files
    .filter(
      (file) =>
        isMarkdownPath(file.path) &&
        file.path.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const visible = matches.slice(0, visibleFileCount);
  const selected = matches.find((file) => file.id === selectedId);
  if (selected && !visible.includes(selected)) visible.unshift(selected);
  fileSummary.textContent = `${visible.length} of ${matches.length} Markdown files`;
  const folders = new Map<string, HTMLElement>();
  for (const file of visible) {
    let parent: HTMLElement = fileList;
    const segments = file.path.split("/");
    if (!query)
      for (let depth = 1; depth < segments.length; depth++) {
        const path = segments.slice(0, depth).join("/");
        let group = folders.get(path);
        if (!group) {
          const folder = element("details", "pwa-folder");
          const summary = element(
            "summary",
            "pwa-folder__label",
            segments[depth - 1],
          );
          summary.title = path;
          folder.open =
            expandedFolders.get(path) ??
            (depth === 1 || selected?.path.startsWith(`${path}/`) === true);
          folder.addEventListener("toggle", () => {
            if (folder.isConnected) expandedFolders.set(path, folder.open);
          });
          group = element("div", "pwa-folder__files");
          folder.append(summary, group);
          parent.append(folder);
          folders.set(path, group);
        }
        parent = group;
      }
    const row = button(
      `Open ${file.path}`,
      async () => {
        if (!(await save())) {
          closeNotesDrawer();
          return;
        }
        if (selectedId !== file.id) selectedId = file.id;
        screen = "editor";
        renderContent();
        closeNotesDrawer(false);
        editor?.view?.focus();
      },
      query ? file.path : segments[segments.length - 1],
    );
    row.title = file.path;
    row.classList.add("pwa-files__item");
    row.setAttribute("aria-current", String(selectedId === file.id));
    parent.append(row);
  }
  if (matches.length > visibleFileCount)
    fileList.append(
      button(
        "Show more Markdown files",
        () => {
          visibleFileCount += 100;
          renderFileNavigation();
        },
        "Show more",
      ),
    );
  if (!matches.length && query)
    fileList.append(element("p", "pwa-empty", "No matching .md files."));
}
function renderContent() {
  const identity = payload && selectedId ? `${activeId}/${selectedId}` : null;
  if (!identity || identity !== mountedIdentity) clearEditor();
  actions.replaceChildren();
  fileList.replaceChildren();
  renderFileNavigation();
  reflectSave();
  reflectScreen();
  if (!payload) {
    title.textContent = "Start editing";
    details.textContent = hostSource
      ? "Open this encrypted file with its passphrase."
      : "";
    if (!hostSource)
      actions.append(
        button("New note", newNote, "New note", {
          icon: "note-add",
          variant: "primary",
        }),
        button("Open files", () => openFiles(), "Open files", {
          icon: "document",
        }),
        button("Open folder", () => openFiles(true), "Open folder", {
          icon: "folder",
        }),
        button("Workspace options", openWorkspaceOptions, "", {
          icon: "more",
          iconOnly: true,
        }),
      );
    if (hostSource)
      actions.append(
        button("Create protected workspace", createEntity),
        button("Reopen encrypted file", importEncrypted),
      );
    editorContainer.append(
      element(
        "p",
        "pwa-empty",
        hostSource
          ? "Encrypted notes use the same format and passphrase as the PWA and browser extension."
          : "Markdown notes stay on this device. Export files for your own sync.",
      ),
    );
    return;
  }
  title.textContent =
    payload.label ||
    (localWorkspace ? "Unnamed workspace" : "Protected workspace");
  details.textContent = localWorkspace
    ? "Unencrypted workspace on this device · export copies to update your files"
    : `${activeId && sources.has(activeId) ? "Connected to shared encrypted file" : "Local encrypted cache · save a file for your sync folder"} · limit: 6 MiB`;
  if (payload.kind === "workspace") {
    const markdownFiles = payload.files.filter((file) =>
      isMarkdownPath(file.path),
    );
    const file = payload.files.find(
      (file) => file.id === selectedId && isMarkdownPath(file.path),
    );
    if (!file) {
      editorContainer.append(
        element(
          "p",
          "pwa-empty",
          markdownFiles.length
            ? "Select a Markdown file to open it."
            : "No .md files yet. Create a note or open Markdown files and folders.",
        ),
      );
      return;
    }
    title.textContent = file.path;
    let text: string | null = null;
    try {
      text = fileText(file);
    } catch {
      /* Binary files stay byte-exact. */
    }
    if (text === null || text.includes("\u0000") || text.length > 512 * 1024) {
      editorContainer.append(
        element(
          "p",
          "pwa-empty",
          "This file is preserved as bytes. Export a plaintext copy to open it with its system application.",
        ),
      );
      return;
    }
    if (!editor) mountEditor(file.id);
    else title.textContent = selectedScopeNote()?.title ?? file.path;
  } else {
    details.textContent =
      "Chrome / Edge library · export preserves the extension backup format";
    const records = payload.library.notes;
    for (const note of records) {
      const row = button(
        `Open ${note.title || note.url}`,
        async () => {
          if (!(await save())) {
            closeNotesDrawer();
            return;
          }
          selectedId = note.id;
          screen = "editor";
          renderContent();
          closeNotesDrawer(false);
        },
        note.title || note.url,
      );
      row.classList.add("pwa-files__item");
      row.setAttribute("aria-current", String(note.id === selectedId));
      fileList.append(row);
    }
    for (const shared of payload.library.domains) {
      const row = button(
        `Open shared notes for ${shared.origin}`,
        async () => {
          if (!(await save())) {
            closeNotesDrawer();
            return;
          }
          selectedId = shared.id;
          screen = "editor";
          renderContent();
          closeNotesDrawer(false);
        },
        `Shared · ${shared.origin}`,
      );
      row.classList.add("pwa-files__item");
      fileList.append(row);
    }
    if (payload.library.global) {
      const globalId = payload.library.global.id;
      const row = button(
        "Open Global notes",
        async () => {
          if (!(await save())) {
            closeNotesDrawer();
            return;
          }
          selectedId = globalId;
          screen = "editor";
          renderContent();
          closeNotesDrawer(false);
        },
        "Global",
      );
      row.classList.add("pwa-files__item");
      fileList.append(row);
    }
    const available = selectedId ? scopedNotes(payload, selectedId) : {};
    const note = available.current ?? available.shared ?? available.global;
    if (note) {
      title.textContent = note.title;
      if (!editor) mountEditor(selectedId!);
      else title.textContent = selectedScopeNote()?.title ?? note.title;
    } else
      editorContainer.append(
        element(
          "p",
          "pwa-empty",
          "Select a page note. Domain, Global and history records are preserved in encrypted exports.",
        ),
      );
  }
}
function mountEditor(id: string) {
  if (!payload || !selectedId) return;
  mountedIdentity = `${activeId}/${id}`;
  screen = "editor";
  reflectScreen();
  notice.hidden = true;
  const available = scopedNotes(payload, selectedId);
  const order: NoteScope[] = ["current", "shared", "global"];
  activeScope = order.find((scope) => available[scope]) ?? "current";
  const panels = new Map(
    order.map((scope) => [scope, element("section", "pwa-scope-panel")]),
  );
  const originatingLifecycle = lifecycle;
  const originatingIdentity = mountedIdentity;
  const ensureEditor = (scope: NoteScope) => {
    const note = selectedScopeNote(scope);
    const panel = panels.get(scope)!;
    if (!note) return;
    let instance = scopeEditors.get(scope);
    if (!instance) {
      let text: string;
      try {
        text = note.file ? fileText(note.file) : (note.markdown ?? "");
      } catch {
        text = "";
      }
      if (text.includes("\u0000") || text.length > 512 * 1024) {
        panel.append(
          element(
            "p",
            "pwa-empty",
            "This note exceeds the editable text limit. Export it to open it in another application.",
          ),
        );
        editor = null;
        aiControls = null;
        title.textContent = note.title;
        return;
      }
      const scopedEditor = new AicEditor(panel, {
        initialText: text,
        readOnly: working,
        onChange: (value) => {
          if (
            lifecycle === originatingLifecycle &&
            mountedIdentity === originatingIdentity &&
            activeScope === scope
          )
            updateText(value, scope);
        },
        onSave: () =>
          lifecycle === originatingLifecycle &&
          mountedIdentity === originatingIdentity
            ? save()
            : false,
      });
      scopedEditor.switchDocument(note.id, text);
      const ai = attachLocalAI(scopedEditor.toolbar?.element ?? panel, {
        compact: true,
        editor: scopedEditor,
        identity: () => `${activeId}/${note.id}/${generation}/${scope}`,
        isReadonly: () =>
          working || activeScope !== scope || !activeId || !payload,
        onNotice: notify,
      });
      instance = { editor: scopedEditor, ai, panel };
      scopeEditors.set(scope, instance);
    }
    editor = instance.editor;
    aiControls = instance.ai;
    editor.setReadOnly(working);
    title.textContent = note.title;
    reflectSave();
  };
  scopeTabs = createScopeTabs(document, {
    label: "Note scope",
    selected: activeScope,
    items: order.map((scope) => ({
      id: scope,
      label: scope[0]!.toUpperCase() + scope.slice(1),
      panel: panels.get(scope)!,
      disabled: !available[scope],
      title:
        available[scope]?.title ??
        (scope === "shared"
          ? "No existing folder or site note in this workspace"
          : "No existing project or Global note in this workspace"),
    })),
    onSelect: async (next) => {
      if (
        working ||
        !(await save()) ||
        lifecycle !== originatingLifecycle ||
        mountedIdentity !== originatingIdentity
      )
        return false;
      aiControls?.cancel();
      activeScope = next as NoteScope;
      ensureEditor(activeScope);
      return true;
    },
    onSelected: () => {
      editor?.view?.requestMeasure();
    },
  });
  editorContainer.append(scopeTabs.element, ...panels.values());
  ensureEditor(activeScope);
}

window.addEventListener("popstate", () => {
  if (drawerHistoryClosing) {
    drawerHistoryClosing = false;
    return;
  }
  if (notesDrawer) {
    closeNotesDrawer(true, false);
    return;
  }
  if (screen !== "editor") return;
  void run(async () => {
    if (!(await save())) {
      history.pushState({ aicNotesScreen: "editor" }, "");
      return;
    }
    screen = "browser";
    reflectScreen();
    if (!fileFilter.hidden) fileFilter.focus();
    else if (!workspaceSelect.hidden && workspaceSelect.options.length)
      workspaceSelect.focus();
    else
      browserActions
        .querySelector<HTMLButtonElement>("button:not([hidden])")
        ?.focus();
  });
});

window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", (event) => {
  appUpdates?.suspend(event.persisted);
  lifecycle++;
  opening?.abort();
  opening = null;
  cancelOpenButton.hidden = true;
  notice.textContent = "";
  notice.hidden = true;
  for (const cancel of cancelDialogs) cancel();
  repository.lockAll();
  clearEditor();
  payload = null;
  closeNotesDrawer(false);
  activeId = null;
  localWorkspace = false;
  selectedId = null;
  dirty = false;
  entities.replaceChildren();
  workspaceSelect.replaceChildren();
  expandedFolders.clear();
  renderContent();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    appUpdates?.resume();
    void refreshEntities();
    renderContent();
  }
});
for (const event of ["pointerdown", "keydown"])
  window.addEventListener(
    event,
    () => {
      lastUsed = Date.now();
    },
    { passive: true },
  );
setInterval(() => {
  if (
    !localWorkspace &&
    !dirty &&
    !working &&
    activeId &&
    Date.now() - lastUsed >= 5 * 60_000
  )
    void run(lockAll);
}, 30_000);
window.addEventListener("online", reflectSave);
window.addEventListener("offline", reflectSave);
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
  if (!(await refreshEntities())) return;
  renderContent();
  if (hostSource) {
    importButton.textContent = "Reopen file";
    entityHeader.querySelector("button")?.setAttribute("hidden", "");
    protectedButton.hidden = true;
    hostSource.onDidChange(() =>
      notify(
        "The shared encrypted file changed elsewhere. Export any unsaved draft, then reopen the file.",
        true,
      ),
    );
    const text = await hostSource.read();
    if (text) await run(() => openSource(hostSource, text));
  }
  if (
    !hostSource &&
    /^https?:$/u.test(location.protocol) &&
    "serviceWorker" in navigator &&
    import.meta.env.PROD
  ) {
    appUpdates = new AppUpdateLifecycle(navigator.serviceWorker, {
      canReload: () => !dirty && !saveFailed && !saveTask && !working,
      reload: () => location.reload(),
      onError: (message) => notify(message, true),
      onState: (state) => {
        updateButton.hidden = state === "none";
        updateButton.disabled =
          state === "installing" || state === "activating";
        updateButton.textContent =
          state === "installing"
            ? "Downloading…"
            : state === "activating"
              ? "Updating…"
              : state === "reload"
                ? "Reload app update"
                : "Update app";
        updateButton.setAttribute("aria-label", updateButton.textContent);
        updateButton.title = updateButton.textContent;
        if (state === "reload" && dirty && !saveFailed)
          notify(
            "A new app version is ready. Save your draft, then reload the update.",
          );
      },
    });
    registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    appUpdates.attach(registration);
    // Updates are checked by the browser and at foreground entry, never against a notes server.
    window.addEventListener("focus", () => {
      void registration?.update().catch(() => {});
    });
  }
}
void start().catch((error: unknown) =>
  notify(
    error instanceof Error
      ? error.message
      : "Local storage could not be opened.",
    true,
  ),
);
