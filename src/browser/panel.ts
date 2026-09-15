import { AicEditor } from "../editor";
import { AIC_EMPTY_DOCUMENT } from "../core/security-model.js";
import { request, type ActivePage, type BrowserApi } from "./api";
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
import type { VaultStatus } from "./vault-store";

const SESSION_KEY = "aic-browser-unlock";
const PLACEHOLDER_TEXT = AIC_EMPTY_DOCUMENT;
const emptyLibrary = (): BrowserLibrary => ({
  version: 3,
  notes: [],
  history: [],
  domains: [],
  global: null,
});

/** One panel owns its window context and ephemeral plaintext. The worker owns storage. */
export class BrowserPanel {
  readonly ready: Promise<void>;
  private generation = 0;
  private contextGeneration = 0;
  private disposed = false;
  private state: VaultStatus["state"] = "locked";
  private windowId: number | null = null;
  private privateWindow = false;
  private allowPrivate = false;
  private page: ActivePage | null = null;
  private library = emptyLibrary();
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
    this.feedback = this.el("div", "browser-feedback");
    applyUiComponent(this.feedback, "notice");
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.content = this.el("main", "browser-content");
    this.overlay = this.el("div", "browser-overlay");
    applyUiComponent(this.overlay, "menu", ["compact"]);
    root.replaceChildren(
      this.toolbar,
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
      const session = changes[SESSION_KEY] as
        { newValue?: unknown } | undefined;
      if (area === "session" && session && !session.newValue) {
        this.clearPlaintext();
        this.state = "locked";
        this.render();
        this.tell("AIC was locked. Unlock to continue.");
      }
      if (area === "local" && changes["aic-browser-library"])
        this.refreshSharedData();
    });
    this.listen(api.tabs.onActivated, (info) => {
      if (info.windowId === this.windowId && info.tabId !== this.page?.tabId)
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
        void this.startUnlocked();
      } else {
        this.render();
      }
    };
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
  ): HTMLButtonElement {
    const button = createUiButton(this.document, { label, size: "compact" });
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
  ): HTMLButtonElement {
    const button = this.button(label, action);
    applyUiComponent(button, "button", ["ghost", "icon-only", "compact"]);
    button.classList.add("browser-icon-button");
    button.title = label;
    const icon = this.el("span", "", glyph);
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon);
    return button;
  }

  private importIconButton(
    label: string,
    glyph: string,
    action: (button: HTMLButtonElement) => void | Promise<unknown>,
  ): HTMLButtonElement {
    const button = this.iconButton(label, glyph, action);
    button.dataset.importAction = "true";
    button.disabled = this.importing;
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
        this.iconButton("Notes and history", "☷", (button) =>
          this.showNavigation(button),
        ),
      );
      const identity = this.el("div", "browser-page-identity");
      const title = this.el(
        "strong",
        "browser-page-title",
        this.contextLoading
          ? "Loading page…"
          : this.page
            ? displayPageTitle(this.page)
            : "Your notes",
      );
      title.title = this.page ? displayPageTitle(this.page) : "Your notes";
      identity.append(title);
      if (this.page) {
        const source = this.el(
          "small",
          "browser-page-origin",
          new URL(this.page.url).host,
        );
        source.title = displayPageLocation(this.page.url);
        identity.append(source);
      }
      this.toolbar.append(identity);
      if (this.page && !this.shared?.editing && !this.globalShared?.editing) {
        const capture = this.importIconButton(
          "Import current content",
          "↳",
          () => this.capture("auto"),
        );
        capture.title =
          "Import selected readable content when available; otherwise import the readable page";
        const markdown = this.importIconButton(
          "Import Markdown file",
          "↑",
          () => this.chooseMarkdownFile(),
        );
        markdown.title = "Import a plaintext Markdown file into this note";
        markdown.setAttribute("aria-description", markdown.title);
        this.toolbar.append(capture, markdown);
        if (this.editor && this.noteId) {
          const noteId = this.noteId;
          const exportMarkdown = this.iconButton(
            "Export Markdown file",
            "↓",
            () => this.exportDraft(noteId),
          );
          exportMarkdown.title =
            "Export plaintext Markdown; the file may contain secrets";
          exportMarkdown.setAttribute("aria-description", exportMarkdown.title);
          this.toolbar.append(exportMarkdown);
        }
      }
    } else {
      this.toolbar.append(this.el("span", "browser-brand", ">_ AIC"));
    }
    if (this.canUseLibrary())
      this.toolbar.append(
        this.iconButton("AIC guide", "?", (button) => this.showGuide(button)),
      );
    const more = this.iconButton("More options", "⋯", (button) =>
      this.showMoreMenu(button),
    );
    this.toolbar.append(more);
    if (this.state === "unlocked") {
      const lock = this.iconButton("Lock", "", () => this.lock());
      lock.classList.add("browser-lock-button");
      lock.title = "Lock all AIC panels. Save other panels first.";
      lock.setAttribute("aria-description", lock.title);
      this.toolbar.append(lock);
    }
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      if (
        ["Notes and history", "AIC guide", "More options"].includes(
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
    if (
      this.page &&
      this.canUseLibrary() &&
      !this.shared?.editing &&
      !this.globalShared?.editing
    ) {
      const page = { ...this.page };
      const draft = this.drafts?.getForPage(page.url);
      const hasNote =
        !!draft?.note ||
        !!draft?.dirty ||
        this.library.notes.some((item) => item.url === page.url);
      if (
        hasNote ||
        this.library.history.some((item) => item.url === page.url)
      ) {
        const remove = this.button(
          hasNote ? "Delete local note" : "Remove page from history",
          () => this.showDeletePage(page.url, page.title, trigger),
        );
        remove.disabled = this.importing || this.deleting;
        box.append(
          this.el(
            "h2",
            "browser-menu-group",
            hasNote ? "Local note" : "Recent page",
          ),
          remove,
          this.el("hr"),
        );
      }
    }
    box.append(this.el("h2", "browser-menu-group", "Encrypted backup"));
    if (this.state === "unlocked")
      box.append(
        this.button("Export encrypted backup", () => {
          this.closeOverlay(true);
          return this.exportBackup();
        }),
      );
    box.append(
      this.button("Import encrypted backup", () => this.importBackupDialog()),
    );
    box.querySelector<HTMLButtonElement>("button")?.focus();
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
    if (!this.canUseLibrary() || this.importing || this.deleting) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    const draft = this.drafts?.getForPage(url);
    const record =
      draft?.note ?? this.library.notes.find((item) => item.url === url);
    const expected = record
      ? { id: record.id, revision: record.revision }
      : null;
    const hasNote = !!record || !!draft?.dirty || !!draft?.saving;
    this.closeOverlay();
    const box = this.showPopover("Delete local page", trigger);
    if (!box) return;
    box.classList.add("browser-delete-confirm");
    box.append(
      this.el(
        "h2",
        "",
        hasNote ? "Delete this local note?" : "Remove this recent page?",
      ),
      this.el("p", "browser-delete-title", displayPageTitle({ url, title })),
      this.el(
        "p",
        "browser-menu-hint",
        hasNote
          ? "Delete the local note and its history entry. This cannot be undone without a backup. The website, shared properties, and other notes stay unchanged."
          : "Remove this page from AIC history. The website, shared properties, and other notes stay unchanged.",
      ),
    );
    const cancel = this.button("Cancel", () => this.closeOverlay(true));
    const confirm = this.button(
      hasNote ? "Delete note" : "Remove page",
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
          const library = await request<BrowserLibrary>(this.api, {
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
              ? "Local note deleted. The placeholder is not saved until you edit it."
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
    const box = this.showPopover("Notes and history", trigger);
    if (!box) return;
    box.append(this.el("h2", "", "Notes and history"));
    this.appendNavigation(box);
    box.querySelector<HTMLInputElement>("input")?.focus();
  }

  private appendNavigation(parent: HTMLElement): void {
    const nav = this.el("section", "browser-navigation");
    const filter = this.el("input", "browser-filter");
    filter.type = "search";
    filter.placeholder = "Find notes or pages";
    filter.setAttribute("aria-label", "Filter titles and URLs");
    filter.value = this.filter;
    filter.addEventListener("input", () => {
      this.filter = filter.value;
      this.renderLibrary();
    });
    nav.append(filter, this.el("nav", "browser-library"));
    parent.append(nav);
    this.renderLibrary();
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
      const status = await request<VaultStatus>(this.api, { type: "status" });
      if (!this.valid(generation)) return;
      this.state = status.state;
      this.render();
      if (this.canUseLibrary()) await this.startUnlocked();
    } catch (error) {
      if (this.valid(generation)) this.fail(error);
    }
  }

  private canUseLibrary(): boolean {
    return (
      this.state === "unlocked" &&
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
    this.content.replaceChildren();
    if (this.privateWindow && !this.allowPrivate) {
      const gate = this.el("section", "browser-gate");
      gate.append(
        this.el("h1", "", "AIC in a private window"),
        this.el(
          "p",
          "",
          "AIC encrypted notes and its own page history persist after private browsing ends. They are stored in your browser profile, separately from browser history.",
        ),
      );
      gate.append(
        this.button("Use AIC in this private window", async () => {
          this.allowPrivate = true;
          this.render();
          if (this.state === "unlocked") await this.startUnlocked();
        }),
      );
      this.content.append(gate);
      return;
    }
    if (this.state !== "unlocked") {
      this.renderCredentials();
      return;
    }
    this.renderPage();
  }

  private passwordField(label: string, parent: HTMLElement): HTMLInputElement {
    const wrapper = this.el("label", "browser-field", label);
    const input = this.el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.setAttribute("aria-label", label);
    input.required = true;
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }

  private renderCredentials(): void {
    const setup = this.state === "setup";
    const form = this.el("form", "browser-gate");
    form.append(
      this.el(
        "h1",
        "",
        setup ? "Encrypt your local notes" : "Your notes are locked",
      ),
    );
    form.append(
      this.el(
        "p",
        "",
        setup
          ? "Choose a master passphrase of at least 12 characters. Keep it safe: there is no password recovery. Notes and AIC page history stay encrypted in this browser profile."
          : "Enter your master passphrase to open notes in this browser session.",
      ),
    );
    const password = this.passwordField("Master passphrase", form);
    const confirm = setup
      ? this.passwordField("Confirm master passphrase", form)
      : null;
    const submit = this.button(
      setup ? "Create encrypted library" : "Unlock",
      () => {},
    );
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      let phrase = password.value;
      const confirmation = confirm?.value;
      password.value = "";
      if (confirm) confirm.value = "";
      if (
        setup &&
        ([...phrase].length < 12 ||
          new TextEncoder().encode(phrase).length > 1024 ||
          phrase !== confirmation)
      ) {
        // Release the local reference; JavaScript strings cannot be zeroed in place.
        // eslint-disable-next-line no-useless-assignment
        phrase = "";
        this.tell(
          "Use at least 12 characters (at most 1024 UTF-8 bytes) and enter the same passphrase twice.",
        );
        return;
      }
      const generation = this.generation;
      submit.disabled = true;
      const pending = request<VaultStatus>(this.api, {
        type: setup ? "setup" : "unlock",
        password: phrase,
      });
      // eslint-disable-next-line no-useless-assignment -- Release our reference after dispatch.
      phrase = "";
      void pending
        .then(async (status) => {
          if (!this.valid(generation)) return;
          this.state = status.state;
          this.tell("");
          this.render();
          await this.startUnlocked();
        })
        .catch(async (error: unknown) => {
          if (this.valid(generation))
            await this.recoverCredentialFailure(error, generation);
        })
        .finally(() => {
          if (this.valid(generation)) submit.disabled = false;
        });
    });
    this.content.append(form);
  }

  private async startUnlocked(): Promise<void> {
    if (!this.canUseLibrary()) return;
    if (!this.drafts) {
      const generation = this.generation;
      this.drafts = new BrowserDrafts(
        async (id, markdown, revision) => {
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          return request<BrowserNote>(this.api, {
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
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          if (!this.page || this.page.url !== page.url)
            throw { code: "page_changed" };
          return request<BrowserNote>(this.api, {
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
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          return request<BrowserDomain>(this.api, {
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
            else if (
              this.library.domains[index]!.id === draft.record.id &&
              this.library.domains[index]!.revision <= draft.record.revision
            )
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
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          if (!this.page || new URL(this.page.url).origin !== context.origin)
            throw { code: "page_changed" };
          return request<BrowserDomain>(this.api, {
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
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          return request<BrowserGlobal>(this.api, {
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
            (!this.library.global ||
              (this.library.global.id === draft.record.id &&
                this.library.global.revision <= draft.record.revision))
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
          if (!this.valid(generation)) throw new Error("AIC is locked.");
          return request<BrowserGlobal>(this.api, {
            type: "create-global",
            markdown,
          });
        },
      );
    }
    await this.refreshContext();
  }

  private async recoverCredentialFailure(
    error: unknown,
    generation: number,
  ): Promise<void> {
    try {
      const status = await request<VaultStatus>(this.api, { type: "status" });
      if (!this.valid(generation)) return;
      if (status.state !== this.state) {
        this.closeOverlay();
        this.state = status.state;
        this.render();
        if (this.canUseLibrary()) await this.startUnlocked();
      }
    } catch {
      /* Keep the original actionable error when status is unavailable. */
    }
    if (this.valid(generation)) this.fail(error);
  }

  private contextChanged(): void {
    if (!this.canUseLibrary()) return;
    void this.refreshContext();
  }

  private dropEditor(): void {
    ++this.editorGeneration;
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
    this.clearMarkdownImport();
    const generation = this.generation;
    const context = ++this.contextGeneration;
    this.contextLoading = true;
    this.setImporting(false);
    this.dropEditor();
    this.page = null;
    this.closeOverlay();
    this.tell("");
    this.renderPage();
    try {
      const page = await request<ActivePage | null>(this.api, {
        type: "context",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      const library = await request<BrowserLibrary>(this.api, {
        type: "visit",
        windowId: this.windowId,
        allowPrivate: this.allowPrivate,
      });
      if (!this.valid(generation, context)) return;
      this.page = page;
      this.library = library;
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
    this.mountGlobalProperties();
    if (this.page) {
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
      empty.append(
        this.el("h1", "", "Your notes and recent pages"),
        this.el(
          "p",
          "",
          "Open a web page to write or import a note. Choose a saved page below to return to it.",
        ),
      );
      this.content.append(empty);
      this.appendNavigation(this.content);
    }
    const warnings = this.el("div", "browser-draft-warnings");
    this.content.append(warnings);
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
    if (!draft.note && !draft.dirty && draft.text === PLACEHOLDER_TEXT)
      this.editor.view.dispatch({ selection: { anchor: draft.text.length } });
    this.reflectDraft(draft);
    this.renderToolbar();
    this.placeSharedProperties();
  }

  private reflectDraft(draft: Draft): void {
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
      initialText: draft.record?.markdown ?? null,
      onChange: (text) => {
        if (this.valid(generation, context))
          this.domainDrafts?.edit(draft.key, text);
      },
      onSave: async (text) => {
        if (!this.valid(generation, context)) return false;
        this.domainDrafts!.edit(draft.key, text);
        return this.domainDrafts!.flush(draft.key);
      },
      onEditingChange: (editing) => {
        if (!this.valid(generation, context)) return;
        this.content.dataset.domainEditing = String(
          editing || this.globalShared?.editing || false,
        );
        this.placeSharedProperties();
        this.renderToolbar();
        if (!editing) this.editor?.focus();
      },
    });
    // Retain local domain edits when returning to the originating site; never
    // render an invalid draft as inherited plaintext in a child page.
    if (draft.dirty) {
      this.shared.startEditing(draft.text);
    }
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
      initialText: draft.record?.markdown ?? null,
      onChange: (text) => {
        if (this.valid(generation, context))
          this.globalDrafts?.edit(draft.key, text);
      },
      onSave: (text) => {
        if (!this.valid(generation, context)) return Promise.resolve(false);
        this.globalDrafts!.edit(draft.key, text);
        return this.globalDrafts!.flush(draft.key);
      },
      onEditingChange: (editing) => {
        if (!this.valid(generation, context)) return;
        this.content.dataset.domainEditing = String(
          editing || this.shared?.editing || false,
        );
        this.placeSharedProperties();
        this.renderToolbar();
        if (!editing) this.editor?.focus();
      },
    });
    if (draft.dirty) this.globalShared.startEditing(draft.text);
    this.reflectDomainDraft(draft, this.globalShared);
  }

  /** Empty scopes share compact inline actions in Global, then domain order. */
  private placeSharedProperties(): void {
    const toolbar = this.content.querySelector(".browser-note .aic-toolbar");
    for (const view of [this.globalShared, this.shared]) {
      if (!view) continue;
      const empty = !view.editing && view.element.dataset.empty === "true";
      const scope = view === this.globalShared ? "global" : "domain";
      const host = this.content.querySelector(
        `.browser-shared-host[data-scope="${scope}"]`,
      );
      const target = empty && toolbar ? toolbar : host;
      if (target && view.element.parentElement !== target)
        target.append(view.element);
    }
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
    this.placeSharedProperties();
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
        const library = await request<BrowserLibrary>(this.api, {
          type: "load",
        });
        if (!this.valid(generation, context)) continue;
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
          else if (this.library.domains[index]!.revision <= record.revision)
            this.library.domains[index] = record;
        }
        if (
          library.global &&
          (!this.library.global ||
            library.global.id !== this.library.global.id ||
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
        // The vault storage event can precede our own write acknowledgment.
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
            "Shared properties could not refresh. Reopen the panel to retry.",
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

  private renderDraftWarnings(): void {
    const target = this.content.querySelector(".browser-draft-warnings");
    if (!target) return;
    target.replaceChildren();
    for (const draft of this.drafts?.dirtyDrafts() ?? []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el(
          "p",
          "",
          `${displayPageTitle(draft.page)} (${displayPageLocation(draft.page.url)}): ${draft.error}`,
        ),
        this.button("Retry save", () => this.drafts?.flush(draft.key)),
        this.button("Export unsaved draft", () => this.exportDraft(draft.key)),
      );
      target.append(warning);
    }
    for (const draft of this.domainDrafts?.dirtyDrafts() ?? []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el("p", "", `${draft.context.origin}: ${draft.error}`),
        this.button("Retry shared save", () =>
          this.domainDrafts?.flush(draft.key),
        ),
        this.button("Export unsaved shared properties", () =>
          this.exportDomainDraft(draft.key),
        ),
      );
      target.append(warning);
    }
    for (const draft of this.globalDrafts?.dirtyDrafts() ?? []) {
      if (!draft.error) continue;
      const warning = this.el("div", "browser-draft-error");
      warning.append(
        this.el("p", "", `Global: ${draft.error}`),
        this.button("Retry global save", () =>
          this.globalDrafts?.flush(draft.key),
        ),
        this.button("Export unsaved global properties", () =>
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
    const domains = buildDomainTree(this.library.notes.filter(matches));
    const activeHost = this.page ? new URL(this.page.url).host : null;
    domains.sort(
      (a, b) => Number(b.host === activeHost) - Number(a.host === activeHost),
    );
    const noteLabels = navigationLabels(this.library.notes.filter(matches));
    const pageLink = (
      page: { url: string; title: string },
      label: string,
      saved: boolean,
    ): HTMLElement => {
      const item = this.el("li");
      const row = this.el("div", "browser-page-row");
      row.dataset.current = String(page.url === this.page?.url);
      const button = this.button(label, () => this.navigate(page.url));
      button.title = displayPageLocation(page.url);
      button.replaceChildren(this.el("span", "browser-page-label", label));
      if (page.url === this.page?.url)
        button.setAttribute("aria-current", "page");
      const remove = this.iconButton(
        `${saved ? "Delete local note" : "Remove recent page"}: ${label}`,
        "×",
        () =>
          this.showDeletePage(
            page.url,
            page.title,
            this.toolbar.querySelector<HTMLButtonElement>(
              '[aria-label="Notes and history"]',
            ) ?? button,
          ),
      );
      remove.classList.add("browser-page-delete");
      remove.disabled = this.importing || this.deleting;
      row.append(button, remove);
      item.append(row);
      return item;
    };
    const appendItems = (items: NavigationItem[], parent: HTMLElement) => {
      for (const entry of items) {
        if (entry.kind === "note") {
          parent.append(
            pageLink(
              entry.note,
              noteLabels.get(entry.note.url) ?? displayPageTitle(entry.note),
              true,
            ),
          );
          continue;
        }
        const group = this.el("li", "browser-path");
        group.append(this.el("span", "browser-path-label", entry.label));
        const children = this.el("ul");
        appendItems(entry.items, children);
        group.append(children);
        parent.append(group);
      }
    };
    for (const domain of domains) {
      const group = this.el("details", "browser-domain");
      group.open =
        !!query || domain.host === activeHost || domains.length === 1;
      group.append(this.el("summary", "", domain.host));
      const list = this.el("ul");
      appendItems(projectDomain(domain), list);
      group.append(list);
      nav.append(group);
    }
    if (!domains.length)
      nav.append(this.el("p", "browser-empty", "No matching notes."));
    const history = this.el("ul", "browser-history");
    const savedUrls = new Set(this.library.notes.map((note) => note.url));
    const visits = this.library.history.filter(
      (visit) => !savedUrls.has(visit.url) && matches(visit),
    );
    if (visits.length) nav.append(this.el("h2", "", "Recent pages"));
    const visitLabels = navigationLabels(visits);
    for (const visit of visits) {
      const item = pageLink(
        visit,
        visitLabels.get(visit.url) ?? displayPageTitle(visit),
        false,
      );
      item.append(this.el("small", "browser-url", new URL(visit.url).host));
      history.append(item);
    }
    nav.append(history);
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
      const capture = await request<PageCapture>(this.api, {
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

  private async appendMarkdown(markdown: string): Promise<void> {
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
    await request(this.api, {
      type: "navigate",
      windowId: this.windowId,
      url,
      allowPrivate: this.allowPrivate,
    });
    if (this.valid(generation, context)) await this.refreshContext();
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

  private async exportBackup(): Promise<void> {
    const generation = this.generation;
    const context = this.contextGeneration;
    if (!(await this.flushAllDrafts())) {
      if (this.valid(generation, context))
        this.tell(
          "Backup paused: retry saving or export your unsaved draft first.",
        );
      return;
    }
    if (!this.valid(generation, context)) return;
    const text = await request<string>(this.api, { type: "export" });
    if (this.valid(generation, context))
      this.download(text, "aic-encrypted-backup.json", "application/json");
  }

  private closeOverlay(restoreFocus = false): void {
    const trigger = this.overlayTrigger;
    this.overlayTrigger = null;
    trigger?.setAttribute("aria-expanded", "false");
    for (const input of this.overlay.querySelectorAll("input"))
      input.value = "";
    this.overlay.replaceChildren();
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  private importBackupDialog(): void {
    if (this.state === "locked") {
      this.tell("Unlock your existing library before importing a backup.");
      return;
    }
    if (this.privateWindow && !this.allowPrivate) {
      this.tell("Read and accept the private-window notice first.");
      return;
    }
    const trigger = this.overlayTrigger;
    this.closeOverlay();
    this.overlayTrigger = trigger;
    trigger?.setAttribute("aria-expanded", "true");
    const form = this.el("form", "browser-import");
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-label", "Import encrypted backup");
    form.append(
      this.el("h2", "", "Import encrypted backup"),
      this.el(
        "p",
        "",
        this.state === "setup"
          ? "Restore the library using its original backup passphrase."
          : "Merge new URLs. Existing notes will not be overwritten.",
      ),
    );
    const file = this.el("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.required = true;
    file.setAttribute("aria-label", "Encrypted backup file");
    form.append(file);
    const password = this.passwordField("Backup passphrase", form);
    const submit = this.button("Restore or merge backup", () => {});
    submit.type = "submit";
    form.append(
      submit,
      this.button("Cancel import", () => this.closeOverlay(true)),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = file.files?.[0];
      if (!selected) return;
      let phrase = password.value;
      password.value = "";
      const generation = this.generation;
      const context = this.contextGeneration;
      submit.disabled = true;
      void (async () => {
        if (selected.size > 9 * 1024 * 1024)
          throw new Error("This backup is too large.");
        const text = await selected.text();
        if (!this.valid(generation, context) || !form.isConnected) return;
        if (!(await this.flushAllDrafts()))
          throw new Error(
            "Save or export unsaved drafts before merging a backup.",
          );
        if (!this.valid(generation, context) || !form.isConnected) return;
        const pending = request<{
          created: number;
          skipped: number;
          domainsCreated: number;
          domainsSkipped: number;
          globalCreated: number;
          globalSkipped: number;
        }>(this.api, { type: "import", text, password: phrase });
        phrase = "";
        const result = await pending;
        if (!this.valid(generation, context)) return;
        this.closeOverlay();
        this.state = "unlocked";
        this.render();
        await this.startUnlocked();
        if (this.valid(generation))
          this.tell(
            `Imported ${result.created} notes and ${result.domainsCreated} domain shared sets; skipped ${result.skipped} existing URLs and ${result.domainsSkipped} existing domain shared sets.${result.globalCreated ? " Imported Global properties." : ""}${result.globalSkipped ? " Kept existing Global properties; the backup’s Global properties were skipped and remain in your backup file." : ""}`,
            result.globalSkipped ? "progress" : "info",
          );
      })()
        .catch(async (error: unknown) => {
          if (this.valid(generation, context))
            await this.recoverCredentialFailure(error, generation);
        })
        .finally(() => {
          phrase = "";
          password.value = "";
          file.value = "";
          if (this.valid(generation, context)) submit.disabled = false;
        });
    });
    this.overlay.append(form);
    file.focus();
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

  private async lock(discard = false): Promise<void> {
    const generation = this.generation;
    if (!discard && !(await this.flushAllDrafts())) {
      if (!this.valid(generation)) return;
      this.tell(
        "Some changes could not be saved. Export plaintext drafts before discarding and locking.",
      );
      this.closeOverlay();
      for (const draft of this.drafts?.dirtyDrafts() ?? [])
        this.overlay.append(
          this.button(
            `Export unsaved draft: ${displayPageTitle(draft.page)}`,
            () => this.exportDraft(draft.key),
          ),
        );
      for (const draft of this.domainDrafts?.dirtyDrafts() ?? [])
        this.overlay.append(
          this.button(
            `Export unsaved shared properties: ${draft.context.origin}`,
            () => this.exportDomainDraft(draft.key),
          ),
        );
      for (const draft of this.globalDrafts?.dirtyDrafts() ?? [])
        this.overlay.append(
          this.button("Export unsaved global properties", () =>
            this.exportDomainDraft(draft.key, true),
          ),
        );
      this.overlay.append(
        this.button("Discard unsaved changes and lock", () => this.lock(true)),
        this.button("Keep editing", () => this.closeOverlay()),
      );
      return;
    }
    if (!this.valid(generation)) return;
    this.clearPlaintext();
    this.state = "locked";
    this.render();
    const lockedGeneration = this.generation;
    try {
      await request(this.api, { type: "lock" });
    } catch (error) {
      if (this.valid(lockedGeneration)) {
        this.fail(error);
        this.overlay.append(
          this.button("Retry locking all panels", () => this.lock(true)),
        );
      }
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
    this.page = null;
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
    // interrupt delivery; only an acknowledged save or export is durable.
    if (!this.disposed) void this.flushAllDrafts().catch(() => {});
  }

  destroy(): void {
    if (this.disposed) return;
    this.clearPlaintext();
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.root.replaceChildren();
  }
}
