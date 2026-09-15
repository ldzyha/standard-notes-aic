import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: (callback: (...args: T) => unknown) => {
      listeners.add(callback);
    },
    removeListener: (callback: (...args: T) => unknown) => {
      listeners.delete(callback);
    },
    emit: (...args: T) => {
      for (const callback of listeners) callback(...args);
    },
    listeners,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const note = (url: string, markdown = "Private body"): BrowserNote => ({
  id: url,
  url,
  title: `Note ${url}`,
  markdown,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});

function fixture(
  options: {
    state?: "setup" | "locked" | "unlocked";
    private?: boolean;
    notes?: BrowserNote[];
  } = {},
) {
  let state = options.state ?? "unlocked";
  let page: ActivePage | null = {
    tabId: 7,
    windowId: 2,
    title: "Active page",
    url: "https://example.com/a",
  };
  const library: BrowserLibrary = {
    version: 2,
    domains: [],
    notes: options.notes ?? [],
    history: [],
  };
  const changed = event<[Record<string, unknown>, string]>();
  const activated = event<[{ tabId: number; windowId: number }]>();
  const updated =
    event<
      [
        number,
        { url?: string; title?: string; status?: string },
        { id?: number; windowId: number; active?: boolean },
      ]
    >();
  const removed = event<[number, { windowId: number }]>();
  let override:
    ((message: Request) => Promise<unknown> | undefined) | undefined;
  const messages: Request[] = [];
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        const custom = override?.(message);
        if (custom) return { ok: true, value: await custom };
        let value: unknown;
        switch (message.type) {
          case "status":
            value = { state };
            break;
          case "setup":
          case "unlock":
            state = "unlocked";
            value = { state };
            break;
          case "lock":
            state = "locked";
            changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
            value = { state };
            break;
          case "context":
            value = page;
            break;
          case "load":
          case "visit":
            value = structuredClone(library);
            break;
          case "create": {
            const created = note(message.page.url, message.markdown);
            library.notes.push(created);
            value = structuredClone(created);
            break;
          }
          case "save": {
            const existing = library.notes.find(
              (item) => item.id === message.id,
            )!;
            Object.assign(existing, {
              markdown: message.markdown,
              revision: message.revision + 1,
            });
            value = structuredClone(existing);
            break;
          }
          case "navigate":
            page = {
              tabId: 8,
              windowId: 2,
              title: "Navigated",
              url: message.url,
            };
            value = null;
            break;
          case "capture":
            value = {
              url: message.page.url,
              title: "Imported",
              html: "<p>Captured content</p>",
              truncated: false,
            };
            break;
          default:
            value = null;
        }
        return { ok: true, value };
      },
    },
    windows: {
      getCurrent: async () => ({ id: 2, incognito: options.private ?? false }),
    },
    storage: { onChanged: changed },
    tabs: { onActivated: activated, onUpdated: updated, onRemoved: removed },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    library,
    changed,
    activated,
    updated,
    removed,
    setPage: (next: ActivePage | null) => {
      page = next;
    },
    override: (callback: typeof override) => {
      override = callback;
    },
  };
}

