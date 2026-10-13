import { AicEditor } from "../editor";
import { request, type Request, type ActivePage, type BrowserApi } from "./api";
import { BrowserDrafts, rebaseFocusedPage, type Draft } from "./drafts";
import { applyUiComponent, createUiButton } from "../core/ui-system.js";
import { createEditorHelp } from "../core/editor-help.js";
import type { BrowserNote } from "./library";
import { importCapturedPage, keepInsidePage } from "./import-page";
import type { PageCapture } from "./capture-page";
import type { RecoveryDraft, RecoverySnapshot } from "./recovery-store";
import {
  chooseBrowserSource,
  BrowserSourceAccess,
  FILE_SOURCE_KEY,
  type BrowserFileLocation,
  type BrowserStatus,
} from "./markdown-storage";

/** The page of the note a tab is bound to: its URL without the fragment. */
function pageTarget(url: string): string {
  const target = new URL(url);
  target.hash = "";
  return target.href;
}

/** One panel owns its window context and ephemeral plaintext. The worker owns storage. */
export class BrowserPanel {
  readonly ready: Promise<void>;
  private generation = 0;
  private contextGeneration = 0;
  private disposed = false;
  private state: BrowserStatus["state"] = "unselected";
  private source: BrowserFileLocation | undefined;
  private sourceError = "";
  private sourceErrorCode = "";
  private sourceAccessState: BrowserStatus["access"];
  private readonly sourceAccess = new BrowserSourceAccess();
  private reconnecting = false;
  private warmedSourceId: string | null = null;
  private checkingAccess = false;
  private selectingSource = false;
  private legacyNotes = false;
  private sourceChanged = false;
  /** A connect, reconnect or first status read owns the source until it settles. */
  private sourceBusy = false;
  private windowId: number | null = null;
  private privateWindow = false;
  private allowPrivate = false;
  private page: ActivePage | null = null;
  private readonly recoveryClientId = crypto.randomUUID();
  private recoverySequence = 0;
  private recoverySignature = "";
  private recoveryError = "";
  private recovered: RecoverySnapshot[] = [];
  private editor: AicEditor | null = null;
  private editorGeneration = 0;
  private noteId: string | null = null;
  private drafts: BrowserDrafts | null = null;
  private importing = false;
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
        // event must not initialize the panel a second time.
        if (this.sourceBusy) return;
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
        }
      }
    });
    this.listen(api.tabs.onActivated, (info) => {
      if (info.windowId === this.windowId && info.tabId !== this.page?.tabId)
        this.contextChanged();
    });
    this.listen(api.tabs.onUpdated, (id, change, tab) => {
      if (tab.windowId !== this.windowId) return;
      // A title change of the shown page does not move the note.
      if (
        id === this.page?.tabId &&
        (!change.url || change.url === this.page.url)
      )
        return;
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
    const theme = () => this.editor?.refreshTheme();
    media?.addEventListener("change", theme);
    this.cleanups.push(() => media?.removeEventListener("change", theme));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.drafts?.hasPendingChanges()) {
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
        this.dropEditor();
        this.page = null;
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
      void this.reloadNote();
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
    const more = this.iconButton("More options", "⋯", (button) =>
      this.showMoreMenu(button),
    );
    more.classList.remove("aic-button--compact");
    applyUiComponent(more, "button", ["touch"]);
    more.setAttribute("aria-haspopup", "dialog");
    more.setAttribute("aria-expanded", "false");
    this.toolbar.replaceChildren(
      this.el("span", "browser-brand", ">_ AIC"),
      more,
    );
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
    const noteId = this.noteId;
    if (this.page && noteId && this.editor?.focusedPage) {
      const capture = this.menuButton(
        "Import current content",
        "import-page",
        () => {
          this.closeOverlay(true);
          if (this.noteId === noteId) return this.capture("auto");
        },
      );
      capture.title =
        "Import selected readable content when available; otherwise import the readable page";
      const markdown = this.menuButton(
        "Insert from Markdown file",
        "import-file",
        () => {
          this.closeOverlay(true);
          if (this.noteId === noteId) return this.chooseMarkdownFile();
        },
        "Insert from file…",
      );
      markdown.title = "Append Markdown from another file to this page";
      for (const button of [capture, markdown]) {
        button.dataset.importAction = "true";
        button.disabled = this.importing;
        button.setAttribute("aria-description", button.title);
      }
      box.append(
        this.menuHeading("This page"),
        capture,
        markdown,
        this.menuButton("Download page", "export-file", () => {
          this.closeOverlay(true);
          if (this.noteId === noteId) this.exportPage();
        }),
      );
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
    if (noteId)
      box.append(
        this.menuButton("Download note file", "export-file", () => {
          this.closeOverlay(true);
          this.exportDraft(noteId);
        }),
      );
    if (this.legacyNotes && this.canUseLibrary())
      box.append(
        this.el(
          "p",
          "browser-menu-hint",
          "Earlier page notes stay in this folder as Markdown files.",
        ),
      );
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

  private hasPendingDrafts(): boolean {
    return !!this.drafts?.hasPendingChanges();
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
          this.legacyNotes = !!status.legacyNotes;
          this.sourceChanged = false;
          this.renderFileLocation();
        } else if (message.type === "save") {
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
      this.fileLocation.append(path, status, reconnect);
    }
    const path =
      this.fileLocation.querySelector<HTMLElement>(".aic-context__path")!;
    const status = this.fileLocation.querySelector<HTMLElement>(
      ".aic-context__status",
    )!;
    const reconnect =
      this.fileLocation.querySelector<HTMLButtonElement>(".browser-reconnect")!;
    const selected = ["file", "directory"].includes(this.source.kind);
    path.textContent = selected
      ? [
          this.source.kind === "directory" ? this.source.name : "",
          this.drafts?.get(this.noteId ?? "")?.note.filePath,
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
      this.sourceBusy ||
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
        this.sourceBusy ||
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
    if (this.reconnecting || this.sourceBusy) return;
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
      const status = await this.sourceWork(async () => {
        if (!(await this.flushAllDrafts()))
          throw new Error(
            "File access restored. Retry saving the unsaved draft.",
          );
        if (!current()) return null;
        return request<BrowserStatus>(this.api, { type: "status", sourceId });
      });
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

  private async sourceWork<T>(work: () => Promise<T>): Promise<T> {
    this.sourceBusy = true;
    try {
      return await work();
    } finally {
      this.sourceBusy = false;
    }
  }

  private async connectFile(mode: "file" | "folder"): Promise<void> {
    if (this.privateWindow && !this.allowPrivate)
      throw new Error("Read and accept the private-window notice first.");
    if (this.selectingSource || this.reconnecting || this.sourceBusy) return;
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
          "Save your unsaved draft, or export and discard it, before changing files.",
        );
      const status = await this.sourceWork(() =>
        this.send<BrowserStatus>({
          type: "connect-source",
          bindingId: id,
          mode: "open",
        }),
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

  private async initialize(): Promise<void> {
    const generation = this.generation;
    try {
      const current = await this.api.windows.getCurrent();
      if (!this.valid(generation)) return;
      if (current.id === undefined)
        throw new Error("This browser window is unavailable.");
      this.windowId = current.id;
      this.privateWindow = !!current.incognito;
      const status = await this.sourceWork(() =>
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
          if (this.noteId === draft.key) this.reflectDraft(draft);
          this.renderDraftWarnings();
        },
        {
          // A save conflict: read the file again and carry the focused page
          // of the draft onto it when that page did not change on disk.
          reload: async () => {
            if (!this.valid(generation))
              throw new Error("The notes location changed.");
            return this.send<BrowserNote>({ type: "load" });
          },
          rebase: (base, text, stored) =>
            this.valid(generation) && this.noteId === stored.id
              ? rebaseFocusedPage(
                  base,
                  text,
                  stored.markdown,
                  this.editor?.focusedPage?.target ?? null,
                )
              : null,
          adopted: (draft) => {
            if (!this.valid(generation) || this.noteId !== draft.key) return;
            // The disk text with this page's draft, as an external change.
            this.editor?.switchDocument(draft.key, draft.text);
            this.focusPage();
            this.renderFileLocation();
          },
        },
      );
    }
    if (!this.editor) this.renderPage();
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
    if (this.canUseLibrary()) void this.refreshContext();
  }

  private dropEditor(): void {
    ++this.editorGeneration;
    this.noteId = null;
    this.editor?.destroy();
    this.editor = null;
  }

  /**
   * Read the active tab and the note file again, then show the tab's page.
   * The mounted editor and an unsaved draft are kept; the undo history is
   * emptied when the tab's page target changes.
   */
  private async refreshContext(): Promise<void> {
    if (!this.canUseLibrary() || this.windowId === null) return;
    this.clearMarkdownImport();
    const generation = this.generation;
    const context = ++this.contextGeneration;
    this.setImporting(false);
    this.closeOverlay();
    try {
      const page = await this.send<ActivePage | null>({
        type: "context",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      const note = await this.send<BrowserNote>({ type: "load" });
      if (!this.valid(generation, context) || !this.drafts) return;
      this.page = page;
      this.showNote(note);
    } catch (error) {
      if (!this.valid(generation, context)) return;
      if (!this.editor) this.renderPage(null);
      this.fail(error);
    }
  }

  /**
   * Pick up a change made to the note file elsewhere (another window, an
   * editor on disk) without touching the tab context or a running import.
   */
  private async reloadNote(): Promise<void> {
    if (!this.canUseLibrary() || !this.editor) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    try {
      const note = await this.send<BrowserNote>({ type: "load" });
      if (this.valid(generation, context) && this.editor) this.showNote(note);
    } catch {
      // Passive: `send` marks the file status; the next save reports details.
    }
  }

  /** Text read from disk reaches the editor as an external change. */
  private showNote(note: BrowserNote): void {
    if (!this.drafts) return;
    // A dirty or saving draft is never replaced; its save reports the conflict.
    const draft = this.drafts.activate(note);
    if (!this.editor || this.noteId !== draft.key) this.renderPage(draft);
    else this.editor.switchDocument(draft.key, draft.text);
    this.focusPage();
    this.renderFileLocation();
  }

  /** An http(s) tab shows only its page; any other tab shows the whole note. */
  private focusPage(): void {
    const editor = this.editor;
    if (!editor) return;
    const target = this.page ? pageTarget(this.page.url) : null;
    if ((editor.focusedPage?.target ?? null) === target) return;
    if (target === null || !editor.focusTarget(target))
      editor.focusTarget(null);
  }

  private renderPage(draft?: Draft | null): void {
    if (!this.canUseLibrary()) return;
    this.dropEditor();
    this.content.replaceChildren();
    if (draft) this.mountEditor(draft);
    else if (draft === undefined)
      this.content.append(
        this.el("p", "browser-loading", "Loading your note…"),
      );
    this.content.append(this.el("div", "browser-draft-warnings"));
    this.renderDraftWarnings();
  }

  private mountEditor(draft: Draft): void {
    const generation = this.generation;
    const editorGeneration = ++this.editorGeneration;
    const current = () =>
      this.valid(generation) &&
      this.editorGeneration === editorGeneration &&
      this.noteId === draft.key;
    this.noteId = draft.key;
    const host = this.el("section", "browser-note");
    const editorHost = this.el("div", "browser-editor-host");
    host.append(editorHost);
    this.content.append(host);
    this.editor = new AicEditor(editorHost, {
      initialText: draft.text,
      showEditorHelp: false,
      onChange: (text) => {
        if (current()) this.drafts?.edit(draft.key, text);
      },
      onSave: () => (current() ? this.drafts!.flush(draft.key) : false),
      onOpenTarget: (target) => {
        if (/^https?:\/\//iu.test(target))
          void this.openTab(target).catch((error) => this.fail(error));
      },
    });
    this.editor.switchDocument(draft.key, draft.text);
    this.reflectDraft(draft);
  }

  private reflectDraft(draft: Draft): void {
    this.editor?.setSaveState(
      draft.dirty ? "dirty" : "saved",
      draft.saving,
      draft.error
        ? "failed"
        : draft.saving
          ? "saving"
          : draft.dirty
            ? "dirty"
            : "saved",
    );
  }

  private async flushAllDrafts(): Promise<boolean> {
    return (await this.drafts?.flushAll()) ?? true;
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
        record: {
          id: draft.note.id,
          revision: draft.note.revision,
          markdown: draft.note.markdown,
        },
        text: draft.text,
      })),
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
        // Copies of the earlier per-page, Shared and Global notes stay
        // exportable; none is ever applied to the note file.
        const label =
          draft.scope === "current"
            ? draft.context.title.trim() || draft.context.url
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
    for (const draft of this.drafts?.dirtyDrafts() ?? []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el("p", "", `${draft.note.filePath}: ${draft.error}`),
        this.button("Retry save", () =>
          this.needsFilePermission()
            ? this.reconnectFile()
            : this.drafts?.flush(draft.key),
        ),
        this.button("Export unsaved draft", () => this.exportDraft(draft.key)),
      );
      if (draft.conflict)
        warning.append(
          this.button("Discard my changes and reload…", (button) =>
            this.confirmDiscardDraft(draft.key, button),
          ),
        );
      target.append(warning);
    }
  }

  private capture(mode: "auto" | "page" | "selection"): Promise<void> | void {
    if (!this.page || !this.canUseLibrary()) return;
    this.requireImportReady();
    const page = { ...this.page };
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
      if (!this.valid(generation, context)) return;
      const capture = await this.send<PageCapture>({
        type: "capture",
        page,
        mode,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
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
    if (this.importing)
      throw new Error("An import is already in progress. Wait for its result.");
  }

  /** Insert at the end of the focused page; core creates a missing page. */
  private async appendMarkdown(markdown: string): Promise<void> {
    const editor = this.editor;
    const page = editor?.focusedPage;
    if (!editor || !this.noteId || !page)
      throw new Error("Open a web page before importing content.");
    const view = editor.view;
    const before = view.state.doc.length;
    // One blank line between the page's text and the inserted content.
    const separator = !page.text.trim()
      ? ""
      : /\n[ \t]*\n$/u.test(page.text)
        ? ""
        : page.text.endsWith("\n")
          ? "\n"
          : "\n\n";
    view.dispatch({
      changes: {
        from: page.to,
        insert: `${separator}${keepInsidePage(markdown)}`,
      },
      scrollIntoView: true,
    });
    if (view.state.doc.length === before)
      throw new Error("The content could not be added to this page.");
    editor.focus();
    if (!(await this.drafts!.flush(this.noteId)))
      throw new Error(
        "Imported content remains in an unsaved draft. Retry save or export it.",
      );
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

  /** After a confirmation, drop the unsaved draft and show the file on disk. */
  private confirmDiscardDraft(id: string, trigger: HTMLButtonElement): void {
    const generation = this.generation;
    const confirm = this.showPopover("Discard my changes", trigger);
    if (!confirm) return;
    confirm.append(
      this.el(
        "p",
        "",
        "Discard your unsaved changes and load the note file as it is on disk? Export the draft first if you need it. The file is not changed.",
      ),
      this.button("Keep my draft", () => this.closeOverlay(true)),
      this.button("Discard and reload", async () => {
        if (!this.valid(generation) || !this.drafts) return;
        const note = await this.send<BrowserNote>({ type: "load" });
        if (!this.valid(generation) || !this.drafts) return;
        this.closeOverlay(true);
        if (!this.drafts.discard(id, note))
          throw new Error("A save is still in progress. Try again.");
        this.showNote(note);
        this.tell("Loaded the note file from disk.");
      }),
    );
  }

  /** The whole note file as drafted, including pages that are not shown. */
  private exportDraft(id: string): void {
    const draft = this.drafts?.get(id);
    if (!draft) return;
    this.download(
      draft.text,
      draft.dirty ? "aic-unsaved-draft.md" : "aic.md",
      "text/markdown;charset=utf-8",
    );
    this.tell(
      "Exported plaintext Markdown, including any secrets. Keep the file private.",
    );
  }

  private exportPage(): void {
    const page = this.editor?.focusedPage;
    if (!page) return;
    this.download(page.text, "aic-page.md", "text/markdown;charset=utf-8");
    this.tell(
      "Exported this page as plaintext Markdown, including any secrets. Keep the file private.",
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
    this.content.inert = false;
    this.toolbar.inert = false;
    this.dropEditor();
    this.drafts?.dispose();
    this.drafts = null;
    this.recovered = [];
    this.recoverySignature = "";
    this.recoveryError = "";
    this.page = null;
    this.importing = false;
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
    this.clearPlaintext();
    this.disposed = true;
    this.sourceAccess.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root.replaceChildren();
  }
}
