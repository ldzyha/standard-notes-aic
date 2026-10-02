import { createScopeTabs, type ScopeTabs } from "../core/scope-tabs.js";
import { ChangeSet, EditorState, StateEffect } from "@codemirror/state";
import { relatedPageLink } from "./related-links";
import { AicEditor } from "../editor";
import { request, type Request, type ActivePage, type BrowserApi } from "./api";
import { BrowserDrafts, type Draft } from "./drafts";
import { DomainDrafts, type DomainDraft } from "./domain-drafts";
import {
  GlobalDrafts,
  GLOBAL_CONTEXT,
  type GlobalDraft,
} from "./global-drafts";
import { DomainPropertiesView } from "./domain-properties";
import { savedPageAncestors } from "./page-ancestors";
import { applyUiComponent, createUiButton } from "../core/ui-system.js";
import { createEditorHelp } from "../core/editor-help.js";
import {
  buildDomainTree,
  type BrowserLibrary,
  type BrowserDomain,
  type BrowserGlobal,
  type BrowserNote,
} from "./library";
import {
  displayPageLocation,
  displayPageTitle,
  navigationLabels,
  projectDomain,
  type NavigationItem,
} from "./navigation";
import { importCapturedPage } from "./import-page";
import type { PageCapture } from "./capture-page";
import type { RecoveryDraft, RecoverySnapshot } from "./recovery-store";
import {
  chooseBrowserSource,
  BrowserSourceAccess,
  FILE_SOURCE_KEY,
  type BrowserFileLocation,
  type BrowserStatus,
  type BrowserScan,
  type BrowserScanStatus,
  type ScanNoteSummary,
} from "./markdown-storage";

const PLACEHOLDER_TEXT = "";
const emptyLibrary = (): BrowserLibrary => ({
  version: 3,
  notes: [],
  history: [],
  domains: [],
  global: null,
});

/** Compare observation identity, never order an opaque file token. */
function sameScopeObservation(
  left: BrowserDomain | BrowserGlobal | null,
  right: BrowserDomain | BrowserGlobal | null,
): boolean {
  return (
    left === right ||
    !!(
      left &&
      right &&
      left.id === right.id &&
      left.filePath === right.filePath &&
      left.revision === right.revision &&
      left.markdown === right.markdown
    )
  );
}