const panels: BrowserPanel[] = [];
function mount(api: BrowserApi) {
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  return { root, panel };
}
function button(root: HTMLElement, label: string) {
  return root.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
function editor(root: HTMLElement) {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".cm-editor")!,
  )!;
}
function importPage(root: HTMLElement) {
  button(root, "Import current content").click();
}
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser panel", () => {
  it("keeps a new Properties placeholder unsaved until the first edit", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = editor(root);
    const seed = AIC_EMPTY_DOCUMENT;
    expect(initial.state.doc.toString()).toBe(seed);
    expect(root.querySelector(".cm-aic-security")).not.toBeNull();
    expect(
      root.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState,
    ).toBe("placeholder");
    button(root, "Notes and history").click();
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );
    expect(editor(root)).toBe(initial);
    initial.dispatch({
      changes: { from: seed.length, insert: "My note" },
      selection: { anchor: seed.length + "My note".length },
    });
    button(root, "Save note").click();
    await vi.waitFor(() =>
      expect(fake.messages).toContainEqual({
        type: "create",
        page: {
          tabId: 7,
          windowId: 2,
          title: "Active page",
          url: "https://example.com/a",
        },
        markdown: `${seed}My note`,
        allowPrivate: false,
        ifAbsent: true,
      }),
    );
    expect(editor(root)).toBe(initial);
    expect(initial.state.selection.main.anchor).toBe(seed.length + 7);
  });

  it("warns before closing while an undone first-create is still in flight", async () => {
    const fake = fixture();
    const creating = deferred<BrowserNote>();
    const compensating = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "create"
        ? creating.promise
        : message.type === "save"
          ? compensating.promise
          : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    const seed = view.state.doc.toString();
    const leaving = () => new Event("beforeunload", { cancelable: true });
    const pristine = leaving();
    expect(window.dispatchEvent(pristine)).toBe(true);
    expect(pristine.defaultPrevented).toBe(false);

    const changed = `${seed}Temporary text`;
    view.dispatch({ changes: { from: seed.length, insert: "Temporary text" } });
    button(root, "Save note").click();
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "create")).toBe(
        true,
      ),
    );
    view.dispatch({ changes: { from: 0, to: changed.length, insert: seed } });
    expect(view.state.doc.toString()).toBe(seed);
    const pendingCreate = leaving();
    expect(window.dispatchEvent(pendingCreate)).toBe(false);
    expect(pendingCreate.defaultPrevented).toBe(true);

    creating.resolve(note("https://example.com/a", changed));
    await vi.waitFor(() =>
      expect(fake.messages).toContainEqual({
        type: "save",
        id: "https://example.com/a",
        markdown: seed,
        revision: 1,
      }),
    );
    const pendingCompensation = leaving();
    expect(window.dispatchEvent(pendingCompensation)).toBe(false);
    compensating.resolve({
      ...note("https://example.com/a", seed),
      revision: 2,
    });
    await vi.waitFor(() =>
      expect(
        root.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState,
      ).toBe("saved"),
    );
    const settled = leaving();
    expect(window.dispatchEvent(settled)).toBe(true);
    expect(settled.defaultPrevented).toBe(false);
  });

  it("saves a first edit after returning from a quick tab switch without a manual retry", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const seed = editor(root).state.doc.toString();
    editor(root).dispatch({
      changes: { from: seed.length, insert: "Draft from first tab" },
    });
    fake.setPage({
      tabId: 9,
      windowId: 2,
      title: "Second page",
      url: "https://example.com/b",
    });
    fake.activated.emit({ tabId: 9, windowId: 2 });
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-page-title")?.textContent).toBe(
        "Second page",
      ),
    );
    await vi.waitFor(() =>
      expect(root.textContent).toContain(
        "Return to this page to save your new note, or export the draft.",
      ),
    );
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );

    fake.setPage({
      tabId: 7,
      windowId: 2,
      title: "Active page",
      url: "https://example.com/a",
    });
    fake.activated.emit({ tabId: 7, windowId: 2 });
    await vi.waitFor(() =>
      expect(editor(root).state.doc.toString()).toBe(
        `${seed}Draft from first tab`,
      ),
    );
    await vi.waitFor(() =>
      expect(fake.messages).toContainEqual({
        type: "create",
        page: {
          tabId: 7,
          windowId: 2,
          title: "Active page",
          url: "https://example.com/a",
        },
        markdown: `${seed}Draft from first tab`,
        allowPrivate: false,
        ifAbsent: true,
      }),
    );
    await vi.waitFor(() =>
      expect(
        root.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState,
      ).toBe("saved"),
    );
  });

  it("requires matching setup passphrases and clears password inputs before sending", async () => {
    const fake = fixture({ state: "setup" });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const fields = root.querySelectorAll<HTMLInputElement>(
      'input[type="password"]',
    );
    fields[0]!.value = "long master phrase";
    fields[1]!.value = "different phrase";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(fake.messages.some((item) => item.type === "setup")).toBe(false);
    expect(fields[0]!.value).toBe("");
    fields[0]!.value = fields[1]!.value = "long master phrase";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(fields[0]!.value).toBe("");
    expect(fields[1]!.value).toBe("");
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(root.querySelector(".cm-aic-security")).not.toBeNull();
    expect(fake.messages.some((item) => item.type === "create")).toBe(false);
    expect(root.dataset.state).toBe("unlocked");
  });

  it("shows no titles, URLs, or editor until an existing vault is unlocked", async () => {
    const fake = fixture({
      state: "locked",
      notes: [note("https://example.com/a")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.textContent).not.toContain("example.com");
    expect(root.querySelector(".cm-editor")).toBeNull();
    const password = root.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    password.value = "long master phrase";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(password.value).toBe("");
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
  });

  it("gates private windows before context/history access and keeps consent only in the panel", async () => {
    const fake = fixture({ private: true });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.textContent).toContain("persist after private browsing ends");
    expect(fake.messages.map((item) => item.type)).toEqual(["status"]);
    button(root, "Use AIC in this private window").click();
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(fake.messages.some((item) => item.type === "create")).toBe(false);
    expect(fake.messages).toContainEqual({
      type: "context",
      windowId: 2,
      allowPrivate: true,
    });
    const other = mount(fake.api);
    await other.panel.ready;
    expect(other.root.dataset.privateConsent).toBe("required");
  });

  it("clears the previous editor synchronously on own-window changes and ignores other windows", async () => {
    const fake = fixture({ notes: [note("https://example.com/a")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const original = editor(root);
    fake.activated.emit({ tabId: 11, windowId: 3 });
    expect(editor(root)).toBe(original);
    fake.setPage({
      tabId: 9,
      windowId: 2,
      title: "Second",
      url: "https://example.com/b",
    });
    fake.activated.emit({ tabId: 9, windowId: 2 });
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.textContent).not.toContain("Private body");
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(root.querySelector(".cm-aic-security")).not.toBeNull();
    expect(root.querySelector(".browser-page-title")!.textContent).toBe(
      "Second",
    );
    expect(root.querySelector<HTMLElement>(".browser-page-origin")!.title).toBe(
      "example.com/b",
    );
  });

  it("waits for persistence ACK without resetting the editor or cursor", async () => {
    const original = note("https://example.com/a", "Text");
    const fake = fixture({ notes: [original] });
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({
      changes: { from: 4, insert: " edited" },
      selection: { anchor: 8 },
    });
    button(root, "Save note").click();
    expect(
      root.querySelector<HTMLElement>(".aic-editor")!.dataset.saveFeedback,
    ).toBe("saving");
    expect(view.state.selection.main.anchor).toBe(8);
    pending.resolve({ ...original, markdown: "Text edited", revision: 2 });
    await vi.waitFor(() =>
      expect(
        root.querySelector<HTMLElement>(".aic-editor")!.dataset.saveFeedback,
      ).toBe("saved"),
    );
    expect(editor(root)).toBe(view);
    expect(view.state.selection.main.anchor).toBe(8);
  });

  it("locks every panel immediately and rejects a late plaintext response", async () => {
    const fake = fixture({ notes: [note("https://example.com/a")] });
    const one = mount(fake.api);
    const two = mount(fake.api);
    await Promise.all([one.panel.ready, two.panel.ready]);
    const pending = deferred<BrowserLibrary>();
    fake.override((message) =>
      message.type === "visit" ? pending.promise : undefined,
    );
    fake.setPage({
      tabId: 9,
      windowId: 2,
      title: "Same URL, another tab",
      url: "https://example.com/a",
    });
    fake.activated.emit({ tabId: 9, windowId: 2 });
    await vi.waitFor(() =>
      expect(fake.messages.filter((item) => item.type === "visit").length).toBe(
        4,
      ),
    );
    fake.changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    for (const { root } of [one, two]) {
      expect(root.dataset.state).toBe("locked");
      expect(root.textContent).not.toContain("example.com");
      expect(root.querySelector(".cm-editor")).toBeNull();
    }
    pending.resolve(structuredClone(fake.library));
    await Promise.resolve();
    await Promise.resolve();
    expect(one.root.textContent).not.toContain("Private body");
    expect(two.root.textContent).not.toContain("example.com");
  });

  it("requests capture permission inside the click and appends to the existing note", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Existing")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    importPage(root);
    expect(fake.api.permissions.request).toHaveBeenCalledWith({
      origins: ["https://example.com/*"],
    });
    await vi.waitFor(() =>
      expect(editor(root).state.doc.toString()).toBe(
        "Existing\n\nCaptured content",
      ),
    );
    expect(fake.messages.some((item) => item.type === "capture")).toBe(true);
  });

  it("retains failed drafts and requires deliberate discard before locking", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    fake.override((message) =>
      message.type === "save"
        ? Promise.reject(new Error("Storage full"))
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    editor(root).dispatch({ changes: { from: 8, insert: " unsaved" } });
    button(root, "Lock").click();
    await vi.waitFor(() =>
      expect(button(root, "Discard unsaved changes and lock")).not.toBeNull(),
    );
    expect(root.dataset.state).toBe("unlocked");
    expect(editor(root).state.doc.toString()).toBe("Original unsaved");
    expect(fake.messages.some((item) => item.type === "lock")).toBe(false);
    button(root, "Discard unsaved changes and lock").click();
    await vi.waitFor(() => expect(root.dataset.state).toBe("locked"));
  });

  it("removes listeners and cancels pending autosave on disposal", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    vi.useFakeTimers();
    editor(root).dispatch({ changes: { from: 8, insert: " unsaved" } });
    panel.destroy();
    expect(fake.changed.listeners.size).toBe(0);
    expect(fake.activated.listeners.size).toBe(0);
    expect(fake.updated.listeners.size).toBe(0);
    expect(fake.removed.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.messages.some((item) => item.type === "save")).toBe(false);
    expect(root.textContent).toBe("");
  });

  it("keeps editor identity, undo, and cursor during same-page metadata updates", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({ selection: { anchor: 3 } });
    fake.updated.emit(
      7,
      { title: "New page title", status: "complete" },
      { id: 7, windowId: 2, active: true },
    );
    expect(editor(root)).toBe(view);
    expect(view.state.selection.main.anchor).toBe(3);
    expect(root.querySelector(".browser-page-title")!.textContent).toBe(
      "New page title",
    );
  });

  it("recovers to unlock when initial local encryption persisted but session creation failed", async () => {
    const fake = fixture({ state: "setup" });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    fake.override((message) =>
      message.type === "setup"
        ? Promise.reject(new Error("Session storage failed"))
        : message.type === "status"
          ? Promise.resolve({ state: "locked" })
          : undefined,
    );
    for (const field of root.querySelectorAll<HTMLInputElement>(
      'input[type="password"]',
    ))
      field.value = "long master phrase";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(root.dataset.state).toBe("locked"));
    expect(button(root, "Unlock")).not.toBeNull();
    expect(root.textContent).toContain("Session storage failed");
  });

  it("retains an import that failed to create a note and blocks silent lock", async () => {
    const fake = fixture();
    fake.override((message) =>
      message.type === "create"
        ? Promise.reject(new Error("Storage full"))
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    importPage(root);
    await vi.waitFor(() =>
      expect(button(root, "Export unsaved draft")).not.toBeNull(),
    );
    button(root, "Lock").click();
    await vi.waitFor(() =>
      expect(button(root, "Discard unsaved changes and lock")).not.toBeNull(),
    );
    expect(root.dataset.state).toBe("unlocked");
    expect(fake.messages.some((message) => message.type === "lock")).toBe(
      false,
    );
  });

  it("does not claim a captured append was saved when persistence fails", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Existing")],
    });
    fake.override((message) =>
      message.type === "save"
        ? Promise.reject(new Error("Storage full"))
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    importPage(root);
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-feedback")!.textContent).toContain(
        "unsaved draft",
      ),
    );
    expect(root.textContent).not.toContain("Imported into this page");
    expect(editor(root).state.doc.toString()).toContain("Captured content");
  });

  it("describes global lock and dispatches a final save before pagehide clears plaintext", async () => {
    const original = note("https://example.com/a", "Original");
    const fake = fixture({ notes: [original] });
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(button(root, "Lock").title).toMatch(
      /Lock (?:all|every) AIC panels?/iu,
    );
    expect(button(root, "Lock").getAttribute("aria-description")).toMatch(
      /other panels first/iu,
    );
    editor(root).dispatch({ changes: { from: 8, insert: " edited" } });
    window.dispatchEvent(new Event("pagehide"));
    expect(fake.messages).toContainEqual({
      type: "save",
      id: original.id,
      markdown: "Original edited",
      revision: 1,
    });
    expect(root.textContent).toBe("");
    expect(fake.changed.listeners.size).toBe(0);
    pending.resolve({ ...original, markdown: "Original edited", revision: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.textContent).toBe("");
    expect(root.querySelector(".cm-editor")).toBeNull();
  });

  it("initiates a best-effort save on visibility hidden and removes the old editor", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({ changes: { from: 8, insert: " edited" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fake.messages.some((message) => message.type === "save")).toBe(true);
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.textContent).not.toContain("Original");
  });

  it("does not track hidden tab changes and refreshes the current page on visibility resume", async () => {
    const fake = fixture({
      notes: [
        note("https://example.com/a", "Previous secret"),
        note("https://example.com/b", "Current note"),
      ],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    const count = fake.messages.length;
    fake.setPage({
      tabId: 9,
      windowId: 2,
      title: "Second page",
      url: "https://example.com/b",
    });
    fake.activated.emit({ tabId: 9, windowId: 2 });
    fake.updated.emit(
      9,
      { url: "https://example.com/b", status: "complete" },
      { id: 9, windowId: 2, active: true },
    );
    expect(fake.messages).toHaveLength(count);
    expect(root.querySelector(".cm-editor")).toBeNull();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(root.textContent).not.toContain("Previous secret");
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(editor(root).state.doc.toString()).toBe("Current note");
    expect(fake.messages.slice(count).map((message) => message.type)).toEqual([
      "context",
      "visit",
    ]);
  });

  it("does not visit after a context request finishes while hidden", async () => {
    const fake = fixture();
    const pending = deferred<ActivePage | null>();
    fake.override((message) =>
      message.type === "context" ? pending.promise : undefined,
    );
    const { panel } = mount(fake.api);
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "context")).toBe(
        true,
      ),
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    pending.resolve({
      tabId: 7,
      windowId: 2,
      title: "Hidden",
      url: "https://example.com/a",
    });
    await panel.ready;
    expect(fake.messages.some((message) => message.type === "visit")).toBe(
      false,
    );
  });

  it("retains failed imports in one editable draft and exports their combined text", async () => {
    const fake = fixture();
    fake.override((message) =>
      message.type === "create"
        ? Promise.reject(new Error("Storage full"))
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    importPage(root);
    await vi.waitFor(() =>
      expect(button(root, "Export unsaved draft")).not.toBeNull(),
    );
    const firstText = editor(root).state.doc.toString();
    expect(firstText).toContain("Captured content");
    importPage(root);
    await vi.waitFor(() =>
      expect(
        fake.messages.filter((message) => message.type === "capture"),
      ).toHaveLength(2),
    );
    expect(
      root.querySelectorAll('button[aria-label="Export unsaved draft"]'),
    ).toHaveLength(1);
    const combined = editor(root).state.doc.toString();
    expect(combined.startsWith(firstText)).toBe(true);
    expect(combined.match(/Captured content/gu)).toHaveLength(2);
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn(() => "blob:recovery");
        static override revokeObjectURL = revoke;
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    button(root, "Export unsaved draft").click();
    expect(revoke).toHaveBeenCalledWith("blob:recovery");
    expect(editor(root).state.doc.toString()).toBe(combined);
    expect(button(root, "Export unsaved draft")).not.toBeNull();
  });
});
