import { syntaxTree } from "@codemirror/language";
import { AicEditor } from "../editor";
import { writeTextToClipboard } from "../core/structured-preview.js";
import { PROPERTIES_SYNTAX_MARKER } from "../core/field-syntax.js";
import { request, type ActivePage, type BrowserApi } from "./api";
import { BrowserDrafts, type Draft } from "./drafts";
import { DomainDrafts, type DomainDraft } from "./domain-drafts";
import { DomainPropertiesView } from "./domain-properties";
import {
  buildDomainTree,
  type BrowserLibrary,
  type BrowserDomain,
  type BrowserNote,
} from "./library";
import {
  navigationLabels,
  projectDomain,
  shortPath,
  type NavigationItem,
} from "./navigation";
import { importCapturedPage } from "./import-page";
import type { PageCapture } from "./capture-page";
import type { VaultStatus } from "./vault-store";

const SESSION_KEY = "aic-browser-unlock";
const PLACEHOLDER_TEXT = `---\n${PROPERTIES_SYNTAX_MARKER}\n---\n\n`;
const emptyLibrary = (): BrowserLibrary => ({
  version: 2,
  notes: [],
  history: [],
  domains: [],
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
  private noteId: string | null = null;
  private drafts: BrowserDrafts | null = null;
  private domainDrafts: DomainDrafts | null = null;
  private shared: DomainPropertiesView | null = null;
  private domainKey: string | null = null;
  private domainReload: Promise<void> | null = null;
  private domainReloadRevision = 0;
  private domainRefreshDeferred = false;
  private filter = "";
  private importing = false;
  private contextLoading = false;
  private overlayTrigger: HTMLButtonElement | null = null;
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
    this.feedback = this.el("div", "browser-feedback");
    this.feedback.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.content = this.el("main", "browser-content");
    this.overlay = this.el("div", "browser-overlay");
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
            title.textContent = change.title;
            (title as HTMLElement).title = change.title;
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
    };
    media?.addEventListener("change", theme);
    this.cleanups.push(() => media?.removeEventListener("change", theme));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        this.drafts?.hasPendingChanges() ||
        this.domainDrafts?.hasPendingChanges()
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
    const button = this.el("button", "browser-button", label);
    button.type = "button";
    button.setAttribute("aria-label", label);
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
    button.classList.add("browser-icon-button");
    button.title = label;
    const icon = this.el("span", "", glyph);
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon);
    return button;
  }

  private importButton(
    label: string,
    action: (button: HTMLButtonElement) => void | Promise<unknown>,
  ): HTMLButtonElement {
    const button = this.button(label, action);
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
          : this.page?.title || "Your notes",
      );
      title.title = this.page?.title || "Your notes";
      identity.append(title);
      if (this.page) {
        const source = this.el(
          "small",
          "browser-page-origin",
          new URL(this.page.url).host,
        );
        source.title = this.page.url;
        identity.append(source);
      }
      this.toolbar.append(identity);
      if (this.page && !this.shared?.editing) {
        const add = this.importButton("Add content", (button) =>
          this.showImportMenu(button),
        );
        add.classList.add("browser-add-content");
        add.title =
          "Add page content, selected text, clipboard text, or Markdown to this note";
        this.toolbar.append(add);
      }
    } else {
      this.toolbar.append(this.el("span", "browser-brand", ">_ AIC"));
    }
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
        ["Notes and history", "More options", "Add content"].includes(
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

  private showImportMenu(trigger: HTMLButtonElement): void {
    if (!this.page || !this.canUseLibrary()) return;
    const box = this.showPopover("Add content", trigger);
    if (!box) return;
    box.append(
      this.el("h2", "", "Add to this note"),
      this.el(
        "p",
        "browser-menu-hint",
        "Append content. The website and existing text stay unchanged.",
      ),
      this.importButton("Import page", () => this.capture("page")),
      this.importButton("Import selection", () => this.capture("selection")),
      this.importButton("Paste from clipboard", () => this.pasteClipboard()),
      this.importButton("Import Markdown", () => this.importMarkdownDialog()),
    );
    box.querySelector<HTMLButtonElement>("button")?.focus();
  }

  private showMoreMenu(trigger: HTMLButtonElement): void {
    const box = this.showPopover("More options", trigger);
    if (!box) return;
    if (this.editor && this.noteId && !this.shared?.editing) {
      const noteId = this.noteId;
      box.append(
        this.button("Copy note", () => {
          this.closeOverlay(true);
          return this.copy(false);
        }),
        this.button("Copy block or selection", () => {
          this.closeOverlay(true);
          return this.copy(true);
        }),
        this.button("Export Markdown", () => {
          this.closeOverlay(true);
          this.exportDraft(noteId);
        }),
        this.el(
          "p",
          "browser-menu-hint",
          "Copy and Markdown export include plaintext, including hidden secrets.",
        ),
        this.el("hr"),
      );
    }
    box.append(
      this.button("Export encrypted backup", () => {
        this.closeOverlay(true);
        return this.exportBackup();
      }),
      this.button("Import encrypted backup", () => this.importBackupDialog()),
    );
    box.querySelector<HTMLButtonElement>("button")?.focus();
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
            if (index < 0) this.library.notes.push(draft.note);
            else this.library.notes[index] = draft.note;
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
    this.noteId = null;
    this.editor?.destroy();
    this.editor = null;
    this.shared?.destroy();
    this.shared = null;
    this.domainKey = null;
    this.content.dataset.domainEditing = "false";
  }

  private async refreshContext(): Promise<void> {
    if (!this.canUseLibrary() || this.windowId === null) return;
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
    if (this.page) {
      this.mountSharedProperties();
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
    this.noteId = draft.key;
    const host = this.el("section", "browser-note");
    const editorHost = this.el("div", "browser-editor-host");
    host.append(editorHost);
    this.content.append(host);
    this.editor = new AicEditor(editorHost, {
      initialText: draft.text,
      compactToolbar: true,
      onChange: (text) => {
        if (this.valid(generation, context)) this.drafts?.edit(draft.key, text);
      },
      onSave: () =>
        this.valid(generation, context) ? this.drafts!.flush(draft.key) : false,
    });
    this.editor.switchDocument(draft.key, draft.text);
    if (!draft.note && !draft.dirty && draft.text === PLACEHOLDER_TEXT)
      this.editor.view.dispatch({ selection: { anchor: draft.text.length } });
    this.reflectDraft(draft);
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
        this.content.dataset.domainEditing = String(editing);
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

  private reflectDomainDraft(draft: DomainDraft): void {
    if (!this.shared) return;
    if (!draft.dirty && !draft.saving && draft.record)
      this.shared.update(draft.record.markdown);
    this.shared.setSaveState(
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
    if (!this.canUseLibrary() || !this.page || !this.domainDrafts) return;
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
        for (const record of library.domains) {
          const index = this.library.domains.findIndex(
            (item) => item.origin === record.origin,
          );
          if (index < 0) this.library.domains.push(record);
          else if (this.library.domains[index]!.revision <= record.revision)
            this.library.domains[index] = record;
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
          `${draft.page.title || draft.page.url}: ${draft.error}`,
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
  }

  private renderLibrary(): void {
    const nav =
      this.overlay.querySelector(".browser-library") ??
      this.content.querySelector(".browser-library");
    if (!nav) return;
    nav.replaceChildren();
    const query = this.filter.toLocaleLowerCase();
    const matches = (item: { title: string; url: string }) =>
      `${item.title}\n${item.url}`.toLocaleLowerCase().includes(query);
    const domains = buildDomainTree(this.library.notes.filter(matches));
    const activeHost = this.page ? new URL(this.page.url).host : null;
    domains.sort(
      (a, b) => Number(b.host === activeHost) - Number(a.host === activeHost),
    );
    const noteLabels = navigationLabels(this.library.notes.filter(matches));
    const noteLink = (note: BrowserNote): HTMLElement => {
      const item = this.el("li");
      const button = this.button(
        noteLabels.get(note.url) ?? (note.title.trim() || shortPath(note.url)),
        () => this.navigate(note.url),
      );
      button.title = note.url;
      item.append(button);
      return item;
    };
    const appendItems = (items: NavigationItem[], parent: HTMLElement) => {
      for (const entry of items) {
        if (entry.kind === "note") {
          parent.append(noteLink(entry.note));
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
    nav.append(this.el("h2", "", "Recent pages"));
    const history = this.el("ul", "browser-history");
    const visits = this.library.history.filter(matches);
    const visitLabels = navigationLabels(visits);
    for (const visit of visits) {
      const item = this.el("li");
      const button = this.button(
        visitLabels.get(visit.url) ??
          (visit.title.trim() || shortPath(visit.url)),
        () => this.navigate(visit.url),
      );
      button.title = visit.url;
      item.append(
        button,
        this.el("small", "browser-url", new URL(visit.url).host),
      );
      history.append(item);
    }
    nav.append(history);
  }

  private capture(mode: "page" | "selection"): Promise<void> | void {
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
      mode === "page" ? "Importing page…" : "Importing selected text…",
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
            "No readable content found. Select text on the page or paste from the clipboard.",
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

  private pasteClipboard(): Promise<void> | void {
    if (!this.page || !this.canUseLibrary()) return;
    this.requireImportReady();
    const clipboard = this.document.defaultView?.navigator.clipboard;
    if (!clipboard?.readText)
      throw new Error(
        "Clipboard access is unavailable. Paste directly into the note with Ctrl+V, or import a Markdown file.",
      );
    const generation = this.generation;
    const context = this.contextGeneration;
    // Read only on an explicit click, before its user activation expires.
    const pending = clipboard.readText();
    this.closeOverlay();
    this.setImporting(true);
    this.tell("Pasting from clipboard…", "progress");
    return (async () => {
      let text: string;
      try {
        text = await pending;
      } catch {
        throw new Error(
          "Clipboard access was denied. Paste directly into the note with Ctrl+V, or import a Markdown file.",
        );
      }
      if (!this.valid(generation, context)) return;
      if (!text.trim()) {
        this.tell("Clipboard is empty. Copy text first, then try again.");
        return;
      }
      if (new TextEncoder().encode(text).length > 512 * 1024)
        throw new Error(
          "Clipboard text exceeds the note size limit. Import a smaller selection.",
        );
      await this.appendMarkdown(text);
      if (this.valid(generation, context))
        this.tell("Pasted into this page’s note.", "success");
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

  private async copy(block: boolean): Promise<void> {
    if (!this.editor) return;
    const generation = this.generation;
    const context = this.contextGeneration;
    const state = this.editor.view.state;
    let text = this.editor.value;
    if (block) {
      const selection = state.selection.main;
      if (!selection.empty) text = state.sliceDoc(selection.from, selection.to);
      else {
        let node = syntaxTree(state).resolveInner(selection.head, -1);
        while (node.parent?.parent) node = node.parent;
        if (!node.parent) {
          this.tell(
            "Place the cursor in a Markdown block or select text to copy.",
          );
          return;
        }
        text = state.sliceDoc(node.from, node.to);
      }
    }
    const copied = await writeTextToClipboard(text, this.document);
    if (this.valid(generation, context))
      this.tell(
        copied
          ? "Plaintext copied to clipboard."
          : "Clipboard is unavailable. Export Markdown instead.",
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

  private exportDomainDraft(key: string): void {
    const draft = this.domainDrafts?.get(key);
    if (!draft) return;
    this.download(
      draft.text,
      "aic-unsaved-shared-properties.md",
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
            `Imported ${result.created} notes and ${result.domainsCreated} shared sets; skipped ${result.skipped} existing URLs and ${result.domainsSkipped} existing shared sets.`,
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

  private importMarkdownDialog(): void {
    if (!this.page) return;
    const trigger = this.overlayTrigger;
    this.closeOverlay();
    this.overlayTrigger = trigger;
    trigger?.setAttribute("aria-expanded", "true");
    const box = this.el("section", "browser-import");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Import Markdown");
    box.append(
      this.el("p", "", "Append a Markdown file to the active page’s note."),
    );
    const file = this.el("input");
    file.type = "file";
    file.accept = ".md,.markdown,text/markdown,text/plain";
    file.setAttribute("aria-label", "Markdown file");
    box.append(
      file,
      this.button("Append Markdown file", async () => {
        this.requireImportReady();
        const selected = file.files?.[0];
        if (!selected) return;
        if (selected.size > 512 * 1024)
          throw new Error("Markdown file exceeds the note size limit.");
        const generation = this.generation;
        const context = this.contextGeneration;
        this.setImporting(true);
        this.tell("Importing Markdown…", "progress");
        try {
          const text = await selected.text();
          if (!this.valid(generation, context) || !box.isConnected) return;
          this.closeOverlay();
          await this.appendMarkdown(text);
          if (this.valid(generation, context))
            this.tell("Imported into this page’s note.", "success");
        } finally {
          if (this.valid(generation, context)) this.setImporting(false);
        }
      }),
      this.button("Cancel import", () => this.closeOverlay(true)),
    );
    this.overlay.append(box);
    file.focus();
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
            `Export unsaved draft: ${draft.page.title || "note"}`,
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
    ++this.generation;
    ++this.contextGeneration;
    this.dropEditor();
    this.drafts?.dispose();
    this.drafts = null;
    this.domainDrafts?.dispose();
    this.domainDrafts = null;
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
