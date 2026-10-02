import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import {
  LibraryStore,
  type BrowserDomain,
  type BrowserGlobal,
  type BrowserLibrary,
  type BrowserNote,
} from "../src/browser/library";

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: (listener: (...args: T) => unknown) => listeners.add(listener),
    removeListener: (listener: (...args: T) => unknown) =>
      listeners.delete(listener),
    emit: (...args: T) => {
      for (const listener of listeners) listener(...args);
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const first: ActivePage = {
  tabId: 7,
  windowId: 2,
  title: "First page",
  url: "https://example.com/a",
};
const second: ActivePage = {
  ...first,
  tabId: 8,
  title: "Sibling page",
  url: "https://example.com/b",
};
const properties = (
  username = "shared-user",
  password = "synthetic-shared-password",
) =>
  "```aic\n# Properties\nUsername | " +
  username +
  "\nPassword *| " +
  password +
  "\n```\n\n";
const note = (page: ActivePage, markdown = "Page-only body"): BrowserNote => ({
  id: `page:${page.url}`,
  url: page.url,
  title: page.title,
  markdown,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});
const domain = (
  origin = "https://example.com",
  markdown = properties(),
): BrowserDomain => ({
  id: `domain:${origin}`,
  origin,
  markdown,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});

function fixture(
  options: {
    domains?: BrowserDomain[];
    notes?: BrowserNote[];
    global?: BrowserGlobal;
    noPage?: boolean;
    fileSource?: boolean;
  } = {},
) {
  let page = first;
  let state = "ready";
  let library: BrowserLibrary = {
    version: 3,
    global: options.global ?? null,
    domains: options.domains ?? [],
    notes: options.notes ?? [],
    history: [],
  };
  const store = new LibraryStore({
    read: async () => structuredClone(library),
    write: async (next) => {
      library = structuredClone(next);
    },
  });
  const changed = event<[Record<string, unknown>, string]>();
  const activated = event<[{ tabId: number; windowId: number }]>();
  const messages: Request[] = [];
  let beforeAck: (() => Promise<void>) | undefined;
  const emitStorage = () =>
    changed.emit(
      {
        "aic-browser-markdown-change": {
          newValue: { updatedAt: 1 },
        },
      },
      "local",
    );
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        try {
          let value: unknown;
          switch (message.type) {
            case "status":
              value = {
                state,
                ...(options.fileSource
                  ? {
                      source: {
                        kind: "directory",
                        id: "browser-synthetic",
                        name: "Notes",
                      },
                    }
                  : {}),
              };
              break;
            case "context":
              value = options.noPage ? null : structuredClone(page);
              break;
            case "load":
            case "visit":
              value = await store.load();
              break;
            case "checkpoint-drafts":
              value = { sequence: message.sequence };
              break;
            case "list-recovery":
              value = [];
              break;
            case "dismiss-recovery":
              value = undefined;
              break;
            case "create-global":
              value = await store.createGlobal(message.markdown);
              emitStorage();
              await beforeAck?.();
              break;
            case "save-global":
              value = await store.saveGlobal(
                message.id,
                message.markdown,
                message.revision,
              );
              emitStorage();
              await beforeAck?.();
              break;
            case "create-domain":
              value = await store.createDomain(
                new URL(message.page.url).origin,
                message.markdown,
              );
              emitStorage();
              await beforeAck?.();
              break;
            case "save-domain":
              value = await store.saveDomain(
                message.id,
                message.markdown,
                message.revision,
              );
              emitStorage();
              await beforeAck?.();
              break;
            case "create":
              value = await store.create(message.page, message.markdown, {
                ifAbsent: true,
              });
              break;
            case "save":
              value = await store.save(
                message.id,
                message.markdown,
                message.revision,
              );
              break;
            case "lock":
              state = "unavailable";
              changed.emit(
                { "aic-browser-unlock": { oldValue: {} } },
                "session",
              );
              value = { state };
              break;
            default:
              throw new Error(`Unexpected request ${message.type}`);
          }
          return { ok: true, value };
        } catch (error) {
          return {
            ok: false,
            error: (error as Error).message,
            code: (error as { code?: string }).code,
          };
        }
      },
    },
    windows: { getCurrent: async () => ({ id: 2, incognito: false }) },
    storage: { onChanged: changed },
    tabs: { onActivated: activated, onUpdated: event(), onRemoved: event() },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    store,
    emitStorage,
    beforeAck: (hook: () => Promise<void>) => {
      beforeAck = hook;
    },
    navigate: (next: ActivePage) => {
      page = next;
      activated.emit({ tabId: next.tabId, windowId: next.windowId });
    },
    remote: async (markdown: string) => {
      const original = (await store.load()).domains[0]!;
      await store.saveDomain(original.id, markdown, original.revision);
      emitStorage();
    },
    lock: () =>
      changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session"),
  };
}