/** One panel owns its window context and ephemeral plaintext. The worker owns storage. */
export class BrowserPanel {
  readonly ready: Promise<void>;
  private generation = 0;
  private contextGeneration = 0;
  private disposed = false;
  private state: BrowserStatus["state"] = "unselected";
  private selectedFileId: string | null = null;
  private source: BrowserFileLocation | undefined;
  private sourceError = "";
  private sourceErrorCode = "";
  private sourceAccessState: BrowserStatus["access"];
  private readonly sourceAccess = new BrowserSourceAccess();
  private reconnecting = false;
  private warmedSourceId: string | null = null;
  private checkingAccess = false;
  private selectingSource = false;
  private sourceWarnings: string[] = [];
  private sourceChanged = false;
  private scan: BrowserScan | null = null;
  private scanNotes: ScanNoteSummary[] = [];
  private scanOffset = 0;
  private scanStopping = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private fileOperation: {
    label: string;
    candidateId?: string;
    poll: Promise<void> | null;
    finishing: boolean;
  } | null = null;
  private windowId: number | null = null;
  private privateWindow = false;
  private allowPrivate = false;
  private page: ActivePage | null = null;
  private pinnedPage: ActivePage | null = null;
  private activePage: ActivePage | null = null;
  private activeGeneration = 0;
  private library = emptyLibrary();
  private readonly recoveryClientId = crypto.randomUUID();
  private recoverySequence = 0;
  private recoverySignature = "";
  private recoveryError = "";
  private recovered: RecoverySnapshot[] = [];
  private editor: AicEditor | null = null;
  private editorGeneration = 0;
  private noteId: string | null = null;
  private drafts: BrowserDrafts | null = null;
  private domainDrafts: DomainDrafts | null = null;
  private globalDrafts: GlobalDrafts | null = null;
  private globalShared: DomainPropertiesView | null = null;
  private globalKey: string | null = null;
  private globalRefreshDeferred = false;
  private shared: DomainPropertiesView | null = null;
  private scopeTabs: ScopeTabs | null = null;
  private activeScope: "current" | "shared" | "global" = "current";
  private domainKey: string | null = null;
  private domainReload: Promise<void> | null = null;
  private domainReloadRevision = 0;
  private domainRefreshDeferred = false;
  private filter = "";
  private importing = false;
  private deleting = false;
  private libraryRefreshDeferred = false;
  private contextLoading = false;
  private overlayTrigger: HTMLButtonElement | null = null;
  private markdownImport: {
    input: HTMLInputElement;
    cancelled: boolean;
  } | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly urls = new Set<string>();
  private readonly cleanups: (() => void)[] = [];
  private readonly document: Document;
  private readonly toolbar: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly fileLocation: HTMLElement;
  private readonly scanView: HTMLElement;
  private readonly content: HTMLElement;
  private readonly overlay: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly api: BrowserApi,
  ) {
    this.document = root.ownerDocument;
    root.classList.add("browser-panel");
    this.toolbar = this.el("header", "browser-toolbar");
    applyUiComponent(this.toolbar, "toolbar", ["compact"]);
    this.fileLocation = this.el("div", "browser-file-location");
    applyUiComponent(this.fileLocation, "context", ["document"]);
    this.scanView = this.el("section", "browser-scan");
    applyUiComponent(this.scanView, "notice", ["info"]);
    this.scanView.setAttribute("aria-label", "Folder scan");
    this.scanView.hidden = true;
    this.feedback = this.el("div", "browser-feedback");
    applyUiComponent(this.feedback, "notice");
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.content = this.el("main", "browser-content");
    this.overlay = this.el("div", "browser-overlay");
    applyUiComponent(this.overlay, "menu", ["compact"]);
    root.replaceChildren(
      this.toolbar,
      this.fileLocation,
      this.scanView,
      this.feedback,
      this.content,
      this.overlay,
    );
    const dismissOverlay = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.overlay.childElementCount) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeOverlay(true);
    };
    const outsideOverlay = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        this.overlay.childElementCount &&
        !this.overlay.contains(target) &&
        !this.overlayTrigger?.contains(target)
      )
        this.closeOverlay();
    };
    this.document.addEventListener("keydown", dismissOverlay, true);
    this.document.addEventListener("pointerdown", outsideOverlay);
    this.cleanups.push(
      () => this.document.removeEventListener("keydown", dismissOverlay, true),
      () => this.document.removeEventListener("pointerdown", outsideOverlay),
    );
    this.listen(api.storage.onChanged, (changes, area) => {
      const changedFile = changes[FILE_SOURCE_KEY] as
        { newValue?: { id?: string } } | undefined;
      if (
        area === "local" &&
        changedFile &&
        changedFile.newValue?.id !== this.source?.id
      )
        this.sourceChanged = true;
      if (area === "local" && changedFile) {
        // The awaited source operation mounts its result once. Its own storage
        // event must not initialize a second scan or dispose the active monitor.
        if (this.fileOperation) return;
        if (this.sourceChanged && this.hasPendingDrafts()) {
          this.tell(
            "The selected location changed in another panel. Save or export this draft before reconnecting.",
            "error",
          );
          return;
        }
        if (this.sourceChanged) {
          this.clearPlaintext();
          void this.initialize();
          return;
        }
      }
      if (area === "local" && changes["aic-browser-markdown-change"])
        this.refreshSharedData();
    });
    this.listen(api.tabs.onActivated, (info) => {
      if (
        info.windowId === this.windowId &&
        info.tabId !== this.activePage?.tabId
      )
        this.contextChanged();
    });
    this.listen(api.tabs.onUpdated, (id, change, tab) => {
      if (tab.windowId !== this.windowId) return;
      if (
        id === this.page?.tabId &&
        (!change.url || change.url === this.page.url)
      ) {
        if (change.title !== undefined) {
          this.page.title = change.title;
          const title = this.toolbar.querySelector(".browser-page-title");
          if (title) {
            const label = displayPageTitle(this.page);
            title.textContent = label;
            (title as HTMLElement).title = label;
          }
        }
        return;
      }
      if (
        tab.windowId === this.windowId &&
        (tab.active || id === this.page?.tabId) &&
        (change.url !== undefined ||
          change.title !== undefined ||
          change.status === "complete")
      )
        this.contextChanged();
    });
    this.listen(api.tabs.onRemoved, (id, info) => {
      if (info.windowId === this.windowId && id === this.page?.tabId)
        this.contextChanged();
    });
    const media = this.document.defaultView?.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    const theme = () => {
      this.editor?.refreshTheme();
      this.shared?.refreshTheme();
      this.globalShared?.refreshTheme();
    };
    media?.addEventListener("change", theme);
    this.cleanups.push(() => media?.removeEventListener("change", theme));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        this.drafts?.hasPendingChanges() ||
        this.domainDrafts?.hasPendingChanges() ||
        this.globalDrafts?.hasPendingChanges()
      ) {
        this.flushBeforeHide();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    this.document.defaultView?.addEventListener("beforeunload", beforeUnload);
    this.cleanups.push(() =>
      this.document.defaultView?.removeEventListener(
        "beforeunload",
        beforeUnload,
      ),
    );
    const visibility = () => {
      if (this.document.visibilityState === "hidden") {
        this.flushBeforeHide();
        // Retained sidebar documents must not keep tracking browser activity.
        ++this.contextGeneration;
        this.setImporting(false);
        const selectedScope = this.activeScope;
        this.dropEditor();
        this.activeScope = selectedScope;
        this.page = null;
        this.activePage = null;
        ++this.activeGeneration;
        this.closeOverlay();
        this.content.replaceChildren();
        this.tell("");
      } else if (this.canUseLibrary()) {
        void this.startEditing();
        void this.resumeGrantedAccess();
      } else {
        this.render();
        void this.resumeGrantedAccess();
      }
    };
    const focus = () => {
      void this.resumeGrantedAccess();
    };
    this.document.defaultView?.addEventListener("focus", focus);
    this.cleanups.push(() =>
      this.document.defaultView?.removeEventListener("focus", focus),
    );
    const pagehide = () => {
      this.flushBeforeHide();
      this.destroy();
    };
    this.document.addEventListener("visibilitychange", visibility);
    this.document.defaultView?.addEventListener("pagehide", pagehide);
    this.cleanups.push(
      () => this.document.removeEventListener("visibilitychange", visibility),
      () =>
        this.document.defaultView?.removeEventListener("pagehide", pagehide),
    );
    this.render();
    this.ready = this.initialize();
  }

  private listen<T extends unknown[]>(
    event: {
      addListener(fn: (...args: T) => unknown): void;
      removeListener(fn: (...args: T) => unknown): void;
    },
    callback: (...args: T) => unknown,
  ): void {
    event.addListener(callback);
    this.cleanups.push(() => event.removeListener(callback));
  }

  private valid(generation: number, context?: number): boolean {
    return (
      !this.disposed &&
      this.generation === generation &&
      (context === undefined ||
        (this.contextGeneration === context &&
          this.document.visibilityState !== "hidden"))
    );
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text = "",
  ): HTMLElementTagNameMap[K] {
    const element = this.document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  private button(
    label: string,
    action: (button: HTMLButtonElement) => void | Promise<unknown>,
    options: { text?: string; icon?: string; variant?: "ghost" } = {},
  ): HTMLButtonElement {
    const button = createUiButton(this.document, {
      label,
      size: "compact",
      ...options,
    });
    button.classList.add("browser-button");
    button.addEventListener("click", () => {
      const generation = this.generation;
      const context = this.contextGeneration;
      try {
        void Promise.resolve(action(button)).catch((error: unknown) => {
          if (this.valid(generation, context)) this.fail(error);
        });
      } catch (error) {
        if (this.valid(generation, context)) this.fail(error);
      }
    });
    return button;
  }

  private menuButton(
    label: string,
    icon: string,
    action: (button: HTMLButtonElement) => void | Promise<unknown>,
    text = label,
  ): HTMLButtonElement {
    const button = this.button(label, action, { text, icon, variant: "ghost" });
    applyUiComponent(button, "menu", [], "item");
    return button;
  }

  private menuHeading(text: string): HTMLHeadingElement {
    const heading = this.el("h2", "browser-menu-group", text);
    applyUiComponent(heading, "menu", ["compact"], "title");
    return heading;
  }

  private menuSeparator(): HTMLHRElement {
    const separator = this.el("hr");
    applyUiComponent(separator, "menu", [], "separator");
    return separator;
  }

  private tell(
    message: string,
    kind: "info" | "success" | "error" | "progress" = "info",
  ): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    this.feedback.replaceChildren();
    this.feedback.dataset.kind = kind;
    this.feedback.setAttribute("role", kind === "error" ? "alert" : "status");
    if (!message) return;
    const dismiss = this.iconButton("Dismiss message", "×", () =>
      this.tell(""),
    );
    this.feedback.append(this.el("span", "", message), dismiss);
    if (kind === "success" || kind === "info")
      this.feedbackTimer = setTimeout(() => this.tell(""), 5000);
  }
  private fail(error: unknown): void {
    this.tell(
      error instanceof Error
        ? error.message
        : "AIC could not complete this action. Retry.",
      "error",
    );
  }

  private iconButton(
    label: string,
    glyph: string,
    action: (button: HTMLButtonElement) => void | Promise<unknown>,
    iconName?: string,
  ): HTMLButtonElement {
    const button = this.button(label, action);
    applyUiComponent(button, "button", ["ghost", "icon-only", "compact"]);
    button.classList.add("browser-icon-button");
    button.title = label;
    if (iconName) {
      button.classList.add("cm-aic-icon-button");
      button.dataset.aicIcon = iconName;
      button.replaceChildren();
    } else {
      const icon = this.el("span", "", glyph);
      icon.setAttribute("aria-hidden", "true");
      button.replaceChildren(icon);
    }
    return button;
  }

  private setImporting(busy: boolean): void {
    this.importing = busy;
    this.root.dataset.importing = String(busy);
    this.content.setAttribute("aria-busy", String(busy));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-import-action]",
    ))
      button.disabled = busy;
  }

  private renderToolbar(): void {
    this.toolbar.replaceChildren();
    if (this.canUseLibrary()) {
      this.toolbar.append(
        this.iconButton(
          "Notes",
          "",
          (button) => this.showNavigation(button),
          "folder",
        ),
      );
      const identity = this.el("div", "browser-page-identity");
      const title = this.el(
        "strong",
        "browser-page-title",
        this.activeScope === "global"
          ? "Global notes"
          : this.activeScope === "shared"
            ? "Shared notes"
            : this.selectedFileId
              ? (this.library.notes.find(
                  (note) => note.id === this.selectedFileId,
                )?.filePath ?? "Markdown file")
              : this.contextLoading
                ? "Loading page…"
                : this.page
                  ? displayPageTitle(this.page)
                  : "Your notes",
      );
      title.title = title.textContent ?? "Your notes";
      identity.append(title);
      if (this.page && !this.selectedFileId && this.activeScope !== "global") {
        const source = this.el(
          "small",
          "browser-page-origin",
          `${new URL(this.page.url).host}${this.pinnedPage ? " · Pinned" : ""}`,
        );
        source.title = displayPageLocation(this.page.url);
        identity.append(source);
      }
      this.toolbar.append(identity);
    } else {
      this.toolbar.append(this.el("span", "browser-brand", ">_ AIC"));
    }
    const more = this.iconButton("More options", "⋯", (button) =>
      this.showMoreMenu(button),
    );
    this.toolbar.append(more);
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      button.classList.remove("aic-button--compact");
      applyUiComponent(button, "button", ["touch"]);
      if (
        ["Notes", "More options"].includes(
          button.getAttribute("aria-label") || "",
        )
      ) {
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", "false");
      }
    }
  }

  private showPopover(
    label: string,
    trigger: HTMLButtonElement,
  ): HTMLElement | null {
    if (this.overlayTrigger === trigger && this.overlay.childElementCount) {
      this.closeOverlay(true);
      return null;
    }
    this.closeOverlay();
    this.overlayTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    const box = this.el("section", "browser-popover");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", label);
    this.overlay.append(box);
    return box;
  }

  private showMoreMenu(trigger: HTMLButtonElement): void {
    const box = this.showPopover("More options", trigger);
    if (!box) return;
    this.overlay.dataset.layout = "actions";
    if (
      this.page &&
      !this.selectedFileId &&
      this.canUseLibrary() &&
      this.activeScope === "current"
    ) {
      const noteId = this.noteId;
      const pin = this.menuButton(
        this.pinnedPage ? "Unpin note" : "Pin note",
        "pin",
        () => {
          this.closeOverlay(true);
          if (this.activeScope === "current" && this.noteId === noteId)
            return this.togglePin();
        },
      );
      pin.dataset.pinNote = "true";
      pin.setAttribute("aria-pressed", String(Boolean(this.pinnedPage)));
      const draft = noteId ? this.drafts?.get(noteId) : null;
      pin.disabled = !this.pinnedPage && !draft?.note && !draft?.dirty;
      pin.title = pin.disabled
        ? "Write a note before pinning it"
        : this.pinnedPage
          ? "Unpin note and follow the active tab"
          : "Keep this note open and link pages you write about";
      const capture = this.menuButton(
        "Import current content",
        "import-page",
        () => {
          this.closeOverlay(true);
          if (this.activeScope === "current" && this.noteId === noteId)
            return this.capture("auto");
        },
      );
      capture.title =
        "Import selected readable content when available; otherwise import the readable page";
      const markdown = this.menuButton(
        "Insert from Markdown file",
        "import-file",
        () => {
          this.closeOverlay(true);
          if (this.activeScope === "current" && this.noteId === noteId)
            return this.chooseMarkdownFile();
        },
        "Insert from file…",
      );
      markdown.title = "Append Markdown from another file to this note";
      for (const button of [capture, markdown]) {
        button.dataset.importAction = "true";
        button.disabled = this.importing;
        button.setAttribute("aria-description", button.title);
      }
      box.append(this.menuHeading("Current note"), pin, capture, markdown);
      const page = { ...this.page };
      const pageDraft = this.drafts?.getForPage(page.url);
      const hasNote =
        !!pageDraft?.note ||
        !!pageDraft?.dirty ||
        this.library.notes.some((item) => item.url === page.url);
      if (
        hasNote ||
        this.library.history.some((item) => item.url === page.url)
      ) {
        const remove = this.menuButton(
          hasNote
            ? this.source?.kind === "directory"
              ? "Unlink page"
              : "Delete local note"
            : "Remove page from history",
          "trash",
          () => this.showDeletePage(page.url, page.title, trigger),
        );
        remove.disabled = this.importing || this.deleting;
        box.append(remove);
      }
    }
    if (this.canUseLibrary()) {
      if (box.childElementCount) box.append(this.menuSeparator());
      const guide = this.menuButton("AIC guide", "help", () => {
        this.closeOverlay();
        this.showGuide(trigger);
      });
      guide.title = "AIC guide";
      box.append(guide);
    }
    if (box.childElementCount) box.append(this.menuSeparator());
    box.append(
      this.menuHeading("Files"),
      this.menuButton("Open file…", "document", () => this.connectFile("file")),
      this.menuButton("Open folder…", "folder", () =>
        this.connectFile("folder"),
      ),
      this.menuButton("New file", "note-add", () => this.newFile(trigger)),
    );
    if (this.source?.id && this.state === "ready" && this.needsFilePermission())
      box.append(
        this.menuButton("Reconnect access", "folder", () =>
          this.reconnectFile(),
        ),
      );
    if (this.needsFilePermission() && this.canOpenInTab())
      box.append(
        this.menuButton("Open AIC in tab", "link", () =>
          this.openTab(this.api.runtime.getURL("browser/index.html")),
        ),
      );
    if (this.source?.kind === "directory" && this.state === "ready")
      box.append(
        this.menuButton("Refresh folder", "folder", () => this.refreshFiles()),
      );
    if (this.selectedFileId && this.activeScope === "current") {
      if (this.source?.kind === "directory")
        box.append(
          this.menuButton("Follow active tab", "link", async () => {
            if (!(await this.flushAllDrafts()))
              throw new Error("Save or export this draft first.");
            this.selectedFileId = null;
            this.pinnedPage = null;
            this.closeOverlay();
            await this.refreshContext();
          }),
        );
      if (this.source?.kind === "directory")
        box.append(
          this.menuButton("Link file to current page", "link", () =>
            this.linkSelectedFile(),
          ),
        );
    }
    const exportKey =
      this.activeScope === "global"
        ? this.globalKey
        : this.activeScope === "shared"
          ? this.domainKey
          : this.noteId;
    if (exportKey) {
      const scope = this.activeScope;
      box.append(
        this.menuButton("Download copy", "export-file", () => {
          this.closeOverlay(true);
          if (scope === "current") this.exportDraft(exportKey);
          else this.exportDomainDraft(exportKey, scope === "global");
        }),
      );
    }
    box.append(
      this.menuSeparator(),
      this.menuButton("Terms and privacy", "lock", () =>
        this.openTab("https://aic.dzyha.com/terms"),
      ),
      this.menuButton(
        "Releases and installation",
        "download",
        () => this.openTab("https://aic.dzyha.com/releases"),
        "Releases",
      ),
      this.menuButton(
        "How to create documents",
        "document",
        () => this.openTab("https://aic.dzyha.com/how-to"),
        "How to",
      ),
    );
    box.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  private async openTab(url: string): Promise<void> {
    this.closeOverlay(true);
    if (this.windowId === null)
      throw new Error("Browser window context is unavailable.");
    await this.api.tabs.create({ url, windowId: this.windowId });
  }

  private showGuide(trigger: HTMLButtonElement): void {
    const box = this.showPopover("AIC guide", trigger);
    if (!box) return;
    box.classList.add("browser-guide");
    box.append(createEditorHelp(this.document, { host: "browser" }));
    box.tabIndex = -1;
    box.focus();
  }

  private showDeletePage(
    url: string,
    title: string,
    trigger: HTMLButtonElement,
  ): void {
    if (
      this.activeScope !== "current" ||
      !this.canUseLibrary() ||
      this.importing ||
      this.deleting
    )
      return;
    const generation = this.generation;
    const context = this.contextGeneration;
    const draft = this.drafts?.getForPage(url);
    const record =
      draft?.note ?? this.library.notes.find((item) => item.url === url);
    const expected = record
      ? { id: record.id, revision: record.revision }
      : null;
    const hasNote = !!record || !!draft?.dirty || !!draft?.saving;
    const unlink = this.source?.kind === "directory";
    this.closeOverlay();
    const box = this.showPopover("Delete local page", trigger);
    if (!box) return;
    box.classList.add("browser-delete-confirm");
    box.append(
      this.el(
        "h2",
        "",
        hasNote
          ? unlink
            ? "Unlink this page?"
            : "Delete this local note?"
          : "Remove this recent page?",
      ),
      this.el("p", "browser-delete-title", displayPageTitle({ url, title })),
      this.el(
        "p",
        "browser-menu-hint",
        unlink
          ? "Remove the URL connection. The Markdown file stays in the folder and remains available in Files."
          : hasNote
            ? "Delete the local note and its history entry. This cannot be undone without a backup. The website, shared properties, and other notes stay unchanged."
            : "Remove this page from AIC history. The website, shared properties, and other notes stay unchanged.",
      ),
    );
    const cancel = this.button("Cancel", () => this.closeOverlay(true));
    const confirm = this.button(
      hasNote ? (unlink ? "Unlink page" : "Delete note") : "Remove page",
      async () => {
        if (!this.valid(generation, context) || this.deleting || this.importing)
          return;
        this.deleting = true;
        this.content.inert = true;
        this.toolbar.inert = true;
        confirm.disabled = true;
        cancel.disabled = true;
        box.setAttribute("aria-busy", "true");
        this.tell("Removing local page…", "progress");
        const drafts = this.drafts;
        let focusPlaceholder = false;
        try {
          const pending = drafts?.getForPage(url);
          const acknowledged = pending
            ? await drafts!.flushSnapshot(pending.key)
            : null;
          if (pending && !acknowledged) {
            throw new Error(
              "Nothing was deleted. Save or export the unsaved draft, then retry.",
            );
          }
          if (!this.valid(generation, context)) return;
          // Only our own acknowledged save may advance the confirmed revision.
          const saved = acknowledged?.note;
          if (expected && saved && saved.id !== expected.id) {
            throw new Error(
              "This page changed elsewhere. Reopen it before deleting.",
            );
          }
          const expectedNote = saved
            ? { id: saved.id, revision: saved.revision }
            : expected;
          const library = await this.send<BrowserLibrary>({
            type: "delete-page",
            url,
            expectedNote,
          });
          if (!this.valid(generation)) return;
          const forgotten = !pending || drafts?.forget(pending.key);
          if (!this.valid(generation, context)) {
            // The commit succeeded, but a newer context owns the visible UI now.
            this.refreshSharedData();
            return;
          }
          this.library = library;
          this.closeOverlay();
          if (!forgotten) {
            throw new Error(
              "The stored note was deleted, but a new local edit remains. Export that draft before reopening.",
            );
          }
          if (this.page?.url === url) {
            this.pinnedPage = null;
            // Destroy the old editor/undo history, not the independent shared draft.
            this.noteId = null;
            this.editor?.destroy();
            this.editor = null;
            this.content.querySelector(".browser-note")?.remove();
            this.mountEditor(
              drafts!.activatePlaceholder(this.page, PLACEHOLDER_TEXT),
            );
            focusPlaceholder = true;
          }
          this.renderToolbar();
          this.renderLibrary();
          this.renderPageAncestors();
          this.tell(
            hasNote
              ? unlink
                ? "Page unlinked. The Markdown file is kept in the folder."
                : "Note deleted. Start a new note on the blank page."
              : "Page removed from AIC history.",
            "success",
          );
        } catch (error) {
          if (this.valid(generation)) this.fail(error);
        } finally {
          if (this.valid(generation)) {
            this.deleting = false;
            this.content.inert = false;
            this.toolbar.inert = false;
            if (focusPlaceholder && this.valid(generation, context))
              this.content
                .querySelector<HTMLElement>(".browser-note .cm-content")
                ?.focus();
            confirm.disabled = false;
            cancel.disabled = false;
            box.removeAttribute("aria-busy");
            if (this.libraryRefreshDeferred) {
              this.libraryRefreshDeferred = false;
              this.refreshSharedData();
            }
          }
        }
      },
    );
    box.append(cancel, confirm);
    cancel.focus();
  }

  private showNavigation(trigger: HTMLButtonElement): void {
    if (!this.canUseLibrary()) return;
    const box = this.showPopover("Notes", trigger);
    if (!box) return;
    box.append(this.el("h2", "", "Notes"));
    this.appendNavigation(box);
    const filter = box.querySelector<HTMLInputElement>("input");
    if (filter && !filter.hidden) filter.focus();
    else {
      box.tabIndex = -1;
      box.focus();
    }
  }

  private appendNavigation(parent: HTMLElement): void {
    const nav = this.el("section", "browser-navigation");
    const filter = this.el("input", "browser-filter");
    filter.type = "search";
    filter.placeholder = "Find notes";
    filter.setAttribute("aria-label", "Find notes by title or location");
    filter.value = this.filter;
    filter.addEventListener("input", () => {
      this.filter = filter.value;
      this.renderLibrary();
    });
    const tree = this.el("nav", "browser-library");
    tree.setAttribute("aria-label", "Saved notes");
    applyUiComponent(tree, "tree", ["compact", "connected"]);
    nav.append(filter, tree);
    parent.append(nav);
    this.renderLibrary();
  }

  private hasPendingDrafts(): boolean {
    return !!(
      this.drafts?.hasPendingChanges() ||
      this.domainDrafts?.hasPendingChanges() ||
      this.globalDrafts?.hasPendingChanges()
    );
  }

  private send<T>(message: Request): Promise<T> {
    if (message.type === "context") return request<T>(this.api, message);
    return (async () => {
      const generation = this.generation;
      const sourceId = this.source?.id;
      const current = () =>
        this.valid(generation) && this.source?.id === sourceId;
      try {
        const value = await request<T>(this.api, {
          ...message,
          ...(sourceId ? { sourceId } : {}),
        });
        if (!current()) return value;
        if (
          !this.disposed &&
          value &&
          typeof value === "object" &&
          "source" in value
        ) {
          const status = value as unknown as BrowserStatus;
          if (
            message.type !== "connect-source" &&
            this.hasPendingDrafts() &&
            (this.sourceChanged || status.source.id !== sourceId)
          ) {
            this.sourceChanged = true;
            throw Object.assign(
              new Error(
                "The selected files changed in another panel. Your draft still belongs to its original files.",
              ),
              { code: "source" },
            );
          }
          this.source = status.source;
          this.sourceError = status.sourceError ?? "";
          this.sourceErrorCode = status.sourceErrorCode ?? "";
          this.sourceAccessState = status.access;
          if (status.source.id && (!this.privateWindow || this.allowPrivate))
            void this.sourceAccess
              .warm(status.source.id)
              .then(() => {
                if (
                  !this.disposed &&
                  this.source?.id === status.source.id &&
                  !this.sourceChanged &&
                  !this.selectingSource
                ) {
                  this.sourceAccess.select(status.source.id!);
                  this.warmedSourceId = this.sourceAccess.has(status.source.id!)
                    ? status.source.id!
                    : null;
                  this.reflectContinue();
                  this.renderFileLocation();
                }
              })
              .catch(() => {
                if (!this.disposed && this.source?.id === status.source.id)
                  this.tell(
                    "This location could not be restored. Use More options to open the file or folder again.",
                    "error",
                  );
              });
          this.sourceWarnings = status.warnings ?? [];
          this.sourceChanged = false;
          this.renderFileLocation();
        } else if (
          [
            "save",
            "save-domain",
            "save-global",
            "create",
            "create-domain",
            "create-global",
            "delete-page",
            "import",
          ].includes(message.type)
        ) {
          this.sourceError = "";
          this.sourceErrorCode = "";
          if (this.sourceAccessState)
            this.sourceAccessState = { read: "granted", write: "granted" };
          this.renderFileLocation();
        }
        if (message.type === "load" && current())
          void this.send<BrowserStatus>({ type: "status" }).catch(() => {});
        return value;
      } catch (error) {
        if (
          current() &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          ["source", "storage", "conflict", "permission"].includes(
            String(error.code),
          )
        ) {
          this.sourceError =
            error instanceof Error ? error.message : "Reopen the notes file.";
          this.sourceErrorCode = String(error.code);
          this.renderFileLocation();
        }
        throw error;
      }
    })();
  }

  private renderFileLocation(): void {
    this.fileLocation.hidden = !this.source || this.state !== "ready";
    if (!this.source) return;
    // Keep the reconnect target mounted while blur/autosave updates its status.
    // Replacing it between pointerdown and click would consume the first click.
    if (!this.fileLocation.childElementCount) {
      const path = this.el("span", "aic-context__path");
      const status = this.el("span", "aic-context__status");
      status.setAttribute("role", "status");
      const reconnect = this.button(
        "Reconnect access",
        () => this.reconnectFile(),
        { variant: "ghost" },
      );
      reconnect.classList.add("browser-reconnect");
      const notice = this.button("Folder notices", () => {
        const box = this.showPopover("Folder notices", notice);
        if (box)
          for (const message of this.sourceWarnings)
            box.append(this.el("p", "", message));
      });
      notice.classList.add("browser-source-notices");
      this.fileLocation.append(path, status, reconnect, notice);
    }
    const path =
      this.fileLocation.querySelector<HTMLElement>(".aic-context__path")!;
    const status = this.fileLocation.querySelector<HTMLElement>(
      ".aic-context__status",
    )!;
    const reconnect =
      this.fileLocation.querySelector<HTMLButtonElement>(".browser-reconnect")!;
    const notice = this.fileLocation.querySelector<HTMLButtonElement>(
      ".browser-source-notices",
    )!;
    const selected = ["file", "directory"].includes(this.source.kind);
    path.textContent = selected
      ? [
          this.source.kind === "directory" ? this.source.name : "",
          this.activeScope === "global"
            ? this.globalDrafts?.get(this.globalKey ?? "")?.record?.filePath
            : this.activeScope === "shared"
              ? this.domainDrafts?.get(this.domainKey ?? "")?.record?.filePath
              : this.drafts?.get(this.noteId ?? "")?.note?.filePath,
        ]
          .filter(Boolean)
          .join("/") ||
        this.source.name ||
        "Markdown files"
      : "No file or folder selected";
    path.title = selected
      ? `Selected ${this.source.kind === "directory" ? "folder" : "file"}: ${this.source.name}. Edits are written directly to disk.`
      : "Choose a file to keep your notes outside the extension.";
    const needsPermission = this.needsFilePermission();
    reconnect.hidden = !needsPermission || !this.source.id;
    reconnect.disabled =
      this.reconnecting || this.warmedSourceId !== this.source.id;
    reconnect.textContent = reconnect.hidden
      ? ""
      : this.reconnecting
        ? "Connecting…"
        : "Reconnect access";
    reconnect.title =
      this.sourceError ||
      "Allow access to the selected files and retry pending saves.";
    status.hidden = !reconnect.hidden;
    status.textContent = status.hidden
      ? ""
      : this.sourceError
        ? this.sourceErrorCode === "conflict"
          ? "File changed"
          : "Check file"
        : !selected
          ? "Open file or folder"
          : this.hasPendingDrafts()
            ? "Unsaved"
            : this.state === "unavailable"
              ? "Reconnect"
              : "On disk";
    status.dataset.state =
      this.sourceError || needsPermission
        ? "reconnect"
        : !selected || this.hasPendingDrafts()
          ? "dirty"
          : "saved";
    status.title = this.sourceError;
    notice.hidden = !this.sourceWarnings.length;
    notice.textContent = notice.hidden
      ? ""
      : `${this.sourceWarnings.length} ${this.sourceWarnings.length === 1 ? "notice" : "notices"}`;
  }

  private renderScan(): void {
    const running = !!this.fileOperation;
    this.scanView.hidden = !running && this.scan?.phase !== "cancelled";
    if (this.scanView.hidden) return;
    // Progress updates only text. Keep actions mounted so pointer/keyboard input
    // cannot land on a discarded element while an I/O update arrives.
    if (!this.scanView.childElementCount) {
      const row = this.el("div", "browser-scan__row");
      const text = this.el("div", "browser-scan__text");
      const counts = this.el("span", "browser-scan__counts");
      counts.setAttribute("role", "status");
      counts.setAttribute("aria-live", "polite");
      text.append(this.el("strong", "browser-scan__title"), counts);
      const action = this.button(
        "Cancel scan",
        () => {
          if (this.fileOperation) return this.stopScan();
          return this.source?.id === this.scan?.sourceId
            ? this.refreshFiles()
            : this.connectFile("folder");
        },
        { variant: "ghost" },
      );
      row.append(text, action);
      const progress = this.el("progress", "browser-scan__progress");
      progress.setAttribute(
        "aria-label",
        "Reading the selected folder; total size is not yet known",
      );
      const found = this.el("details", "browser-scan__found");
      found.append(this.el("summary", "", "Found notes"), this.el("ul"));
      this.scanView.append(
        row,
        progress,
        this.el("span", "browser-scan__path"),
        found,
      );
    }
    const setText = (selector: string, value: string) => {
      const element = this.scanView.querySelector<HTMLElement>(selector)!;
      if (element.textContent !== value) element.textContent = value;
      return element;
    };
    setText(
      ".browser-scan__title",
      !running
        ? "Scan stopped"
        : this.scanStopping
          ? "Stopping scan…"
          : this.scan?.phase === "reading"
            ? "Reading notes…"
            : this.fileOperation!.label,
    );
    setText(
      ".browser-scan__counts",
      this.scan
        ? `${this.scan.inspected.toLocaleString("en-US")} entries checked · ${this.scan.loaded.toLocaleString("en-US")} notes ready${this.scan.found > this.scan.loaded ? ` · ${this.scan.found.toLocaleString("en-US")} found` : ""}`
        : "Preparing file access…",
    );
    const action = this.scanView.querySelector<HTMLButtonElement>("button")!;
    const label = running
      ? this.scan?.loaded
        ? "Use found notes"
        : "Cancel scan"
      : this.source?.id === this.scan?.sourceId
        ? "Scan again"
        : "Open folder";
    action.setAttribute("aria-label", label);
    if (action.textContent !== label) action.textContent = label;
    action.disabled =
      running &&
      (!this.scan ||
        this.scanStopping ||
        ["complete", "failed", "cancelled"].includes(this.scan.phase));
    action.title = running
      ? "Stop scanning. Already read notes remain available."
      : "Read this folder again for added, changed or removed files.";
    this.scanView.querySelector<HTMLElement>("progress")!.hidden = !running;
    const path = setText(".browser-scan__path", this.scan?.path ?? "");
    path.title = this.scan?.path ?? "";
    path.hidden = !running || !this.scan?.path;
    const found = this.scanView.querySelector<HTMLDetailsElement>("details")!;
    found.hidden = !running || this.scanNotes.length === 0;
    const signature = JSON.stringify(
      this.scanNotes.map((note) => note.filePath),
    );
    if (found.dataset.paths !== signature) {
      found.dataset.paths = signature;
      found.querySelector("ul")!.replaceChildren(
        ...this.scanNotes.map((note) => {
          const item = this.el("li", "", note.filePath);
          item.title = note.filePath;
          return item;
        }),
      );
    }
  }

  private async pollScan(
    operation: NonNullable<BrowserPanel["fileOperation"]>,
    schedule = true,
  ): Promise<void> {
    if (this.disposed || this.fileOperation !== operation) return;
    if (operation.poll) {
      await operation.poll;
      return;
    }
    // A tick and the final drain share one cursor. Never ask for the same page
    // concurrently: an older response could append duplicates or regress progress.
    const pending = (async () => {
      try {
        const result = await request<BrowserScanStatus>(this.api, {
          type: "scan-status",
          ...(this.scan ? { id: this.scan.id, after: this.scanOffset } : {}),
        });
        if (this.disposed || this.fileOperation !== operation) return;
        if (
          result?.scan &&
          (!operation.candidateId ||
            result.scan.sourceId === operation.candidateId)
        ) {
          if (this.scan?.id !== result.scan.id) {
            this.scanNotes = [];
            this.scanOffset = 0;
          }
          this.scan = result.scan;
          this.scanOffset = result.next;
          this.scanNotes.push(
            ...result.notes.slice(0, Math.max(0, 8 - this.scanNotes.length)),
          );
          this.renderScan();
        }
      } catch {
        // The main operation owns errors. A progress read cannot invalidate it.
      }
    })();
    operation.poll = pending;
    try {
      await pending;
    } finally {
      if (operation.poll === pending) operation.poll = null;
    }
    if (
      schedule &&
      !operation.finishing &&
      !this.disposed &&
      this.fileOperation === operation
    )
      this.scanTimer = setTimeout(() => void this.pollScan(operation), 300);
  }

  private async withFileProgress<T>(
    label: string,
    work: () => Promise<T>,
    candidateId?: string,
  ): Promise<T> {
    const operation: NonNullable<BrowserPanel["fileOperation"]> = {
      label,
      candidateId,
      poll: null,
      finishing: false,
    };
    this.fileOperation = operation;
    this.scan = null;
    this.scanOffset = 0;
    this.scanNotes = [];
    this.scanStopping = false;
    this.renderScan();
    try {
      const result = work();
      void this.pollScan(operation);
      return await result;
    } finally {
      operation.finishing = true;
      if (this.fileOperation === operation) {
        if (this.scanTimer) clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }
      // Drain the last tick before reading the final page with its advanced cursor.
      await operation.poll;
      await this.pollScan(operation, false);
      if (this.fileOperation === operation) {
        this.fileOperation = null;
        if (!this.disposed) this.renderScan();
      }
    }
  }

  private async stopScan(): Promise<void> {
    if (!this.scan || !this.fileOperation || this.scanStopping) return;
    this.scanStopping = true;
    this.renderScan();
    try {
      await request(this.api, { type: "cancel-scan", id: this.scan.id });
    } catch (error) {
      this.scanStopping = false;
      this.renderScan();
      this.fail(error);
    }
  }

  private async refreshFiles(): Promise<void> {
    if (!this.source?.id || this.fileOperation) return;
    this.closeOverlay();
    this.content.inert = this.toolbar.inert = true;
    try {
      if (!(await this.flushAllDrafts()))
        throw new Error("Save or export your draft before refreshing files.");
      const selected = this.selectedFileId;
      const pinned = this.pinnedPage;
      const status = await this.withFileProgress(
        "Scanning folder…",
        () => this.send<BrowserStatus>({ type: "refresh-files" }),
        this.source.id,
      );
      if (this.disposed) return;
      this.clearPlaintext();
      this.state = status.state;
      this.selectedFileId = selected;
      this.pinnedPage = pinned;
      this.render();
      if (this.canUseLibrary()) await this.startEditing();
    } finally {
      this.content.inert = this.toolbar.inert = false;
    }
  }

  private needsFilePermission(): boolean {
    return (
      this.sourceErrorCode === "permission" ||
      (!!this.sourceAccessState && this.sourceAccessState.write !== "granted")
    );
  }

  private canOpenInTab(): boolean {
    return (
      !this.privateWindow &&
      this.windowId !== null &&
      typeof this.api.runtime.getURL === "function"
    );
  }

  /** A grant made in another AIC surface can resume this source without repicking. */
  private async resumeGrantedAccess(): Promise<void> {
    if (
      this.disposed ||
      this.checkingAccess ||
      this.selectingSource ||
      this.reconnecting ||
      this.fileOperation ||
      this.sourceChanged ||
      !this.source?.id ||
      this.document.visibilityState === "hidden" ||
      (this.privateWindow && !this.allowPrivate) ||
      (this.state !== "unavailable" && !this.needsFilePermission())
    )
      return;
    this.checkingAccess = true;
    const generation = this.generation;
    const sourceId = this.source.id;
    try {
      const status = await request<BrowserStatus>(this.api, {
        type: "status",
        sourceId,
      });
      if (
        !this.valid(generation) ||
        this.reconnecting ||
        this.selectingSource ||
        this.fileOperation ||
        this.source?.id !== sourceId ||
        status.source.id !== sourceId ||
        status.state !== "ready" ||
        status.access?.write !== "granted"
      )
        return;
      if (
        !(await this.flushAllDrafts()) ||
        !this.valid(generation) ||
        this.source?.id !== sourceId
      )
        return;
      this.sourceError = status.sourceError ?? "";
      this.sourceErrorCode = status.sourceErrorCode ?? "";
      this.sourceAccessState = status.access;
      this.sourceWarnings = status.warnings ?? [];
      if (this.state !== "ready") {
        this.state = "ready";
        this.render();
        await this.startEditing();
      }
      this.renderFileLocation();
    } catch {
      // Passive observation must not replace the current draft or prompt the user.
    } finally {
      this.checkingAccess = false;
    }
  }

  private async reconnectFile(): Promise<void> {
    if (this.privateWindow && !this.allowPrivate)
      throw new Error("Read and accept the private-window notice first.");
    if (!this.source?.id) return this.connectFile("file");
    if (this.reconnecting || this.fileOperation) return;
    const sourceId = this.source.id;
    const generation = this.generation;
    const current = () =>
      this.valid(generation) &&
      this.source?.id === sourceId &&
      !this.sourceChanged;
    this.reconnecting = true;
    this.reflectContinue();
    try {
      // Invoke permission on the retained handle inside the trusted click.
      const permission = this.sourceAccess.reconnect(sourceId);
      this.renderFileLocation();
      await permission;
      if (!current()) return;
      this.closeOverlay();
      const status = await this.withFileProgress(
        "Reconnecting files…",
        async () => {
          if (!(await this.flushAllDrafts()))
            throw new Error(
              "File access restored. Retry saving the unsaved draft.",
            );
          if (!current()) return null;
          return request<BrowserStatus>(this.api, { type: "status", sourceId });
        },
        sourceId,
      );
      if (!current() || !status) return;
      if (status.source.id !== sourceId) {
        this.sourceChanged = true;
        throw new Error(
          "The selected files changed in another panel. Your draft is unchanged.",
        );
      }
      this.sourceError = status.sourceError ?? "";
      this.sourceErrorCode = status.sourceErrorCode ?? "";
      this.sourceAccessState = status.access;
      if (
        status.state !== "ready" ||
        (status.access && status.access.write !== "granted")
      )
        throw new Error(
          status.sourceError ||
            "File access is still unavailable. Your draft is unchanged.",
        );
      if (status.state !== this.state) {
        this.state = status.state;
        this.render();
        if (this.canUseLibrary()) await this.startEditing();
      }
      if (current()) this.tell("File access restored.");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "permission" &&
        this.canOpenInTab()
      ) {
        const message =
          error instanceof Error
            ? error.message
            : "File access was not allowed.";
        throw new Error(
          `${message} If the browser does not show a permission prompt here, choose More options → Open AIC in tab.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      this.reconnecting = false;
      if (!this.disposed) {
        this.renderFileLocation();
        this.reflectContinue();
      }
    }
  }

  private async connectFile(mode: "file" | "folder" | "create"): Promise<void> {
    if (this.privateWindow && !this.allowPrivate)
      throw new Error("Read and accept the private-window notice first.");
    if (this.selectingSource || this.reconnecting || this.fileOperation) return;
    this.selectingSource = true;
    const generation = this.generation;
    // Freeze input until the old draft is acknowledged and the new source is mounted.
    // A keystroke during the file commit must never be discarded by clearPlaintext().
    this.content.inert = this.toolbar.inert = this.overlay.inert = true;
    try {
      // Start the system picker during the trusted click, before flushing.
      const id = await chooseBrowserSource(mode, undefined, this.sourceAccess);
      if (!id || !this.valid(generation)) return;
      if (!(await this.flushAllDrafts()))
        throw new Error(
          "Save or export your unsaved drafts before changing files.",
        );
      const status = await this.withFileProgress(
        mode === "folder" ? "Scanning folder…" : "Opening file…",
        () =>
          this.send<BrowserStatus>({
            type: "connect-source",
            bindingId: id,
            mode: mode === "create" ? "create" : "open",
          }),
        id,
      );
      if (this.disposed) return;
      this.clearPlaintext();
      this.source = status.source;
      this.sourceError = status.sourceError ?? "";
      this.sourceErrorCode = status.sourceErrorCode ?? "";
      this.sourceAccessState = status.access;
      this.sourceChanged = false;
      this.state = status.state;
      this.closeOverlay();
      this.render();
      if (this.canUseLibrary()) await this.startEditing();
      if (
        mode === "folder" &&
        this.source?.id === id &&
        this.library.notes.length
      ) {
        const navigation = this.toolbar.querySelector<HTMLButtonElement>(
          '[aria-label="Notes"]',
        );
        if (navigation) this.showNavigation(navigation);
      }
    } catch (error) {
      // Refresh the chosen location without discarding a pending draft.
      if (!this.hasPendingDrafts() && !this.disposed)
        await this.recoverConnectionFailure(error, this.generation);
      else throw error;
    } finally {
      this.selectingSource = false;
      if (!this.disposed && this.source?.id) {
        this.sourceAccess.select(this.source.id);
        this.warmedSourceId = this.sourceAccess.has(this.source.id)
          ? this.source.id
          : null;
        this.reflectContinue();
        this.renderFileLocation();
      }
      this.content.inert = this.toolbar.inert = this.overlay.inert = false;
    }
  }

  private async selectFile(id: string): Promise<void> {
    const generation = this.generation;
    this.content.inert = true;
    try {
      if (!(await this.flushAllDrafts()))
        throw new Error("Save or export this draft before switching files.");
      if (!this.valid(generation)) return;
      this.dropEditor();
      ++this.contextGeneration;
      this.selectedFileId = id;
      this.pinnedPage = null;
      this.closeOverlay();
      this.renderPage();
      this.renderFileLocation();
    } finally {
      this.content.inert = false;
    }
  }

  private newFile(trigger: HTMLButtonElement): Promise<void> | void {
    if (this.source?.kind !== "directory") return this.connectFile("create");
    this.closeOverlay();
    const box = this.showPopover("New Markdown file", trigger);
    if (!box) return;
    const form = this.el("form");
    const label = this.el("label", "browser-field", "File name");
    const path = this.el("input");
    path.setAttribute("aria-label", "File name");
    path.placeholder = "note.md";
    path.value = "note.md";
    path.required = true;
    label.append(path);
    const submit = this.button("Create file", () => {});
    submit.type = "submit";
    form.append(label, submit);
    const generation = this.generation;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      this.content.inert = true;
      void (async () => {
        if (!(await this.flushAllDrafts()))
          throw new Error("Save or export this draft first.");
        if (!this.valid(generation)) return;
        const note = await this.send<BrowserNote>({
          type: "create-file",
          path: path.value,
          markdown: "",
        });
        if (!this.valid(generation)) return;
        this.library.notes.push(note);
        await this.selectFile(note.id);
      })()
        .catch((error: unknown) => {
          if (this.valid(generation)) this.fail(error);
        })
        .finally(() => {
          if (this.valid(generation)) {
            submit.disabled = false;
            this.content.inert = false;
          }
        });
    });
    box.append(form);
    path.focus();
    path.select();
  }

  private async linkSelectedFile(): Promise<void> {
    if (!this.selectedFileId || this.windowId === null) return;
    const generation = this.generation;
    const id = this.selectedFileId;
    if (!(await this.flushAllDrafts()))
      throw new Error("Save this file before linking it.");
    const page = await this.send<ActivePage | null>({
      type: "context",
      windowId: this.windowId,
      allowPrivate: this.allowPrivate,
    });
    if (!this.valid(generation)) return;
    if (!page) throw new Error("Open a web page to link this file.");
    const note = await this.send<BrowserNote>({
      type: "link-file",
      id,
      page,
      allowPrivate: this.allowPrivate,
    });
    if (!this.valid(generation)) return;
    this.library.notes = this.library.notes.map((item) =>
      item.id === note.id ? note : item,
    );
    this.closeOverlay();
    this.tell("File linked to the current page.");
  }

  private async initialize(): Promise<void> {
    const generation = this.generation;
    try {
      const current = await this.api.windows.getCurrent();
      if (!this.valid(generation)) return;
      if (current.id === undefined)
        throw new Error("This browser window is unavailable.");
      this.windowId = current.id;
      this.privateWindow = !!current.incognito;
      const status =
        this.privateWindow && !this.allowPrivate
          ? await this.send<BrowserStatus>({ type: "status" })
          : await this.withFileProgress("Opening your notes…", () =>
              this.send<BrowserStatus>({ type: "status" }),
            );
      if (!this.valid(generation)) return;
      this.state = status.state;
      this.render();
      if (this.canUseLibrary()) await this.startEditing();
    } catch (error) {
      if (this.valid(generation)) this.fail(error);
    }
  }

  private canUseLibrary(): boolean {
    return (
      this.state === "ready" &&
      this.document.visibilityState !== "hidden" &&
      (!this.privateWindow || this.allowPrivate)
    );
  }

  private render(): void {
    this.dropEditor();
    this.root.dataset.state = this.state;
    this.root.dataset.privateConsent =
      this.privateWindow && !this.allowPrivate ? "required" : "granted";
    this.renderToolbar();
    this.renderFileLocation();
    this.content.replaceChildren();
    if (this.privateWindow && !this.allowPrivate) {
      const gate = this.el("section", "browser-gate");
      gate.append(
        this.el("h1", "", "AIC in a private window"),
        this.el(
          "p",
          "",
          "Notes stay in the selected files after private browsing ends. Local draft recovery also remains on this device.",
        ),
      );
      gate.append(
        this.button("Use AIC in this private window", async () => {
          this.allowPrivate = true;
          this.render();
          if (this.state === "ready") await this.startEditing();
        }),
      );
      this.content.append(gate);
      return;
    }
    if (!this.canUseLibrary()) {
      const gate = this.el("section", "browser-gate browser-files-gate");
      const remembered = this.source?.id && this.state === "unavailable";
      gate.append(
        this.el("h1", "", remembered ? "Your notes" : "Open your notes"),
      );
      if (remembered) {
        const name = this.el(
          "p",
          "browser-source-name",
          this.source!.name || "Markdown files",
        );
        name.title = name.textContent ?? "";
        const resume = this.button("Continue", () => this.reconnectFile(), {
          icon: "folder",
        });
        resume.dataset.continueSource = "true";
        gate.append(name, resume);
      } else {
        const actions = this.el("div", "browser-file-actions");
        actions.append(
          this.button("Open folder", () => this.connectFile("folder"), {
            icon: "folder",
          }),
          this.button("Open file", () => this.connectFile("file"), {
            icon: "document",
            variant: "ghost",
          }),
        );
        gate.append(actions);
      }
      this.content.append(gate);
      this.reflectContinue();
      return;
    }
    this.renderPage();
  }

  private reflectContinue(): void {
    const button = this.content.querySelector<HTMLButtonElement>(
      "[data-continue-source]",
    );
    if (!button) return;
    const ready = this.source?.id === this.warmedSourceId;
    button.disabled = !ready || this.reconnecting;
    button.setAttribute("aria-busy", String(!ready || this.reconnecting));
    button.title = !ready
      ? "Preparing access to the selected files…"
      : "Continue with the selected files";
  }

  private async startEditing(): Promise<void> {
    if (!this.canUseLibrary()) return;
    if (!this.drafts) {
      const generation = this.generation;
      this.drafts = new BrowserDrafts(
        async (id, markdown, revision) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          return this.send<BrowserNote>({
            type: "save",
            id,
            markdown,
            revision,
          });
        },
        (draft) => {
          if (!this.valid(generation)) return;
          if (draft.note) {
            const index = this.library.notes.findIndex(
              (note) => note.id === draft.note!.id,
            );
            const metadataChanged =
              index < 0 ||
              this.library.notes[index]!.title !== draft.note.title ||
              this.library.notes[index]!.url !== draft.note.url;
            if (index < 0) this.library.notes.push(draft.note);
            else this.library.notes[index] = draft.note;
            if (metadataChanged) this.renderPageAncestors();
          }
          if (this.noteId === draft.key) this.reflectDraft(draft);
          this.renderDraftWarnings();
        },
        async (page, markdown) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          if (!this.page || this.page.url !== page.url)
            throw { code: "page_changed" };
          return this.send<BrowserNote>({
            type: "create",
            page: { ...this.page },
            markdown,
            allowPrivate: this.allowPrivate,
            ifAbsent: true,
          });
        },
      );
    }
    if (!this.domainDrafts) {
      const generation = this.generation;
      this.domainDrafts = new DomainDrafts(
        async (id, markdown, revision) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          return this.send<BrowserDomain>({
            type: "save-domain",
            id,
            markdown,
            revision,
          });
        },
        (draft) => {
          if (!this.valid(generation)) return;
          if (draft.record) {
            const index = this.library.domains.findIndex(
              (item) => item.origin === draft.record!.origin,
            );
            if (index < 0) this.library.domains.push(draft.record);
            else if (!draft.dirty && !draft.saving)
              this.library.domains[index] = draft.record;
          }
          if (this.domainKey === draft.key) this.reflectDomainDraft(draft);
          this.renderDraftWarnings();
          if (this.domainRefreshDeferred && !draft.saving) {
            this.domainRefreshDeferred = false;
            this.refreshSharedData();
          }
        },
        async (context, markdown) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          if (!this.page || new URL(this.page.url).origin !== context.origin)
            throw { code: "page_changed" };
          return this.send<BrowserDomain>({
            type: "create-domain",
            page: { ...this.page },
            markdown,
            allowPrivate: this.allowPrivate,
          });
        },
      );
    }
    if (!this.globalDrafts) {
      const generation = this.generation;
      this.globalDrafts = new GlobalDrafts(
        async (id, markdown, revision) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          return this.send<BrowserGlobal>({
            type: "save-global",
            id,
            markdown,
            revision,
          });
        },
        (draft) => {
          if (!this.valid(generation)) return;
          if (
            draft.record &&
            (!this.library.global || (!draft.dirty && !draft.saving))
          )
            this.library.global = draft.record;
          if (this.globalKey === draft.key)
            this.reflectDomainDraft(draft, this.globalShared);
          this.renderDraftWarnings();
          if (this.globalRefreshDeferred && !draft.saving) {
            this.globalRefreshDeferred = false;
            this.refreshSharedData();
          }
        },
        async (_context, markdown) => {
          if (!this.valid(generation))
            throw new Error("The notes location changed.");
          return this.send<BrowserGlobal>({
            type: "create-global",
            markdown,
          });
        },
      );
    }
    await this.refreshContext();
    await this.loadRecoveredDrafts();
  }

  private async recoverConnectionFailure(
    error: unknown,
    generation: number,
  ): Promise<void> {
    try {
      const previousSource = this.source?.id ?? this.source?.kind;
      const status = await this.send<BrowserStatus>({ type: "status" });
      if (!this.valid(generation)) return;
      if (
        status.state !== this.state ||
        previousSource !== (this.source?.id ?? this.source?.kind)
      ) {
        this.closeOverlay();
        this.state = status.state;
        this.render();
        if (this.canUseLibrary()) await this.startEditing();
      }
    } catch {
      /* Keep the original actionable error when status is unavailable. */
    }
    if (this.valid(generation)) this.fail(error);
  }

  private contextChanged(): void {
    if (!this.canUseLibrary()) return;
    if (this.selectedFileId) {
      void this.refreshActivePage();
      this.refreshSharedData();
    } else if (this.pinnedPage) void this.refreshActivePage();
    else void this.refreshContext();
  }

  private async refreshActivePage(): Promise<void> {
    const active = ++this.activeGeneration;
    this.activePage = null;
    if (!this.canUseLibrary() || this.windowId === null) return;
    const generation = this.generation;
    try {
      const page = await this.send<ActivePage | null>({
        type: "context",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (
        this.valid(generation) &&
        active === this.activeGeneration &&
        this.canUseLibrary()
      )
        this.activePage = page;
    } catch (error) {
      if (this.valid(generation) && active === this.activeGeneration)
        this.fail(error);
    }
  }

  private async togglePin(): Promise<void> {
    if (!this.page || !this.noteId || this.importing || this.deleting) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    if (!(await this.flushAllDrafts())) {
      this.tell(
        "Save or export your unsaved draft before changing its pin.",
        "error",
      );
      return;
    }
    if (!this.valid(generation, context)) return;
    if (this.pinnedPage) {
      this.pinnedPage = null;
      await this.refreshContext();
      this.toolbar
        .querySelector<HTMLButtonElement>('[aria-label="More options"]')
        ?.focus();
    } else if (this.drafts?.get(this.noteId)?.note) {
      this.pinnedPage = { ...this.page };
      this.renderToolbar();
      this.toolbar
        .querySelector<HTMLButtonElement>('[aria-label="More options"]')
        ?.focus();
    }
  }

  private dropEditor(): void {
    ++this.editorGeneration;
    this.scopeTabs?.dispose();
    this.scopeTabs = null;
    this.activeScope = "current";
    this.noteId = null;
    this.editor?.destroy();
    this.editor = null;
    this.shared?.destroy();
    this.shared = null;
    this.domainKey = null;
    this.globalShared?.destroy();
    this.globalShared = null;
    this.globalKey = null;
    this.content.dataset.domainEditing = "false";
  }

  private async refreshContext(): Promise<void> {
    if (!this.canUseLibrary() || this.windowId === null) return;
    if (this.pinnedPage) {
      await this.refreshActivePage();
      if (!this.canUseLibrary() || !this.pinnedPage) return;
      if (!this.page) {
        this.page = { ...this.pinnedPage };
        this.renderPage();
      }
      this.refreshSharedData();
      return;
    }
    const selectedScope = this.activeScope;
    this.activePage = null;
    ++this.activeGeneration;
    this.clearMarkdownImport();
    const generation = this.generation;
    const context = ++this.contextGeneration;
    this.contextLoading = true;
    this.setImporting(false);
    this.dropEditor();
    this.activeScope = selectedScope;
    this.page = null;
    this.closeOverlay();
    this.tell("");
    this.renderPage();
    try {
      const page = await this.send<ActivePage | null>({
        type: "context",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      const library = await this.send<BrowserLibrary>({
        type: "visit",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      this.page = page;
      this.activePage = page;
      this.library = library;
      if (this.source?.kind === "file" && !this.selectedFileId)
        this.selectedFileId = library.notes[0]?.id ?? null;
      this.contextLoading = false;
      this.renderPage();
    } catch (error) {
      if (this.valid(generation, context)) {
        this.contextLoading = false;
        this.renderPage();
        this.fail(error);
      }
    }
  }

  private renderPage(): void {
    if (!this.canUseLibrary()) return;
    this.renderToolbar();
    this.content.replaceChildren();
    if (this.contextLoading) {
      this.content.append(
        this.el("p", "browser-loading", "Loading this page’s note…"),
      );
      return;
    }
    if (this.source?.kind !== "file") this.mountGlobalProperties();
    if (this.selectedFileId) {
      const note = this.library.notes.find(
        (item) => item.id === this.selectedFileId,
      );
      if (note) this.mountEditor(this.drafts!.activate(note));
      else
        this.content.append(
          this.el(
            "p",
            "browser-empty-context",
            "This file is no longer available. Open its location again.",
          ),
        );
    } else if (this.page && this.source?.kind !== "file") {
      this.mountSharedProperties();
      this.content.append(this.el("nav", "browser-page-ancestors"));
      this.renderPageAncestors();
      const note = this.library.notes.find(
        (item) => item.url === this.page!.url,
      );
      this.mountEditor(
        note
          ? this.drafts!.activate(note)
          : this.drafts!.activatePlaceholder(this.page, PLACEHOLDER_TEXT),
      );
    } else {
      const empty = this.el("section", "browser-empty-context");
      empty.append(this.el("p", "", "Open a web page to start a note."));
      this.content.append(empty);
      this.appendNavigation(this.content);
    }
    const warnings = this.el("div", "browser-draft-warnings");
    this.content.append(warnings);
    if (this.source?.kind !== "file") this.mountScopeTabs();
    this.renderDraftWarnings();
  }

  private mountEditor(draft: Draft): void {
    const generation = this.generation;
    const context = this.contextGeneration;
    const editorGeneration = ++this.editorGeneration;
    this.noteId = draft.key;
    const host = this.el("section", "browser-note");
    const editorHost = this.el("div", "browser-editor-host");
    host.append(editorHost);
    this.content.append(host);
    this.editor = new AicEditor(editorHost, {
      initialText: draft.text,
      showEditorHelp: false,
      onChange: (text) => {
        if (
          this.valid(generation, context) &&
          this.editorGeneration === editorGeneration &&
          this.noteId === draft.key &&
          !this.deleting
        )
          this.drafts?.edit(draft.key, text);
      },
      onSave: () =>
        this.valid(generation, context) &&
        this.editorGeneration === editorGeneration &&
        this.noteId === draft.key &&
        !this.deleting
          ? this.drafts!.flush(draft.key)
          : false,
    });
    this.editor.switchDocument(draft.key, draft.text);
    this.editor.view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorState.transactionFilter.of((transaction) => {
          if (
            !transaction.docChanged ||
            !transaction.isUserEvent("input") ||
            !this.pinnedPage ||
            !this.activePage ||
            this.deleting
          )
            return transaction;
          const change = relatedPageLink(
            transaction.newDoc.toString(),
            this.activePage,
            this.pinnedPage.url,
          );
          return change
            ? [
                transaction,
                {
                  changes: change,
                  selection: transaction.newSelection.map(
                    ChangeSet.of(change, transaction.newDoc.length),
                    -1,
                  ),
                  sequential: true,
                },
              ]
            : transaction;
        }),
      ),
    });
    if (!draft.note && !draft.dirty && draft.text === PLACEHOLDER_TEXT)
      this.editor.view.dispatch({ selection: { anchor: draft.text.length } });
    this.reflectDraft(draft);
    this.renderToolbar();
  }

  private reflectDraft(draft: Draft): void {
    const pin =
      this.overlay.querySelector<HTMLButtonElement>("[data-pin-note]");
    if (pin) {
      pin.disabled = !this.pinnedPage && !draft.note && !draft.dirty;
      pin.title = pin.disabled
        ? "Write a note before pinning it"
        : this.pinnedPage
          ? "Unpin note and follow the active tab"
          : "Keep this note open and link pages you write about";
    }
    this.editor?.setSaveState(
      draft.dirty ? "dirty" : draft.note ? "saved" : "placeholder",
      draft.saving,
      draft.error
        ? "failed"
        : draft.saving
          ? "saving"
          : draft.dirty
            ? "dirty"
            : draft.note
              ? "saved"
              : "none",
    );
  }

  private mountSharedProperties(): void {
    if (!this.page || !this.domainDrafts) return;
    const origin = new URL(this.page.url).origin;
    const record = this.library.domains.find((item) => item.origin === origin);
    const draft = record
      ? this.domainDrafts.activate(record)
      : this.domainDrafts.activatePlaceholder(
          { origin, title: origin },
          PLACEHOLDER_TEXT,
        );
    this.domainKey = draft.key;
    const generation = this.generation;
    const context = this.contextGeneration;
    const host = this.el("section", "browser-shared-host");
    host.dataset.scope = "domain";
    this.content.append(host);
    this.shared = new DomainPropertiesView(host, {
      origin,
      initialText: draft.text,
      onChange: (text) => {
        if (this.valid(generation, context))
          this.domainDrafts?.edit(draft.key, text);
      },
      onSave: async (text) => {
        if (!this.valid(generation, context)) return false;
        this.domainDrafts!.edit(draft.key, text);
        return this.domainDrafts!.flush(draft.key);
      },
    });
    this.reflectDomainDraft(draft);
  }

  private mountGlobalProperties(): void {
    if (!this.globalDrafts) return;
    const draft = this.library.global
      ? this.globalDrafts.activate(this.library.global)
      : this.globalDrafts.activatePlaceholder(GLOBAL_CONTEXT, PLACEHOLDER_TEXT);
    this.globalKey = draft.key;
    const generation = this.generation;
    const context = this.contextGeneration;
    const host = this.el("section", "browser-shared-host");
    host.dataset.scope = "global";
    this.content.append(host);
    this.globalShared = new DomainPropertiesView(host, {
      origin: "Global Shared",
      scope: "global",
      initialText: draft.text,
      onChange: (text) => {
        if (this.valid(generation, context))
          this.globalDrafts?.edit(draft.key, text);
      },
      onSave: (text) => {
        if (!this.valid(generation, context)) return Promise.resolve(false);
        this.globalDrafts!.edit(draft.key, text);
        return this.globalDrafts!.flush(draft.key);
      },
    });
    this.reflectDomainDraft(draft, this.globalShared);
  }

  private mountScopeTabs(): void {
    this.scopeTabs?.dispose();
    if (this.activeScope === "shared" && (!this.page || this.selectedFileId))
      this.activeScope = "current";
    const current = this.el("section", "browser-scope-panel");
    const shared = this.el("section", "browser-scope-panel");
    const global = this.el("section", "browser-scope-panel");
    current.dataset.scope = "current";
    shared.dataset.scope = "shared";
    global.dataset.scope = "global";
    for (const child of [...this.content.children]) {
      if (child.classList.contains("browser-draft-warnings")) continue;
      if (child.matches('.browser-shared-host[data-scope="global"]'))
        global.append(child);
      else if (child.matches('.browser-shared-host[data-scope="domain"]'))
        shared.append(child);
      else current.append(child);
    }
    if (!this.page || this.selectedFileId)
      shared.append(
        this.el(
          "p",
          "browser-empty-context",
          this.selectedFileId
            ? "Follow the active tab to use Shared notes."
            : "Open a web page to use its Shared notes.",
        ),
      );
    const generation = this.generation;
    const context = this.contextGeneration;
    this.scopeTabs = createScopeTabs(this.document, {
      label: "Note scope",
      selected: this.activeScope,
      items: [
        { id: "current", label: "Current", panel: current },
        {
          id: "shared",
          label: "Shared",
          panel: shared,
          disabled: !this.page || !!this.selectedFileId,
          title: this.selectedFileId
            ? "Follow active tab to use Shared notes"
            : !this.page
              ? "Open a web page to use Shared notes"
              : undefined,
        },
        { id: "global", label: "Global", panel: global },
      ],
      onSelect: async (_id, previous) => {
        if (!this.valid(generation, context) || this.importing || this.deleting)
          return false;
        const saved =
          previous === "current"
            ? await (this.noteId
                ? (this.drafts?.flush(this.noteId) ?? true)
                : true)
            : previous === "shared"
              ? ((await this.shared?.save()) ?? true)
              : ((await this.globalShared?.save()) ?? true);
        if (!saved && this.valid(generation, context))
          this.tell(
            "Scope change paused. Save or export this draft before leaving.",
          );
        return saved && this.valid(generation, context);
      },
      onSelected: (id) => {
        this.activeScope = id as "current" | "shared" | "global";
        this.closeOverlay();
        this.content.dataset.scope = id;
        this.renderToolbar();
        this.renderDraftWarnings();
        if (id === "current") this.editor?.view.requestMeasure();
        else
          (id === "shared" ? this.shared : this.globalShared)?.refreshTheme();
      },
    });
    this.content.prepend(this.scopeTabs.element, current, shared, global);
    this.content.dataset.scope = this.activeScope;
    this.renderToolbar();
  }

  private renderPageAncestors(): void {
    const nav = this.content.querySelector<HTMLElement>(
      ".browser-page-ancestors",
    );
    if (!nav || !this.page) return;
    const parents = savedPageAncestors(this.page.url, this.library.notes);
    nav.replaceChildren();
    nav.hidden = parents.length === 0;
    nav.setAttribute("aria-label", "Parent page notes");
    applyUiComponent(nav, "tree", ["ancestors"]);
    if (!parents.length) return;
    const list = this.el("ol");
    for (const parent of parents) {
      const item = this.el("li");
      const link = this.button(displayPageTitle(parent), () =>
        this.navigate(parent.url),
      );
      link.title = displayPageLocation(parent.url);
      item.append(link);
      list.append(item);
    }
    const current = this.el(
      "li",
      "browser-ancestor-current",
      displayPageTitle(this.page),
    );
    current.setAttribute("aria-current", "page");
    current.title = displayPageLocation(this.page.url);
    list.append(current);
    nav.append(list);
  }

  private reflectDomainDraft(
    draft: DomainDraft | GlobalDraft,
    view = this.shared,
  ): void {
    if (!view) return;
    if (!draft.dirty && !draft.saving && draft.record)
      view.update(draft.record.markdown);
    view.setSaveState(
      draft.dirty ? "dirty" : draft.record ? "saved" : "placeholder",
      draft.saving,
      draft.error
        ? "failed"
        : draft.saving
          ? "saving"
          : draft.dirty
            ? "dirty"
            : draft.record
              ? "saved"
              : "none",
    );
  }

  private refreshSharedData(): void {
    if (!this.canUseLibrary()) return;
    if (this.deleting) {
      this.libraryRefreshDeferred = true;
      return;
    }
    ++this.domainReloadRevision;
    if (this.domainReload) return;
    const generation = this.generation;
    const operation = (async () => {
      let processed = -1;
      while (
        this.valid(generation) &&
        this.canUseLibrary() &&
        processed !== this.domainReloadRevision
      ) {
        processed = this.domainReloadRevision;
        const context = this.contextGeneration;
        const observedDomains = [...this.library.domains];
        const observedGlobal = this.library.global;
        const library = await this.send<BrowserLibrary>({
          type: "load",
        });
        if (!this.valid(generation, context)) continue;
        // A local ACK or a newer reload request may overtake this read. Read
        // again; content hashes cannot establish which observation came later.
        if (
          processed !== this.domainReloadRevision ||
          !sameScopeObservation(observedGlobal, this.library.global) ||
          observedDomains.length !== this.library.domains.length ||
          observedDomains.some(
            (record) =>
              !sameScopeObservation(
                record,
                this.library.domains.find(
                  (item) => item.origin === record.origin,
                ) ?? null,
              ),
          )
        ) {
          if (processed === this.domainReloadRevision)
            ++this.domainReloadRevision;
          continue;
        }
        if (this.deleting) {
          this.libraryRefreshDeferred = true;
          continue;
        }
        this.library.notes = library.notes;
        this.library.history = library.history;
        this.renderLibrary();
        this.renderPageAncestors();
        for (const record of library.domains) {
          const index = this.library.domains.findIndex(
            (item) => item.origin === record.origin,
          );
          if (index < 0) this.library.domains.push(record);
          else if (
            record.filePath ||
            this.library.domains[index]!.filePath ||
            this.library.domains[index]!.revision <= record.revision
          )
            this.library.domains[index] = record;
        }
        if (
          library.global &&
          (!this.library.global ||
            library.global.id !== this.library.global.id ||
            library.global.filePath ||
            this.library.global.filePath ||
            library.global.revision >= this.library.global.revision)
        )
          this.library.global = library.global;
        if (this.globalShared && this.globalDrafts && this.library.global) {
          if (this.globalKey && this.globalDrafts.get(this.globalKey)?.saving)
            this.globalRefreshDeferred = true;
          else {
            const draft = this.globalDrafts.activate(this.library.global);
            this.globalKey = draft.key;
            if (!draft.dirty) this.globalShared.update(draft.text);
            this.reflectDomainDraft(draft, this.globalShared);
          }
        }
        if (!this.page || !this.shared || !this.domainDrafts) continue;
        const origin = new URL(this.page.url).origin;
        const record = this.library.domains.find(
          (item) => item.origin === origin,
        );
        if (!record) continue;
        // The file change event can precede our own write acknowledgment.
        // Let the coordinator consume it before treating a newer revision as remote.
        if (this.domainKey && this.domainDrafts.get(this.domainKey)?.saving) {
          this.domainRefreshDeferred = true;
          continue;
        }
        const draft = this.domainDrafts.activate(record);
        this.domainKey = draft.key;
        if (!draft.dirty) this.shared.update(draft.text);
        this.reflectDomainDraft(draft);
      }
    })()
      .catch(() => {
        if (this.valid(generation))
          this.tell(
            "Shared notes could not refresh. Reopen the panel to retry.",
            "error",
          );
      })
      .finally(() => {
        if (this.domainReload === operation) this.domainReload = null;
      });
    this.domainReload = operation;
  }

  private async flushAllDrafts(): Promise<boolean> {
    const results = await Promise.all([
      this.drafts?.flushAll() ?? true,
      this.domainDrafts?.flushAll() ?? true,
      this.globalDrafts?.flushAll() ?? true,
    ]);
    return results.every(Boolean);
  }

  private checkpointDrafts(): void {
    if (
      this.disposed ||
      this.state !== "ready" ||
      !this.source ||
      !["file", "directory"].includes(this.source.kind) ||
      !this.source.id
    )
      return;
    const entries: RecoveryDraft[] = [
      ...(this.drafts?.pendingDrafts() ?? []).map((draft): RecoveryDraft => ({
        scope: "current",
        key: draft.key,
        context: { ...draft.page },
        record: draft.note && {
          id: draft.note.id,
          revision: draft.note.revision,
          markdown: draft.note.markdown,
        },
        text: draft.text,
      })),
      ...(this.domainDrafts?.pendingDrafts() ?? []).map(
        (draft): RecoveryDraft => ({
          scope: "shared",
          key: draft.key,
          context: { origin: draft.context.origin },
          record: draft.record && {
            id: draft.record.id,
            revision: draft.record.revision,
            markdown: draft.record.markdown,
          },
          text: draft.text,
        }),
      ),
      ...(this.globalDrafts?.pendingDrafts() ?? []).map(
        (draft): RecoveryDraft => ({
          scope: "global",
          key: draft.key,
          context: {},
          record: draft.record && {
            id: draft.record.id,
            revision: draft.record.revision,
            markdown: draft.record.markdown,
          },
          text: draft.text,
        }),
      ),
    ];
    if (!entries.length && !this.recoverySignature) return;
    const signature = JSON.stringify({ sourceId: this.source.id, entries });
    if (signature === this.recoverySignature) return;
    this.recoverySignature = signature;
    const sequence = ++this.recoverySequence;
    const generation = this.generation;
    // Dispatch immediately on edit, independently of the disk-save debounce.
    // Only the worker persists recovery; this is never a disk-save ACK.
    void request(this.api, {
      type: "checkpoint-drafts",
      clientId: this.recoveryClientId,
      sourceId: this.source.id,
      sequence,
      entries,
    })
      .then(() => {
        if (
          this.valid(generation) &&
          sequence === this.recoverySequence &&
          this.recoveryError
        ) {
          this.recoveryError = "";
          this.renderDraftWarnings();
        }
      })
      .catch(() => {
        if (!this.valid(generation) || sequence !== this.recoverySequence)
          return;
        this.recoveryError =
          "Draft recovery could not be updated. Keep this panel open until the note is saved to disk, or export the draft.";
        this.renderDraftWarnings();
      });
  }

  private async loadRecoveredDrafts(): Promise<void> {
    if (
      !this.canUseLibrary() ||
      !this.source ||
      !["file", "directory"].includes(this.source.kind)
    )
      return;
    const generation = this.generation;
    try {
      const snapshots = await this.send<RecoverySnapshot[]>({
        type: "list-recovery",
      });
      if (!this.valid(generation)) return;
      this.recovered = Array.isArray(snapshots)
        ? snapshots.filter(
            (snapshot) => snapshot.clientId !== this.recoveryClientId,
          )
        : [];
      this.renderDraftWarnings();
    } catch {
      if (this.valid(generation))
        this.tell(
          "Recovered drafts could not be checked. Reconnect the notes location and try again.",
          "error",
        );
    }
  }

  private showRecoveredDrafts(trigger: HTMLButtonElement): void {
    if (!this.canUseLibrary()) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    const sourceId = this.source?.id;
    const valid = () =>
      this.valid(generation, context) &&
      this.canUseLibrary() &&
      this.source?.id === sourceId;
    const box = this.showPopover("Recovered drafts", trigger);
    if (!box) return;
    box.append(
      this.el("h2", "", "Recovered drafts"),
      this.el(
        "p",
        "browser-menu-hint",
        "These edits were not confirmed on disk. Save a Markdown copy to review them; the original notes file is unchanged.",
      ),
    );
    for (const snapshot of this.recovered) {
      if (snapshot.unavailable)
        box.append(
          this.el(
            "p",
            "browser-menu-hint",
            "This recovery copy is unavailable. Its stored contents have been kept unchanged.",
          ),
        );
      for (const [index, draft] of snapshot.entries.entries()) {
        const label =
          draft.scope === "current"
            ? displayPageTitle(draft.context)
            : draft.scope === "shared"
              ? `Shared · ${new URL(draft.context.origin).host}`
              : "Global";
        box.append(
          this.menuButton(
            `Save recovered copy: ${label}`,
            "download",
            () => {
              this.download(
                draft.text,
                `aic-recovered-${draft.scope}-${index + 1}.md`,
                "text/markdown;charset=utf-8",
              );
              this.tell(
                "Recovery copy exported as plaintext Markdown. The recovery copy is kept until you dismiss it.",
              );
            },
            label,
          ),
        );
      }
      box.append(
        this.button("Dismiss this recovery copy…", () => {
          if (!valid()) return;
          this.closeOverlay();
          const confirm = this.showPopover("Dismiss recovery copy", trigger);
          if (!confirm) return;
          confirm.append(
            this.el(
              "p",
              "",
              "Delete this recovery copy? Export any drafts you need first. This does not change your notes file.",
            ),
            this.button("Keep recovery copy", () => this.closeOverlay(true)),
            this.button("Delete recovery copy", async () => {
              if (!valid()) return;
              await request(this.api, {
                type: "dismiss-recovery",
                sourceId,
                clientId: snapshot.clientId,
                sequence: snapshot.sequence,
              });
              if (!valid()) return;
              this.recovered = this.recovered.filter(
                (item) => item.clientId !== snapshot.clientId,
              );
              this.closeOverlay();
              this.renderDraftWarnings();
            }),
          );
          confirm.querySelector<HTMLButtonElement>("button")?.focus();
        }),
      );
    }
    box.querySelector<HTMLButtonElement>("button")?.focus();
  }

  private renderDraftWarnings(): void {
    this.checkpointDrafts();
    this.renderFileLocation();
    const target = this.content.querySelector(".browser-draft-warnings");
    if (!target) return;
    target.replaceChildren();
    if (this.recoveryError && this.hasPendingDrafts()) {
      const warning = applyUiComponent(this.el("div"), "notice", ["warning"]);
      warning.append(this.el("p", "", this.recoveryError));
      target.append(warning);
    }
    const recoveryCount = this.recovered.reduce(
      (count, snapshot) =>
        count + Math.max(snapshot.entries.length, snapshot.unavailable ? 1 : 0),
      0,
    );
    if (recoveryCount) {
      const recovery = applyUiComponent(
        this.el("div", "browser-recovery"),
        "notice",
        ["info"],
      );
      recovery.append(
        this.el(
          "span",
          "",
          `${recoveryCount} draft recovery ${recoveryCount === 1 ? "copy" : "copies"} available.`,
        ),
        this.button("Review recovered drafts", (button) =>
          this.showRecoveredDrafts(button),
        ),
      );
      target.append(recovery);
    }
    for (const draft of this.activeScope === "current"
      ? (this.drafts?.dirtyDrafts() ?? [])
      : []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el(
          "p",
          "",
          `${displayPageTitle(draft.page)} (${displayPageLocation(draft.page.url)}): ${draft.error}`,
        ),
        this.button("Retry save", () =>
          this.needsFilePermission()
            ? this.reconnectFile()
            : this.drafts?.flush(draft.key),
        ),
        this.button("Export unsaved draft", () => this.exportDraft(draft.key)),
      );
      target.append(warning);
    }
    for (const draft of this.activeScope === "shared"
      ? (this.domainDrafts?.dirtyDrafts() ?? [])
      : []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el("p", "", `${draft.context.origin}: ${draft.error}`),
        this.button("Retry shared save", () =>
          this.needsFilePermission()
            ? this.reconnectFile()
            : this.domainDrafts?.flush(draft.key),
        ),
        this.button("Export unsaved shared notes", () =>
          this.exportDomainDraft(draft.key),
        ),
      );
      target.append(warning);
    }
    for (const draft of this.activeScope === "global"
      ? (this.globalDrafts?.dirtyDrafts() ?? [])
      : []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el("p", "", `Global: ${draft.error}`),
        this.button("Retry global save", () =>
          this.needsFilePermission()
            ? this.reconnectFile()
            : this.globalDrafts?.flush(draft.key),
        ),
        this.button("Export unsaved global notes", () =>
          this.exportDomainDraft(draft.key, true),
        ),
      );
      target.append(warning);
    }
  }

  private renderLibrary(): void {
    const nav =
      this.overlay.querySelector(".browser-library") ??
      this.content.querySelector(".browser-library");
    if (!nav) return;
    nav.replaceChildren();
    const query = this.filter.toLocaleLowerCase();
    const matches = (item: { title: string; url: string }) =>
      `${displayPageTitle(item)}\n${displayPageLocation(item.url)}`
        .toLocaleLowerCase()
        .includes(query);
    const domains = buildDomainTree(
      this.library.notes.filter(
        (note) => !note.filePath && note.url && matches(note),
      ),
    );
    const activeHost = this.page ? new URL(this.page.url).host : null;
    domains.sort(
      (a, b) => Number(b.host === activeHost) - Number(a.host === activeHost),
    );
    const noteLabels = navigationLabels(
      this.library.notes.filter(
        (note) => !note.filePath && note.url && matches(note),
      ),
    );
    const treeIcon = (name: string, element: "icon" | "toggle" = "icon") => {
      const icon = this.el("span", "cm-aic-icon-button");
      applyUiComponent(icon, "tree", [], element);
      icon.dataset.aicIcon = name;
      icon.setAttribute("aria-hidden", "true");
      return icon;
    };
    const groupList = () =>
      applyUiComponent(this.el("ul"), "tree", [], "group");
    const pageLink = (page: BrowserNote): HTMLElement => {
      const label = noteLabels.get(page.url) ?? displayPageTitle(page);
      const item = applyUiComponent(this.el("li"), "tree", [], "item");
      const row = applyUiComponent(
        this.el("div", "browser-page-row"),
        "tree",
        [],
        "row",
      );
      row.dataset.current = String(page.url === this.page?.url);
      const button = this.button(label, () => this.navigate(page.url));
      applyUiComponent(button, "button", ["ghost"]);
      button.title = displayPageLocation(page.url);
      button.replaceChildren(
        treeIcon("document"),
        applyUiComponent(
          this.el("span", "browser-page-label", label),
          "tree",
          [],
          "label",
        ),
      );
      if (page.url === this.page?.url)
        button.setAttribute("aria-current", "page");
      const remove = this.iconButton(
        `Delete local note: ${label}`,
        "",
        () =>
          this.showDeletePage(
            page.url,
            page.title,
            this.toolbar.querySelector<HTMLButtonElement>(
              '[aria-label="Notes"]',
            ) ?? button,
          ),
        "trash",
      );
      remove.classList.add("browser-page-delete");
      remove.disabled = this.importing || this.deleting;
      row.append(button, remove);
      item.append(row);
      return item;
    };
    const groupHeader = (label: string, className = "") => {
      const summary = applyUiComponent(this.el("summary"), "tree", [], "row");
      summary.append(
        treeIcon("chevron", "toggle"),
        treeIcon("folder"),
        applyUiComponent(
          this.el("span", className, label),
          "tree",
          [],
          "label",
        ),
      );
      return summary;
    };
    const appendItems = (items: NavigationItem[], parent: HTMLElement) => {
      for (const entry of items) {
        if (entry.kind === "note") {
          parent.append(pageLink(entry.note));
          continue;
        }
        const item = applyUiComponent(this.el("li"), "tree", [], "item");
        const group = this.el("details", "browser-path");
        group.open = true;
        group.append(groupHeader(entry.label, "browser-path-label"));
        const children = groupList();
        appendItems(entry.items, children);
        group.append(children);
        item.append(group);
        parent.append(item);
      }
    };
    const tree = groupList();
    for (const domain of domains) {
      const item = applyUiComponent(this.el("li"), "tree", [], "item");
      const group = this.el("details", "browser-domain");
      group.open =
        !!query ||
        !this.page ||
        domain.host === activeHost ||
        domains.length === 1;
      group.append(groupHeader(domain.host));
      const list = groupList();
      appendItems(projectDomain(domain), list);
      group.append(list);
      item.append(group);
      tree.append(item);
    }
    const files = this.library.notes
      .filter(
        (note) =>
          note.filePath &&
          `${note.filePath}\n${note.title}`.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => left.filePath!.localeCompare(right.filePath!));
    type FileBranch = {
      path: string;
      name: string;
      folders: Map<string, FileBranch>;
      notes: BrowserNote[];
    };
    const root: FileBranch = {
      path: "",
      name: "",
      folders: new Map(),
      notes: [],
    };
    for (const note of files) {
      const parts = note.filePath!.split("/");
      parts.pop();
      let parent = root;
      for (const segment of parts) {
        let branch = parent.folders.get(segment);
        if (!branch) {
          branch = {
            path: parent.path ? `${parent.path}/${segment}` : segment,
            name: segment,
            folders: new Map(),
            notes: [],
          };
          parent.folders.set(segment, branch);
        }
        parent = branch;
      }
      parent.notes.push(note);
    }
    const selectedPath = this.library.notes.find(
      (note) => note.id === this.selectedFileId || note.id === this.noteId,
    )?.filePath;
    const appendLevel = (branch: FileBranch, parent: HTMLElement) => {
      const entries = [...branch.folders.values(), ...branch.notes];
      let shown = 0;
      const more = this.button(
        `Show more in ${branch.path || "this folder"}`,
        () => appendNext(),
        { variant: "ghost" },
      );
      const moreItem = applyUiComponent(this.el("li"), "tree", [], "item");
      moreItem.append(more);
      const appendNext = () => {
        moreItem.remove();
        const end = Math.min(shown + 100, entries.length);
        for (; shown < end; shown++) {
          const entry = entries[shown]!;
          const item = applyUiComponent(this.el("li"), "tree", [], "item");
          if ("folders" in entry) {
            const group = this.el("details", "browser-path");
            group.dataset.folderPath = entry.path;
            group.open =
              files.length <= 200 ||
              !!query ||
              !!selectedPath?.startsWith(`${entry.path}/`);
            group.append(groupHeader(entry.name));
            const children = groupList();
            let mounted = false;
            const mount = () => {
              if (!group.open || mounted) return;
              mounted = true;
              appendLevel(entry, children);
            };
            mount();
            group.addEventListener("toggle", mount);
            group.append(children);
            item.append(group);
          } else {
            const button = this.button(
              entry.filePath!.split("/").at(-1)!,
              () => this.selectFile(entry.id),
              {
                variant: "ghost",
                icon: "document",
              },
            );
            applyUiComponent(button, "tree", [], "row");
            const label =
              button.querySelector<HTMLElement>(".aic-button__label");
            if (label) applyUiComponent(label, "tree", [], "label");
            button.title = entry.filePath!;
            if (entry.id === this.selectedFileId || entry.id === this.noteId)
              button.setAttribute("aria-current", "page");
            item.append(button);
          }
          parent.append(item);
        }
        if (shown < entries.length) parent.append(moreItem);
      };
      appendNext();
    };
    appendLevel(root, tree);
    if (domains.length || files.length) nav.append(tree);
    else
      nav.append(
        this.el(
          "p",
          "browser-empty",
          query ? "No matching notes." : "No notes yet.",
        ),
      );
    const filter =
      nav.parentElement?.querySelector<HTMLInputElement>(".browser-filter");
    if (filter) filter.hidden = this.library.notes.length === 0 && !query;
  }

  private capture(mode: "auto" | "page" | "selection"): Promise<void> | void {
    if (!this.page || !this.canUseLibrary()) return;
    this.requireImportReady();
    if (!this.activePage)
      throw new Error("Wait for an active web page before importing content.");
    const page = { ...this.activePage };
    const active = this.activeGeneration;
    const generation = this.generation;
    const context = this.contextGeneration;
    // This call must remain synchronous inside the deliberate click gesture.
    const permission = this.api.permissions.request({
      origins: [`${new URL(page.url).origin}/*`],
    });
    this.closeOverlay();
    this.setImporting(true);
    this.tell(
      mode === "page"
        ? "Importing page…"
        : mode === "selection"
          ? "Importing selected text…"
          : "Importing current content…",
      "progress",
    );
    return (async () => {
      if (!(await permission))
        throw new Error("Site access was not granted. Nothing was imported.");
      if (!this.valid(generation, context) || active !== this.activeGeneration)
        return;
      const capture = await this.send<PageCapture>({
        type: "capture",
        page,
        mode,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      if (active !== this.activeGeneration) return;
      const imported = importCapturedPage(capture);
      if (!imported.markdown) {
        this.tell(
          imported.warnings.join(" ") ||
            "No readable content found. Select readable text or open a content page and retry.",
          "error",
        );
        return;
      }
      await this.appendMarkdown(imported.markdown);
      if (this.valid(generation, context))
        this.tell(
          imported.warnings.join(" ") || "Imported into this page’s note.",
          imported.warnings.length ? "info" : "success",
        );
    })().finally(() => {
      if (this.valid(generation, context)) this.setImporting(false);
    });
  }

  private requireImportReady(): void {
    if (this.activeScope !== "current")
      throw new Error("Choose Current to import into the page note.");
    if (this.importing)
      throw new Error("An import is already in progress. Wait for its result.");
  }

  private async appendMarkdown(markdown: string): Promise<void> {
    if (this.activeScope !== "current")
      throw new Error("Choose Current to import into the page note.");
    if (this.editor && this.noteId) {
      const length = this.editor.view.state.doc.length;
      const draft = this.drafts!.get(this.noteId);
      const replaceSeed =
        !draft?.note &&
        !draft?.dirty &&
        !draft?.saving &&
        draft?.text === PLACEHOLDER_TEXT;
      const from = replaceSeed ? 0 : length;
      const separator = from ? "\n\n" : "";
      this.editor.view.dispatch({
        changes: { from, to: length, insert: `${separator}${markdown}` },
        selection: { anchor: from + separator.length },
        scrollIntoView: true,
      });
      this.editor.focus();
      if (!(await this.drafts!.flush(this.noteId)))
        throw new Error(
          "Imported content remains in an unsaved draft. Retry save or export it.",
        );
    } else throw new Error("Open a web page before importing content.");
  }

  private async navigate(url: string): Promise<void> {
    if (this.windowId === null || !this.canUseLibrary()) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    if (!(await this.flushAllDrafts())) {
      if (this.valid(generation, context))
        this.tell(
          "Navigation paused: save or export your unsaved draft before leaving.",
        );
      return;
    }
    if (!this.valid(generation, context)) return;
    await this.send({
      type: "navigate",
      windowId: this.windowId,
      url,
      allowPrivate: this.allowPrivate,
    });
    if (this.valid(generation, context)) {
      this.pinnedPage = null;
      await this.refreshContext();
    }
  }

  private download(text: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    this.urls.add(url);
    const anchor = this.el("a");
    anchor.href = url;
    anchor.download = filename;
    this.root.append(anchor);
    anchor.click();
    anchor.remove();
    // The click has consumed the URL; do not retain plaintext blobs in a panel.
    URL.revokeObjectURL(url);
    this.urls.delete(url);
  }

  private exportDraft(id: string): void {
    const draft = this.drafts?.get(id);
    if (!draft) return;
    this.download(
      draft.text,
      "aic-unsaved-draft.md",
      "text/markdown;charset=utf-8",
    );
    this.tell(
      "Exported plaintext Markdown, including any secrets. Keep the file private.",
    );
  }

  private exportDomainDraft(key: string, global = false): void {
    const draft = global
      ? this.globalDrafts?.get(key)
      : this.domainDrafts?.get(key);
    if (!draft) return;
    this.download(
      draft.text,
      global
        ? "aic-unsaved-global-properties.md"
        : "aic-unsaved-shared-properties.md",
      "text/markdown;charset=utf-8",
    );
    this.tell(
      "Exported plaintext shared properties, including any secrets. Keep the file private.",
    );
  }

  private closeOverlay(restoreFocus = false): void {
    const trigger = this.overlayTrigger;
    this.overlayTrigger = null;
    trigger?.setAttribute("aria-expanded", "false");
    for (const input of this.overlay.querySelectorAll("input"))
      input.value = "";
    this.overlay.replaceChildren();
    delete this.overlay.dataset.layout;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  private chooseMarkdownFile(): void {
    if (!this.page) return;
    this.requireImportReady();
    this.clearMarkdownImport();
    const generation = this.generation;
    const context = this.contextGeneration;
    const input = this.el("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown,text/plain";
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute("aria-label", "Markdown file");
    const pending = { input, cancelled: false };
    this.markdownImport = pending;
    const removeInput = () => input.remove();
    input.addEventListener(
      "cancel",
      () => {
        if (this.markdownImport !== pending) return;
        pending.cancelled = true;
        this.markdownImport = null;
        removeInput();
      },
      { once: true },
    );
    input.addEventListener(
      "change",
      () => {
        if (pending.cancelled || this.markdownImport !== pending) {
          removeInput();
          return;
        }
        const selected = input.files?.[0];
        removeInput();
        if (!selected) {
          if (this.markdownImport === pending) this.markdownImport = null;
          return;
        }
        if (selected.size > 512 * 1024) {
          if (this.markdownImport === pending) this.markdownImport = null;
          this.fail(new Error("Markdown file exceeds the note size limit."));
          return;
        }
        this.setImporting(true);
        this.tell("Importing Markdown…", "progress");
        void (async () => {
          const text = await selected.text();
          if (
            pending.cancelled ||
            this.markdownImport !== pending ||
            !this.valid(generation, context)
          )
            return;
          await this.appendMarkdown(text);
          if (
            !pending.cancelled &&
            this.markdownImport === pending &&
            this.valid(generation, context)
          )
            this.tell("Imported into this page’s note.", "success");
        })()
          .catch((error: unknown) => {
            if (
              !pending.cancelled &&
              this.markdownImport === pending &&
              this.valid(generation, context)
            )
              this.fail(error);
          })
          .finally(() => {
            if (this.markdownImport !== pending) return;
            this.markdownImport = null;
            if (this.valid(generation, context)) this.setImporting(false);
          });
      },
      { once: true },
    );
    this.root.append(input);
    try {
      input.click();
    } catch (error) {
      this.clearMarkdownImport();
      throw error;
    }
  }

  private clearPlaintext(): void {
    this.clearMarkdownImport();
    ++this.generation;
    ++this.contextGeneration;
    this.deleting = false;
    this.libraryRefreshDeferred = false;
    this.content.inert = false;
    this.toolbar.inert = false;
    this.dropEditor();
    this.drafts?.dispose();
    this.drafts = null;
    this.domainDrafts?.dispose();
    this.domainDrafts = null;
    this.globalDrafts?.dispose();
    this.globalDrafts = null;
    this.globalRefreshDeferred = false;
    this.domainReload = null;
    this.domainRefreshDeferred = false;
    ++this.domainReloadRevision;
    this.library = emptyLibrary();
    this.recovered = [];
    this.recoverySignature = "";
    this.recoveryError = "";
    this.page = null;
    this.selectedFileId = null;
    this.pinnedPage = null;
    this.activePage = null;
    ++this.activeGeneration;
    this.filter = "";
    this.importing = false;
    this.contextLoading = false;
    this.root.dataset.importing = "false";
    this.allowPrivate = false;
    for (const input of this.root.querySelectorAll("input")) input.value = "";
    this.closeOverlay();
    this.content.replaceChildren();
    this.tell("");
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private clearMarkdownImport(): void {
    const pending = this.markdownImport;
    if (!pending) return;
    pending.cancelled = true;
    pending.input.remove();
    this.markdownImport = null;
  }

  private flushBeforeHide(): void {
    // Dispatch best-effort saves before teardown. Browser shutdown can still
    // interrupt delivery; pending messages are not a disk or recovery ACK.
    if (!this.disposed) {
      this.checkpointDrafts();
      void this.flushAllDrafts().catch(() => {});
    }
  }

  destroy(): void {
    if (this.disposed) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.fileOperation = null;
    this.clearPlaintext();
    this.disposed = true;
    this.sourceAccess.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root.replaceChildren();
  }
}
