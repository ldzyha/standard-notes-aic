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
import {
  MarkdownDisk,
  chooseMarkdownDestination,
  writeMarkdownDestination,
  type MarkdownFileHandle,
} from "./disk";
import { PwaRepository } from "./controller";
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
  type FileSelectionOptions,
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
const repository = new PwaRepository();
const markdownDisk = new MarkdownDisk();
const downloadOnly = () => !("showSaveFilePicker" in window);
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
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

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
const status = applyUiComponent(
  element("span", "pwa-status", ""),
  "context",
  [],
  "status",
);
status.setAttribute("role", "status");
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
  applyUiComponent(link, "button", ["ghost"]);
  applyUiComponent(link, "menu", [], "item");
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
  const [, id] = workspaceSelect.value.split(":");
  if (id) void run(() => selectLocalWorkspace(id));
});
const entities = element("nav", "pwa-entities");
entities.hidden = true;
entities.setAttribute("aria-label", "Workspaces");
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
const fileList = applyUiComponent(element("nav", "pwa-files"), "tree", [
  "connected",
  "compact",
]);
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
const details = applyUiComponent(
  element("span", "pwa-details"),
  "context",
  [],
  "path",
);
const documentContext = applyUiComponent(
  element("div", "pwa-document-context"),
  "context",
  ["document"],
);
const noteHeader = element("div", "pwa-note-header");
const backButton = button("Browse notes", showNotesBrowser, "", {
  icon: "folder",
  iconOnly: true,
});
const titleButton = button("Save a copy", renameNote, "");
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
noteHeader.append(backButton, titleButton, headerNewNote, noteMore);
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
documentContext.append(details, status, retryButton);
content.append(noteHeader, documentContext, actions, editorContainer);
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
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
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
    const action = localWorkspace
      ? isCurrentCopy()
        ? "Save to file"
        : "Save a copy"
      : "Rename note";
    titleButton.setAttribute("aria-label", action);
    titleButton.title = action;
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
  const file = selectedFile();
  const diskReady = !!(
    activeId &&
    file &&
    markdownDisk.ready(activeId, file.id)
  );
  const destination = diskReady
    ? "Saved to file"
    : downloadOnly()
      ? "Browser draft · download to save"
      : "Browser copy · choose a file";
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
        : destination;
  status.title = saveTask
    ? "Saving…"
    : saveFailed
      ? "Save failed"
      : dirty
        ? "Unsaved changes"
        : destination;
  status.setAttribute("aria-label", status.title);
  retryButton.hidden = !saveFailed;
  if (file && localWorkspace) {
    details.textContent = diskReady ? file.path : `${file.path} · browser copy`;
    details.title = details.textContent;
  }
  documentContext.hidden = !payload || !selectedId;
}
function showSheet(
  heading: string,
  controls: HTMLElement[],
  focusOrigin = document.activeElement as HTMLElement | null,
) {
  const origin = focusOrigin;
  const dialog = element("dialog", "pwa-dialog pwa-sheet");
  dialog.setAttribute("aria-label", heading);
  applyUiComponent(dialog, "menu", ["compact"]);
  dialog.dataset.layout = controls.every((control) =>
    ["BUTTON", "HR"].includes(control.tagName),
  )
    ? "actions"
    : "content";
  for (const control of controls) {
    if (control.tagName === "BUTTON")
      applyUiComponent(control, "menu", [], "item");
    if (control.tagName === "HR")
      applyUiComponent(control, "menu", [], "separator");
  }
  dialog.append(
    applyUiComponent(element("h2", "", heading), "menu", ["compact"], "title"),
    ...controls,
  );
  const cancel = () => {
    cancelDialogs.delete(cancel);
    dialog.close();
    dialog.remove();
    if (origin?.isConnected) origin.focus();
  };
  cancelDialogs.add(cancel);
  dialog.append(
    applyUiComponent(button("Close menu", cancel, "Done"), "menu", [], "item"),
  );
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
  const saveLabel = isCurrentCopy() ? "Save to file" : "Save a copy";
  showSheet("Note options", [
    ...(file
      ? [
          ...(localWorkspace
            ? [
                button(saveLabel, saveNoteAs, `${saveLabel}…`, {
                  icon: "save",
                }),
                ...(!downloadOnly()
                  ? [
                      button(
                        "Reconnect files",
                        reconnectMarkdown,
                        "Reconnect files",
                        { icon: "folder" },
                      ),
                    ]
                  : []),
              ]
            : []),
          button(
            "Export Markdown",
            () => exportPlainFile(file),
            "Export Markdown",
            { icon: "export-file" },
          ),
        ]
      : []),
    button(
      "Note details",
      () =>
        showSheet("Note details", [
          element("p", "", details.textContent ?? ""),
          element(
            "p",
            "",
            "Connected Markdown files are edited directly. Unsupported browsers download edited copies. Secret-field masking hides values on screen; files remain readable.",
          ),
        ]),
      "Details",
      { icon: "help" },
    ),
  ]);
}
function openWorkspaceOptions() {
  const openedFromDrawer = !!notesDrawer;
  if (openedFromDrawer) closeNotesDrawer(false);
  showWorkspaceOptions(openedFromDrawer ? backButton : undefined);
}
function showWorkspaceOptions(focusOrigin?: HTMLElement | null) {
  showSheet(
    "Workspace options",
    [
      button("New workspace", createLocalWorkspace, "Open folder", {
        icon: "folder",
      }),
      ...(payload
        ? [
            button("Rename workspace", renameEntity),
            button("Add files", () => addFiles()),
            button("Add folder", () => addFiles(true)),
            button("Export all notes", restore),
            button("Close workspace", closeWorkspace),
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
    editor?.setReadOnly(isCurrentCopy());
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
      input.type = "text";
      input.required = !spec.optional;
      input.value = spec.value ?? "";
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
  const localRecords = await repository.listLocal();
  if (started !== lifecycle) return false;
  app.dataset.hasWorkspaces = String(localRecords.length > 0);
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
      name,
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
  if (!(await save()) || started !== lifecycle) return;
  await openFiles(true);
}
async function selectLocalWorkspace(id: string) {
  const started = lifecycle;
  if (!(await save()) || started !== lifecycle) return;
  const next = await repository.readLocal(id);
  if (started !== lifecycle) return;
  activateLocal(id, next, next.files[0]?.id ?? null);
  try {
    if (await markdownDisk.restore(id)) await refreshMarkdownSelection();
    else if (repository.isDiskWorkspace(id))
      notify(
        "Reconnect the original folder. This is a recovery copy and cannot overwrite your files.",
        true,
      );
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "Reconnect your files.",
      true,
    );
  }
  if (!(await refreshEntities())) return;
  renderContent();
}
async function chooseMarkdown(
  folder: boolean,
  onBatch?: FileSelectionOptions["onBatch"],
): Promise<PickedFiles | null> {
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
      onBatch,
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
    }
  }
}
async function openFiles(folder = false) {
  await importMarkdown(folder, false);
}

/** Commit each bounded scan batch before the picker advances its cursor. */
async function importMarkdown(folder: boolean, adding: boolean) {
  const started = lifecycle;
  let committed = 0;
  let prepared = false;
  let destination = adding ? activeId : null;
  const current = () => {
    if (started !== lifecycle || opening?.signal.aborted)
      throw new DOMException("Opening canceled.", "AbortError");
  };
  const commit = async (batch: PickedFiles, root?: string) => {
    current();
    if (!batch.files.length && (!batch.disk?.root || destination)) return;
    if (!prepared) {
      if (!(await save()))
        throw new Error("Save the current note before opening more files.");
      current();
      prepared = true;
    }
    if (!destination) {
      const candidate = {
        ...createWorkspace(
          folder ? (root ?? batch.files[0]?.path.split("/")[0]) : undefined,
        ),
        files: batch.files,
        directories: batch.directories,
      };
      serializePayload(candidate);
      const record = await repository.createLocal(
        undefined,
        candidate,
        !!batch.disk,
      );
      committed += batch.files.length;
      destination = record.id;
      if (started !== lifecycle) return;
      if (batch.disk)
        await rememberMarkdown(destination, batch.disk, batch.files);
      if (started !== lifecycle) return;
      activateLocal(record.id, record.payload, batch.files[0]?.id ?? null);
      if (!(await refreshEntities())) return;
    } else {
      if (activeId !== destination || payload?.kind !== "workspace")
        throw new Error(
          "The destination workspace changed. Open the folder again.",
        );
      const paths = new Set(payload.files.map((file) => file.path));
      if (batch.files.some((file) => paths.has(file.path)))
        throw new Error(
          "An imported path already exists. Open a separate workspace or rename the source first.",
        );
      const candidate = {
        ...payload,
        files: [...payload.files, ...batch.files],
        directories: retainEmptyDirectories(
          [...payload.files, ...batch.files],
          [...new Set([...payload.directories, ...batch.directories])],
        ),
      };
      serializePayload(candidate);
      const next = validatePayload(candidate);
      if (next.kind !== "workspace") return;
      // Commit the cache only after the scanner has read these original files.
      if (localWorkspace) {
        if (batch.disk)
          await rememberMarkdown(destination, batch.disk, batch.files);
        await repository.updateLocal(destination, next);
        committed += batch.files.length;
        if (started !== lifecycle) return;
        payload = next;
      } else {
        payload = next;
        dirty = true;
        if (!(await save()))
          throw new Error(
            "The current batch could not be saved. Use Retry save to keep these notes.",
          );
        committed += batch.files.length;
        if (started !== lifecycle) return;
      }
      if (!committed || committed === batch.files.length)
        selectedId = batch.files[0]?.id ?? selectedId;
    }
    renderContent();
  };
  try {
    // The picker starts synchronously; saving waits until its first real batch.
    const picked = await chooseMarkdown(folder, (batch, checkpoint) =>
      commit(batch, checkpoint.root),
    );
    if (started !== lifecycle) return;
    if (!picked) {
      notify(
        committed
          ? `Opening stopped. ${committed} notes are saved on this device.`
          : "Opening canceled. Your current notes are unchanged.",
      );
      return;
    }
    // Pickers without batch support (including explicit file selections) retain
    // the same commit path, so a completed streaming receipt is never imported twice.
    if (picked.files.length || (!destination && picked.disk?.root))
      await commit(picked, picked.directories[0]);
    if (started !== lifecycle) return;
    notify(
      committed
        ? `${committed} Markdown notes opened. ${picked.disk ? "Changes save directly to the original files." : downloadOnly() ? "Edit browser drafts and download copies to save them." : "Browser copies are read-only; use Save to file to edit an original."}`
        : "This selection contains no .md files.",
    );
    if (committed && picked.disk)
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
        noticeTimer = null;
      }, 4000);
  } catch (error) {
    if (started !== lifecycle) return;
    const canceled =
      error instanceof DOMException && error.name === "AbortError";
    const detail = canceled
      ? "Opening canceled."
      : error instanceof Error
        ? error.message
        : "Opening could not finish.";
    notify(
      committed
        ? `${detail} ${committed} notes already saved on this device are available.`
        : detail,
      !canceled,
    );
  }
}
async function removeLocalWorkspace() {
  if (!localWorkspace || !activeId) return;
  const answer = await ask(
    "Disconnect this workspace from this device? Unsaved changes will be removed too. Original files are unchanged.",
    [],
    "Remove workspace",
  );
  if (!answer) return;
  await repository.removeLocal(activeId);
  try {
    await markdownDisk.disconnect(activeId);
  } catch {
    /* The workspace is disconnected in memory; source files remain untouched. */
  }
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
  if (!payload || !selectedId || isCurrentCopy()) return;
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
  const task = Promise.resolve().then(async () => {
    try {
      if (savingLocal && next.kind === "workspace") {
        const result: { cacheWarning?: string } = downloadOnly()
          ? (await repository.updateLocal(id, next), {})
          : await repository.saveLocalToDisk(id, next, () =>
              markdownDisk.save(
                id,
                next,
                repository.localSnapshot(id) ?? undefined,
              ),
            );
        if (saveLifecycle !== lifecycle) return false;
        if (result.cacheWarning)
          notify(
            `Files saved; the browser cache could not be updated. ${result.cacheWarning}`,
          );
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
async function closeWorkspace() {
  if (!(await save())) {
    const answer = await ask(
      "Close and discard this unsaved draft? Export Markdown first to keep it.",
      [],
      "Discard and close",
    );
    if (!answer) return;
  }
  lifecycle++;
  repository.closeAll();
  payload = null;
  closeNotesDrawer(false);
  activeId = null;
  localWorkspace = false;
  selectedId = null;
  dirty = false;
  clearEditor();
  if (!(await refreshEntities())) return;
  renderContent();
  notify("Workspace closed.");
}
function isCurrentCopy(): boolean {
  if (!localWorkspace) return !!payload;
  if (downloadOnly()) return false;
  const file = selectedFile();
  return !!file && (!activeId || !markdownDisk.ready(activeId, file.id));
}
async function rememberMarkdown(
  id: string,
  selection: import("./disk").MarkdownSelection,
  files: PwaFile[],
) {
  const started = lifecycle;
  try {
    await markdownDisk.attach(id, selection, files);
  } catch {
    if (started !== lifecycle) return;
    notify(
      "Files are connected for this session. Reopen them next time; this browser could not remember access.",
      true,
    );
  }
}
async function refreshMarkdownSelection() {
  if (
    !localWorkspace ||
    !activeId ||
    payload?.kind !== "workspace" ||
    !selectedId
  )
    return;
  const ids = new Set(
    Object.values(scopedNotes(payload, selectedId)).flatMap((note) =>
      note ? [note.id] : [],
    ),
  );
  if (!ids.size || ![...ids].some((id) => markdownDisk.has(activeId!, id)))
    return;
  const id = activeId;
  const started = lifecycle;
  const next = await markdownDisk.refresh(id, payload, ids);
  if (started !== lifecycle || id !== activeId) return;
  if (payload?.kind !== "workspace") return;
  const contentChanged = next.files.some((file) => {
    const previous =
      payload?.kind === "workspace"
        ? payload.files.find((item) => item.id === file.id)
        : undefined;
    return (
      previous && (file.data !== previous.data || file.path !== previous.path)
    );
  });
  payload = next;
  if (contentChanged) clearEditor();
}
async function reconnectMarkdown() {
  const started = lifecycle;
  if (!activeId || !localWorkspace) return;
  await markdownDisk.restore(activeId);
  await markdownDisk.requestPermission(activeId);
  if (started !== lifecycle) return;
  if (dirty) await save();
  else {
    await refreshMarkdownSelection();
    clearEditor();
    renderContent();
  }
}
async function saveNoteAs() {
  const started = lifecycle;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const file = selectedFile();
  const id = activeId;
  if (!file || !id || !localWorkspace || payload?.kind !== "workspace") return;
  if (downloadOnly()) {
    await exportPlainFile(file);
    notify(
      "Markdown download started. Use your browser's download location to keep this copy.",
    );
    return;
  }
  // Picker is invoked before other I/O so it retains the user's activation.
  const handle = await chooseMarkdownDestination(file.path);
  if (!handle || started !== lifecycle || activeId !== id) return;
  if (saveTask) await saveTask;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (started !== lifecycle || activeId !== id || payload?.kind !== "workspace")
    return;
  if (
    payload.files.some(
      (other) => other.id !== file.id && other.path === handle.name,
    )
  )
    throw new Error(
      "That filename is already open in this workspace. Choose a different destination.",
    );
  const written = await writeMarkdownDestination(handle, structuredClone(file));
  if (started !== lifecycle || activeId !== id || payload?.kind !== "workspace")
    return;
  // Saving a copy changes this note's binding explicitly; the old original remains untouched.
  written.path = handle.name;
  const scopeIds = (value: PwaPayload) =>
    JSON.stringify(
      Object.values(scopedNotes(value, selectedId!)).map((note) => note?.id),
    );
  const previousScopes = scopeIds(payload);
  const next = structuredClone(payload);
  next.files[next.files.findIndex((other) => other.id === file.id)] = written;
  await rememberMarkdown(
    id,
    { files: [{ id: file.id, path: written.path, handle }] },
    [written],
  );
  if (started !== lifecycle || activeId !== id) return;
  payload = next;
  dirty = true;
  await save();
  if (started !== lifecycle) return;
  if (scopeIds(next) !== previousScopes) clearEditor();
  renderContent();
}
async function newNote() {
  const started = lifecycle;
  let path = "note.md";
  const directory =
    activeId && localWorkspace ? markdownDisk.root(activeId) : undefined;
  const occupied = new Set(
    payload?.kind === "workspace"
      ? payload.files.map((file) => file.path.normalize("NFC").toLowerCase())
      : [],
  );
  const prefix = directory ? `${directory.name}/` : "";
  for (let suffix = 2; occupied.has(`${prefix}${path}`.toLowerCase()); suffix++)
    path = `note-${suffix}.md`;
  let handle: MarkdownFileHandle | null = null;
  if (!payload || localWorkspace) {
    if (directory) {
      // Ask for a filename before creating; check the real folder, not only its cached listing.
      const answer = await ask(
        "New note",
        [{ name: "name", label: "Filename", value: path }],
        "Create file",
      );
      if (!answer) return;
      path = answer.name?.trim() ?? "";
      if (!path || /[\\/]/u.test(path))
        throw new Error("Choose a filename without folders.");
      if (!isMarkdownPath(path)) path += ".md";
      try {
        await directory.getFileHandle(path);
        throw new Error(
          "That file already exists. Open it from the folder instead.",
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError"))
          throw error;
      }
      if (!(await save()) || started !== lifecycle) return;
      try {
        await directory.getFileHandle(path);
        throw new Error(
          "That file appeared on disk. Open it instead of creating a new note.",
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError"))
          throw error;
      }
      handle = await directory.getFileHandle(path, { create: true });
    } else if (!downloadOnly()) {
      handle = await chooseMarkdownDestination(path);
      if (!handle || !(await save())) return;
      path = handle.name;
    } else if (!(await save())) {
      return;
    }
  }
  if (started !== lifecycle) return;
  if (
    payload?.kind === "workspace" &&
    payload.files.some((file) => file.path === `${prefix}${path}`)
  )
    throw new Error("That file is already open in this workspace.");
  const file = createPwaFile(
    `${prefix}${path}`,
    new Uint8Array(),
    "text/markdown",
    Date.now(),
  );
  if (handle) {
    const written = await writeMarkdownDestination(handle, file, {
      newOnly: true,
    });
    Object.assign(file, written, { path: `${prefix}${path}` });
  }
  if (started !== lifecycle) return;
  if (!payload) {
    const record = await repository.createLocal(
      undefined,
      { ...createWorkspace(), files: [file], directories: [] },
      !!handle,
    );
    if (started !== lifecycle) return;
    activateLocal(record.id, record.payload, file.id);
  } else if (payload.kind === "workspace") {
    payload = {
      ...payload,
      files: [...payload.files, file],
      directories: retainEmptyDirectories(
        [...payload.files, file],
        payload.directories,
      ),
    };
    selectedId = file.id;
  }
  if (handle && activeId)
    await rememberMarkdown(
      activeId,
      { files: [{ id: file.id, path: file.path, handle }] },
      [file],
    );
  if (started !== lifecycle) return;
  dirty = true;
  screen = "editor";
  await save();
  if (started !== lifecycle) return;
  if (!(await refreshEntities())) return;
  renderContent();
  closeNotesDrawer(false);
  editor?.view?.focus();
}
async function renameNote() {
  if (localWorkspace) await saveNoteAs();
}
async function addFiles(folder = false) {
  if (!localWorkspace || payload?.kind !== "workspace") return;
  await importMarkdown(folder, true);
}
async function renameEntity() {
  if (!localWorkspace || !payload || !(await save())) return;
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
async function restore() {
  if (payload?.kind !== "workspace") return;
  if (!(await restoreFolder(payload.files, payload.directories))) return;
  notify("Files exported. The originals remain unchanged.");
}

function fileTreeGroup(className = "") {
  return applyUiComponent(element("ul", className), "tree", [], "group");
}
function fileTreeIcon(name: string, part: "icon" | "toggle" = "icon") {
  const icon = applyUiComponent(
    element("span", "cm-aic-icon-button"),
    "tree",
    [],
    part,
  );
  icon.dataset.aicIcon = name;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
function appendFileTreeRow(parent: HTMLElement, row: HTMLButtonElement) {
  applyUiComponent(row, "tree", [], "row");
  row.classList.add("pwa-files__item");
  const label = row.querySelector<HTMLElement>(".aic-button__label");
  if (label) applyUiComponent(label, "tree", [], "label");
  const icon = row.querySelector<HTMLElement>(".aic-button__icon");
  if (icon) applyUiComponent(icon, "tree", [], "icon");
  const item = applyUiComponent(element("li"), "tree", [], "item");
  item.append(row);
  parent.append(item);
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
  const tree = fileTreeGroup();
  fileList.append(tree);
  const folders = new Map<string, HTMLElement>();
  for (const file of visible) {
    let parent: HTMLElement = tree;
    const segments = file.path.split("/");
    if (!query)
      for (let depth = 1; depth < segments.length; depth++) {
        const path = segments.slice(0, depth).join("/");
        let group = folders.get(path);
        if (!group) {
          const folder = element("details", "pwa-folder");
          const summary = applyUiComponent(
            element("summary", "pwa-folder__label"),
            "tree",
            [],
            "row",
          );
          summary.append(
            fileTreeIcon("chevron", "toggle"),
            fileTreeIcon("folder"),
            applyUiComponent(
              element("span", "", segments[depth - 1]),
              "tree",
              [],
              "label",
            ),
          );
          summary.title = path;
          folder.open =
            expandedFolders.get(path) ??
            (depth === 1 || selected?.path.startsWith(`${path}/`) === true);
          folder.addEventListener("toggle", () => {
            if (folder.isConnected) expandedFolders.set(path, folder.open);
          });
          group = fileTreeGroup("pwa-folder__files");
          folder.append(summary, group);
          const item = applyUiComponent(element("li"), "tree", [], "item");
          item.append(folder);
          parent.append(item);
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
        const previousSelection = selectedId;
        selectedId = file.id;
        try {
          await refreshMarkdownSelection();
        } catch (error) {
          selectedId = previousSelection;
          throw error;
        }
        screen = "editor";
        renderContent();
        closeNotesDrawer(false);
        editor?.view?.focus();
      },
      query ? file.path : segments[segments.length - 1],
      { icon: "document" },
    );
    row.title = file.path;
    row.setAttribute("aria-current", String(selectedId === file.id));
    appendFileTreeRow(parent, row);
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
  title.removeAttribute("title");
  const identity = payload && selectedId ? `${activeId}/${selectedId}` : null;
  if (!identity || identity !== mountedIdentity) clearEditor();
  actions.replaceChildren();
  fileList.replaceChildren();
  renderFileNavigation();
  reflectSave();
  reflectScreen();
  if (!payload) {
    title.textContent = "Start editing";
    details.textContent = "";
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
    );
    editorContainer.append(
      element(
        "p",
        "pwa-empty",
        downloadOnly()
          ? "Open Markdown files or create a note. Download edited copies to save them."
          : "Open a file or folder. Changes save directly to your files.",
      ),
    );
    return;
  }
  title.textContent = payload.label || "Unnamed workspace";
  details.textContent = selectedFile()?.path ?? "Choose a Markdown file";
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
    title.textContent = file.path.split("/").at(-1)!;
    title.title = file.path;
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
    else
      setScopeTitle(
        selectedScopeNote() ?? { id: file.id, title: file.path, file },
      );
  }
}

function setScopeTitle(note: ScopedNote) {
  title.textContent = note.file
    ? note.file.path.split("/").at(-1)!
    : note.title;
  title.title = note.title;
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
        setScopeTitle(note);
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
          working ||
          isCurrentCopy() ||
          activeScope !== scope ||
          !activeId ||
          !payload,
        onNotice: notify,
      });
      instance = { editor: scopedEditor, ai, panel };
      scopeEditors.set(scope, instance);
    }
    editor = instance.editor;
    aiControls = instance.ai;
    editor.setReadOnly(working || isCurrentCopy());
    setScopeTitle(note);
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
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  notice.textContent = "";
  notice.hidden = true;
  for (const cancel of cancelDialogs) cancel();
  repository.closeAll();
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