const panels: BrowserPanel[] = [];
async function mount(api: BrowserApi) {
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  await panel.ready;
  return { root, panel };
}
async function activateScope(root: HTMLElement) {
  const panel = root.closest<HTMLElement>(".browser-scope-panel");
  if (!panel?.hidden) return;
  const label = panel.dataset.scope === "global" ? "Global" : "Shared";
  panel
    .closest(".browser-panel")!
    .querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${label}"]`)!
    .click();
  await vi.waitFor(() => expect(panel.hidden).toBe(false));
}
async function press(root: ParentNode, name: RegExp) {
  if (name.test("Download copy"))
    root
      .querySelector<HTMLButtonElement>('button[aria-label="More options"]')
      ?.click();
  if (root instanceof HTMLElement) await activateScope(root);
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      name.test(
        candidate.getAttribute("aria-label") || candidate.textContent || "",
      ),
  );
  expect(button, `Expected button ${name}`).toBeDefined();
  button!.click();
}
function saved(surface: HTMLElement) {
  const state =
    surface.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState;
  return state === "saved" || state === "placeholder";
}
function shared(root: HTMLElement) {
  return root.querySelector<HTMLElement>(
    '.browser-domain-properties[data-scope="domain"]',
  )!;
}
function view(root: ParentNode, selector = ".cm-editor") {
  const element = root.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  return EditorView.findFromDOM(element!)!;
}
function pageView(root: HTMLElement) {
  return view(root, ".browser-note .cm-editor");
}
function replace(editor: EditorView, text: string) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
  });
}
function clipboard(text = "Imported page content") {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator) as Navigator, {
      clipboard: { writeText, readText: vi.fn(async () => text) },
    }),
  );
  return writeText;
}

afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("profile-global shared properties in the browser panel", () => {
  const global = (markdown = properties("global-user")): BrowserGlobal => ({
    id: "global-fixture",
    scope: "global",
    markdown,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  });
  const globalView = (root: HTMLElement) =>
    root.querySelector<HTMLElement>(
      '.browser-domain-properties[data-scope="global"]',
    )!;

  it.each(["domain", "global"] as const)(
    "keeps the file status unsaved until the %s edit receives its disk acknowledgment",
    async (scope) => {
      const fake = fixture({
        fileSource: true,
        domains: [domain()],
        global: global(),
      });
      const gate = deferred();
      fake.beforeAck(() => gate.promise);
      const { root } = await mount(fake.api);
      const status = () =>
        root.querySelector<HTMLElement>(
          ".browser-file-location .aic-context__status",
        )!;
      expect(status().textContent).toBe("On disk");
      const surface = scope === "domain" ? shared(root) : globalView(root);
      await activateScope(surface);
      replace(view(surface), properties("pending-disk-ack"));
      expect(status().textContent).toBe("Unsaved");
      expect(status().dataset.state).toBe("dirty");
      await press(surface, /^Save note$|^Retry save$/u);
      await vi.waitFor(() =>
        expect(
          fake.messages.some((message) => message.type === `save-${scope}`),
        ).toBe(true),
      );
      expect(status().textContent).toBe("Unsaved");
      gate.resolve();
      await vi.waitFor(() => expect(status().textContent).toBe("On disk"));
      expect(status().dataset.state).toBe("saved");
      const persisted = await fake.store.load();
      expect(
        scope === "domain"
          ? persisted.domains[0]!.markdown
          : persisted.global!.markdown,
      ).toBe(properties("pending-disk-ack"));
    },
  );

  it("keeps Global and Shared in exclusive panels and never persists an untouched placeholder", async () => {
    const fake = fixture();
    const { root } = await mount(fake.api);
    const toolbar = root.querySelector(".browser-note .aic-toolbar")!;
    expect(
      [
        ...toolbar.querySelectorAll<HTMLElement>(".browser-domain-properties"),
      ].map((item) => item.dataset.scope),
    ).toEqual([]);
    expect(
      [...root.querySelectorAll("[role=tab]")].map((tab) => tab.textContent),
    ).toEqual(["Current", "Shared", "Global"]);
    expect(
      root.querySelector<HTMLElement>(
        '.browser-scope-panel[data-scope="current"]',
      )!.hidden,
    ).toBe(false);
    expect(globalView(root).getAttribute("aria-label")).toBe("Global notes");
    await activateScope(globalView(root));
    for (const action of [
      "Import current content",
      "Import Markdown file",
      "Export Markdown file",
    ])
      expect(
        root.querySelector(`.browser-toolbar [aria-label="${action}"]`),
      ).toBeNull();
    expect(view(globalView(root)).state.doc.toString()).toBe("");
    await press(globalView(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(globalView(root))).toBe(true));
    expect((await fake.store.load()).global).toBeNull();
    expect(
      fake.messages.some((message) => message.type === "create-global"),
    ).toBe(false);
  });

  it("shares acknowledged one-time state across panels and rejects detached Global controls", async () => {
    const writeText = clipboard();
    const before = "```aic\nCodes 1| global-synthetic-code | visible\n```\n";
    const fake = fixture({
      global: global(before),
      domains: [domain()],
      notes: [note(first)],
    });
    const a = await mount(fake.api);
    const b = await mount(fake.api);
    await press(a.root, /^Global$/u);
    await vi.waitFor(() =>
      expect(
        globalView(a.root).closest<HTMLElement>(".browser-scope-panel")!.hidden,
      ).toBe(false),
    );
    const button = globalView(a.root).querySelector<HTMLButtonElement>(
      '[aria-label="Copy Codes one-time 1 and mark it used"]',
    )!;
    expect(button).not.toBeNull();
    button.click();
    await vi.waitFor(async () =>
      expect((await fake.store.load()).global?.markdown).toContain(
        "Codes 0| global-synthetic-code",
      ),
    );
    await vi.waitFor(() =>
      expect(
        globalView(b.root).querySelector(
          '[aria-label="Reactivate Codes used 1 without copying"]',
        ),
      ).not.toBeNull(),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith("global-synthetic-code");
    expect(globalView(b.root).innerHTML).not.toContain("global-synthetic-code");
    button.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    await press(
      globalView(b.root),
      /^Reactivate Codes used 1 without copying$/u,
    );
    await vi.waitFor(async () =>
      expect((await fake.store.load()).global?.revision).toBe(3),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((await fake.store.load()).domains).toEqual([domain()]);
    expect((await fake.store.load()).notes).toEqual([note(first)]);
    expect(saved(globalView(a.root))).toBe(true);
  });

  it("shows one masked global record across unrelated origins and leaves page/domain records intact", async () => {
    const fake = fixture({
      global: global(),
      domains: [domain()],
      notes: [note(first)],
    });
    const { root } = await mount(fake.api);
    expect(globalView(root).textContent).toContain("global-user");
    expect(globalView(root).innerHTML).not.toContain(
      "synthetic-shared-password",
    );
    const before = await fake.store.load();
    fake.navigate({ ...second, url: "https://unrelated.test/elsewhere" });
    await vi.waitFor(() =>
      expect(globalView(root)?.textContent).toContain("global-user"),
    );
    expect(view(shared(root)).state.doc.toString()).toBe("");
    expect((await fake.store.load()).global).toEqual(before.global);
    expect((await fake.store.load()).notes).toEqual(before.notes);
    expect((await fake.store.load()).domains).toEqual(before.domains);
  });

  it("creates and saves Global with no active web page and refreshes a second panel", async () => {
    const fake = fixture({ noPage: true });
    const a = await mount(fake.api);
    const b = await mount(fake.api);
    expect(shared(a.root)).toBeNull();
    await activateScope(globalView(a.root));
    replace(view(globalView(a.root)), properties("global-no-page"));
    await press(globalView(a.root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(globalView(a.root))).toBe(true));
    await vi.waitFor(() =>
      expect(globalView(b.root).textContent).toContain("global-no-page"),
    );
    expect(globalView(b.root).innerHTML).not.toContain(
      "synthetic-shared-password",
    );
    expect((await fake.store.load()).global?.revision).toBe(1);
    expect((await fake.store.load()).notes).toEqual([]);
    expect(
      fake.messages.filter((message) => message.type === "create-global"),
    ).toHaveLength(1);
    a.panel.destroy();
    b.panel.destroy();
  });

  it("keeps Global dirty source during a remote conflict and clears the editor on disposal", async () => {
    const fake = fixture({ global: global() });
    const { root, panel } = await mount(fake.api);
    await activateScope(globalView(root));
    const editor = view(globalView(root));
    replace(editor, properties("local-global"));
    await fake.store.saveGlobal(
      "global-fixture",
      properties("remote-global"),
      1,
    );
    fake.emitStorage();
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Another window"),
    );
    expect(editor.state.doc.toString()).toBe(properties("local-global"));
    expect((await fake.store.load()).global?.markdown).toBe(
      properties("remote-global"),
    );
    panel.destroy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(root.innerHTML).not.toContain("local-global");
    expect(root.querySelector(".cm-editor")).toBeNull();
  });
});

describe("shared domain Properties in the browser panel", () => {
  it("persists one-time preview actions and refreshes another panel without changing the page", async () => {
    const writeText = clipboard();
    const before = "```aic\nCodes 1| fixture-code | visible-note\n```\n";
    const fake = fixture({
      domains: [domain("https://example.com", before)],
      notes: [note(first)],
    });
    const a = await mount(fake.api);
    const b = await mount(fake.api);
    await press(shared(a.root), /^Copy Codes one-time 1 and mark it used$/u);
    await vi.waitFor(async () =>
      expect((await fake.store.load()).domains[0]!.markdown).toContain(
        "Codes 0| fixture-code",
      ),
    );
    await vi.waitFor(() =>
      expect(
        shared(b.root).querySelector(
          '[aria-label="Reactivate Codes used 1 without copying"]',
        ),
      ).not.toBeNull(),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith("fixture-code");
    expect(saved(shared(a.root))).toBe(true);
    expect(shared(a.root).innerHTML).not.toContain("fixture-code");
    expect(pageView(a.root).state.doc.toString()).toBe("Page-only body");
    expect(pageView(b.root).state.doc.toString()).toBe("Page-only body");
    await press(shared(b.root), /^Reactivate Codes used 1 without copying$/u);
    await vi.waitFor(async () =>
      expect((await fake.store.load()).domains[0]!.markdown).toContain(
        "Codes 1| fixture-code",
      ),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(
        shared(a.root).querySelector(
          '[aria-label="Copy Codes one-time 1 and mark it used"]',
        ),
      ).not.toBeNull(),
    );
    await press(shared(a.root), /^Copy Codes one-time 1 and mark it used$/u);
    await vi.waitFor(async () =>
      expect((await fake.store.load()).domains[0]!.markdown).toContain(
        "Codes 0| fixture-code",
      ),
    );
    expect(writeText).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(
        shared(a.root).querySelector('[aria-label="Delete Codes used 1"]'),
      ).not.toBeNull(),
    );
    await press(shared(a.root), /^Delete Codes used 1$/u);
    await vi.waitFor(async () =>
      expect((await fake.store.load()).domains[0]!.markdown).toContain(
        "Codes | visible-note",
      ),
    );
    expect((await fake.store.load()).notes[0]!.markdown).toBe("Page-only body");
  });

  it("renders masked copyable Properties for the exact origin only", async () => {
    const writeText = clipboard();
    const fake = fixture({
      domains: [
        domain(),
        domain("http://example.com", properties("http-user")),
        domain("https://example.com:8443", properties("port-user")),
        domain("https://sub.example.com", properties("sub-user")),
      ],
    });
    const { root } = await mount(fake.api);
    await press(root, /^Shared$/u);
    await vi.waitFor(() =>
      expect(
        shared(root).closest<HTMLElement>(".browser-scope-panel")!.hidden,
      ).toBe(false),
    );
    const card = shared(root);
    expect(card.textContent).toContain("shared-user");
    expect(card.textContent).not.toContain("synthetic-shared-password");
    expect(card.textContent).not.toContain("http-user");
    expect(card.textContent).not.toContain("port-user");
    expect(card.textContent).not.toContain("sub-user");
    expect(view(card).state.readOnly).toBe(false);
    expect(
      card.querySelector('[aria-label="Edit shared properties"]'),
    ).toBeNull();
    const copy = card.querySelector<HTMLElement>(
      '[aria-label="Copy Password value"]',
    );
    expect(copy).not.toBeNull();
    copy!.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("synthetic-shared-password"),
    );
    expect((await fake.store.load()).notes).toEqual([]);
  });

  it("keeps page copy, Markdown export and imported content free of inherited source", async () => {
    clipboard();
    const fake = fixture({ domains: [domain()], notes: [note(first)] });
    const { root } = await mount(fake.api);
    const initialPage = pageView(root);
    const blobs: Blob[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL(blob: Blob) {
          blobs.push(blob);
          return "blob:synthetic";
        }
        static override revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    initialPage.dispatch({
      selection: { anchor: 0, head: initialPage.state.doc.length },
    });
    expect(
      initialPage.state.sliceDoc(
        initialPage.state.selection.main.from,
        initialPage.state.selection.main.to,
      ),
    ).toBe("Page-only body");
    await press(root, /^Download copy$/u);
    const exportText = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blobs[0]!);
    });
    expect(exportText).toBe("Page-only body");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain" ? "Imported page content" : "",
        files: [],
      },
    });
    initialPage.contentDOM.dispatchEvent(paste);
    await vi.waitFor(() =>
      expect(initialPage.state.doc.toString()).toContain(
        "Imported page content",
      ),
    );
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "save")).toBe(
        true,
      ),
    );
    expect(pageView(root)).toBe(initialPage);
    expect(initialPage.state.doc.toString()).not.toContain("shared-user");
    expect((await fake.store.load()).domains).toEqual([domain()]);
  });

  it("creates one shared record only after editing and inherits it on a sibling page", async () => {
    const fake = fixture();
    const { root } = await mount(fake.api);
    await activateScope(shared(root));
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(shared(root))).toBe(true));
    expect(
      fake.messages.some(
        (message) =>
          message.type === "create-domain" || message.type === "create",
      ),
    ).toBe(false);
    await activateScope(shared(root));
    replace(view(shared(root)), properties("entered-once"));
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(shared(root))).toBe(true));
    fake.navigate(second);
    await vi.waitFor(() =>
      expect(shared(root).textContent).toContain("entered-once"),
    );
    const library = await fake.store.load();
    expect(library.domains).toHaveLength(1);
    expect(library.notes).toEqual([]);
    expect(
      fake.messages.filter((message) => message.type === "create-domain"),
    ).toHaveLength(1);
    expect(pageView(root).state.doc.toString()).not.toContain("entered-once");
  });

  it("refreshes a second panel after a shared save while preserving its page editor and selection", async () => {
    const fake = fixture({ domains: [domain()], notes: [note(first)] });
    const a = await mount(fake.api);
    const b = await mount(fake.api);
    const page = pageView(b.root);
    page.dispatch({ selection: { anchor: 4 } });
    await activateScope(shared(a.root));
    replace(view(shared(a.root)), properties("updated-user"));
    await press(shared(a.root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() =>
      expect(shared(b.root).textContent).toContain("updated-user"),
    );
    expect(pageView(b.root)).toBe(page);
    expect(page.state.selection.main.anchor).toBe(4);
    expect(page.state.doc.toString()).toBe("Page-only body");
  });

  it("retains a dirty domain draft on remote revision conflict without overwriting either version", async () => {
    const fake = fixture({ domains: [domain()] });
    const { root } = await mount(fake.api);
    await activateScope(shared(root));
    const editor = view(shared(root));
    replace(editor, properties("local-draft"));
    await fake.remote(properties("remote-winner"));
    await vi.waitFor(() =>
      expect(root.textContent).toMatch(/changed|conflict|another window/iu),
    );
    expect(editor.state.doc.toString()).toContain("local-draft");
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() =>
      expect(
        shared(root).querySelector<HTMLElement>(".aic-editor")!.dataset
          .saveFeedback,
      ).toBe("failed"),
    );
    expect((await fake.store.load()).domains[0]!.markdown).toContain(
      "remote-winner",
    );
    expect(shared(root).dataset.editing).toBe("true");
  });

  it("updates an untouched shared editor on remote save without writing its old source back", async () => {
    const fake = fixture({ domains: [domain()] });
    const { root } = await mount(fake.api);
    await activateScope(shared(root));
    const editor = view(shared(root));
    await fake.remote(properties("remote-current"));
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe(properties("remote-current")),
    );
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(shared(root))).toBe(true));
    expect(
      fake.messages.filter((message) => message.type === "save-domain"),
    ).toHaveLength(0);
    expect((await fake.store.load()).domains[0]!.markdown).toBe(
      properties("remote-current"),
    );
  });

  it("accepts remote source after an open editor's autosave acknowledgment without writing stale text", async () => {
    const fake = fixture({ domains: [domain()], notes: [note(first)] });
    const { root } = await mount(fake.api);
    const page = pageView(root);
    page.dispatch({ selection: { anchor: 4 } });
    await activateScope(shared(root));
    const editor = view(shared(root));
    replace(editor, properties("autosaved-user"));
    editor.dispatch({ selection: { anchor: 2 } });
    // Leave the editor open: only the coordinator's autosave acknowledges this edit.
    await vi.waitFor(async () => {
      expect((await fake.store.load()).domains[0]!.revision).toBe(2);
      expect(
        shared(root).querySelector<HTMLButtonElement>(".aic-save-button")!
          .disabled,
      ).toBe(false);
    });
    expect(shared(root).dataset.editing).toBe("true");
    expect(editor.state.selection.main.anchor).toBe(2);
    await fake.remote(properties("remote-after-autosave"));
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe(
        properties("remote-after-autosave"),
      ),
    );
    expect(view(shared(root))).toBe(editor);
    expect(editor.state.selection.main.anchor).toBe(2);
    expect(pageView(root)).toBe(page);
    expect(page.state.selection.main.anchor).toBe(4);
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() => expect(saved(shared(root))).toBe(true));
    expect(
      fake.messages.filter((message) => message.type === "save-domain"),
    ).toHaveLength(1);
    expect((await fake.store.load()).domains[0]).toMatchObject({
      markdown: properties("remote-after-autosave"),
      revision: 3,
    });
    expect(shared(root).textContent).toContain("remote-after-autosave");
  });

  it("does not mistake its own storage event before acknowledgment for a remote conflict", async () => {
    const fake = fixture({ domains: [domain()] });
    const gate = deferred();
    fake.beforeAck(() => gate.promise);
    const { root } = await mount(fake.api);
    await activateScope(shared(root));
    replace(view(shared(root)), properties("own-write"));
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "load")).toBe(
        true,
      ),
    );
    expect(root.textContent).not.toMatch(
      /changed elsewhere|another window|conflict/iu,
    );
    gate.resolve();
    await vi.waitFor(() => expect(saved(shared(root))).toBe(true));
    expect(shared(root).textContent).toContain("own-write");
    expect(root.textContent).not.toMatch(/not saved|another window/iu);
    expect((await fake.store.load()).domains[0]!.revision).toBe(2);
  });

  it("saves the latest edit when more source is typed while an earlier save awaits acknowledgment", async () => {
    const fake = fixture({ domains: [domain()] });
    const gate = deferred();
    fake.beforeAck(() => gate.promise);
    const { root } = await mount(fake.api);
    await activateScope(shared(root));
    const editor = view(shared(root));
    replace(editor, properties("first-change"));
    await press(shared(root), /^Save note$|^Retry save$/u);
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "load")).toBe(
        true,
      ),
    );
    replace(editor, properties("latest-change"));
    gate.resolve();
    await vi.waitFor(async () => {
      expect((await fake.store.load()).domains[0]!.markdown).toBe(
        properties("latest-change"),
      );
      expect(
        shared(root).querySelector<HTMLButtonElement>(".aic-save-button")!
          .disabled,
      ).toBe(false);
    });
    if (shared(root).dataset.editing === "true") {
      // The same editor keeps the newest acknowledged source.
      expect(view(shared(root)).state.doc.toString()).toBe(
        properties("latest-change"),
      );
    } else {
      expect(shared(root).textContent).toContain("latest-change");
      expect(shared(root).textContent).not.toContain("first-change");
    }
  });

  it("saves ordinary Markdown across sibling pages without copying it into Current notes", async () => {
    const fake = fixture({ domains: [domain()] });
    const { root } = await mount(fake.api);
    const sibling = await mount(fake.api);
    const markdown =
      "# Shared work\n\nOrdinary Markdown with an unfinished *format\n";
    await activateScope(shared(root));
    replace(view(shared(root)), markdown);
    await press(shared(root), /^Save note$/u);
    await vi.waitFor(async () =>
      expect((await fake.store.load()).domains[0]!.markdown).toBe(markdown),
    );
    await vi.waitFor(() =>
      expect(view(shared(sibling.root)).state.doc.toString()).toBe(markdown),
    );
    expect(pageView(sibling.root).state.doc.toString()).not.toContain(
      "Shared work",
    );
    fake.navigate({ ...second, url: "https://other.example.com/" });
    await vi.waitFor(() =>
      expect(view(shared(root)).state.doc.toString()).toBe(""),
    );
    expect(pageView(root).state.doc.toString()).not.toContain("Shared work");
    fake.navigate(first);
    await vi.waitFor(() =>
      expect(view(shared(root)).state.doc.toString()).toBe(markdown),
    );
    expect(pageView(root).state.doc.toString()).not.toContain("Shared work");
  });
});
