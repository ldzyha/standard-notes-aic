import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import {
  LibraryStore,
  type BrowserDomain,
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
  `---\n# aic-fields: v2\nUsername: ${username}\nPassword*: ${password}\n---\n\n`;
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
  options: { domains?: BrowserDomain[]; notes?: BrowserNote[] } = {},
) {
  let page = first;
  let state = "unlocked";
  let library: BrowserLibrary = {
    version: 2,
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
        "aic-browser-library": {
          newValue: { ciphertext: "synthetic-envelope" },
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
              value = { state };
              break;
            case "context":
              value = structuredClone(page);
              break;
            case "load":
            case "visit":
              value = await store.load();
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
              state = "locked";
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
function press(root: ParentNode, name: RegExp) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      name.test(
        candidate.getAttribute("aria-label") || candidate.textContent || "",
      ),
  );
  expect(button, `Expected button ${name}`).toBeDefined();
  button!.click();
}
function shared(root: HTMLElement) {
  return root.querySelector<HTMLElement>(".browser-domain-properties")!;
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

describe("shared domain Properties in the browser panel", () => {
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
    const card = shared(root);
    expect(card.textContent).toContain("shared-user");
    expect(card.textContent).not.toContain("synthetic-shared-password");
    expect(card.textContent).not.toContain("http-user");
    expect(card.textContent).not.toContain("port-user");
    expect(card.textContent).not.toContain("sub-user");
    expect(view(card).state.readOnly).toBe(true);
    expect(card.querySelector('[aria-label="Edit properties"]')).toBeNull();
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
    const writeText = clipboard();
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
    press(root, /^More options$/u);
    press(root, /^Copy note$/u);
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Page-only body"),
    );
    press(root, /^More options$/u);
    press(root, /^Export Markdown$/u);
    const exportText = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blobs[0]!);
    });
    expect(exportText).toBe("Page-only body");
    press(root, /^Add content$/u);
    press(root, /^Paste from clipboard$/u);
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
    press(shared(root), /^Edit shared properties$/u);
    press(shared(root), /^Done$/u);
    await vi.waitFor(() => expect(shared(root).dataset.editing).toBe("false"));
    expect(
      fake.messages.some(
        (message) =>
          message.type === "create-domain" || message.type === "create",
      ),
    ).toBe(false);
    press(shared(root), /^Edit shared properties$/u);
    replace(view(shared(root)), properties("entered-once"));
    press(shared(root), /^Done$/u);
    await vi.waitFor(() => expect(shared(root).dataset.editing).toBe("false"));
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
    press(shared(a.root), /^Edit shared properties$/u);
    replace(view(shared(a.root)), properties("updated-user"));
    press(shared(a.root), /^Done$/u);
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
    press(shared(root), /^Edit shared properties$/u);
    const editor = view(shared(root));
    replace(editor, properties("local-draft"));
    await fake.remote(properties("remote-winner"));
    await vi.waitFor(() =>
      expect(root.textContent).toMatch(/changed|conflict|another window/iu),
    );
    expect(editor.state.doc.toString()).toContain("local-draft");
    press(shared(root), /^Done$/u);
    await vi.waitFor(() => expect(root.textContent).toContain("not saved"));
    expect((await fake.store.load()).domains[0]!.markdown).toContain(
      "remote-winner",
    );
    expect(shared(root).dataset.editing).toBe("true");
  });

  it("updates an untouched shared editor on remote save without writing its old source back", async () => {
    const fake = fixture({ domains: [domain()] });
    const { root } = await mount(fake.api);
    press(shared(root), /^Edit shared properties$/u);
    const editor = view(shared(root));
    await fake.remote(properties("remote-current"));
    await vi.waitFor(() =>
      expect(editor.state.doc.toString()).toBe(properties("remote-current")),
    );
    press(shared(root), /^Done$/u);
    await vi.waitFor(() => expect(shared(root).dataset.editing).toBe("false"));
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
    press(shared(root), /^Edit shared properties$/u);
    const editor = view(shared(root));
    replace(editor, properties("autosaved-user"));
    editor.dispatch({ selection: { anchor: 2 } });
    // Leave the editor open: only the coordinator's autosave acknowledges this edit.
    await vi.waitFor(async () => {
      expect((await fake.store.load()).domains[0]!.revision).toBe(2);
      expect(
        shared(root).querySelector<HTMLButtonElement>(
          ".browser-domain-properties-action",
        )!.disabled,
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
    press(shared(root), /^Done$/u);
    await vi.waitFor(() => expect(shared(root).dataset.editing).toBe("false"));
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
    press(shared(root), /^Edit shared properties$/u);
    replace(view(shared(root)), properties("own-write"));
    press(shared(root), /^Done$/u);
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "load")).toBe(
        true,
      ),
    );
    expect(root.textContent).not.toMatch(
      /changed elsewhere|another window|conflict/iu,
    );
    gate.resolve();
    await vi.waitFor(() => expect(shared(root).dataset.editing).toBe("false"));
    expect(shared(root).textContent).toContain("own-write");
    expect(root.textContent).not.toMatch(/not saved|another window/iu);
    expect((await fake.store.load()).domains[0]!.revision).toBe(2);
  });

  it("disposes both panels' shared previews and editors on vault lock", async () => {
    const fake = fixture({ domains: [domain()] });
    const a = await mount(fake.api);
    const b = await mount(fake.api);
    press(shared(b.root), /^Edit shared properties$/u);
    const preview = view(shared(a.root));
    const editor = view(shared(b.root));
    const previewDestroy = vi.spyOn(preview, "destroy");
    const editorDestroy = vi.spyOn(editor, "destroy");
    fake.lock();
    expect(previewDestroy).toHaveBeenCalledOnce();
    expect(editorDestroy).toHaveBeenCalledOnce();
    for (const { root } of [a, b]) {
      expect(root.querySelector(".browser-domain-properties")).toBeNull();
      expect(root.querySelector(".cm-editor")).toBeNull();
      expect(root.textContent).not.toContain("shared-user");
    }
  });

  it("shows the latest edit when more source is typed while Done awaits save acknowledgment", async () => {
    const fake = fixture({ domains: [domain()] });
    const gate = deferred();
    fake.beforeAck(() => gate.promise);
    const { root } = await mount(fake.api);
    press(shared(root), /^Edit shared properties$/u);
    const editor = view(shared(root));
    replace(editor, properties("first-change"));
    press(shared(root), /^Done$/u);
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
        shared(root).querySelector<HTMLButtonElement>(
          ".browser-domain-properties-action",
        )!.disabled,
      ).toBe(false);
    });
    if (shared(root).dataset.editing === "true") {
      // Keeping newer text open is safe when Done began with an older snapshot.
      expect(view(shared(root)).state.doc.toString()).toBe(
        properties("latest-change"),
      );
    } else {
      expect(shared(root).textContent).toContain("latest-change");
      expect(shared(root).textContent).not.toContain("first-change");
    }
  });

  it("keeps invalid source recoverable across site navigation without sharing it as child plaintext", async () => {
    const fake = fixture({ domains: [domain()] });
    const { root } = await mount(fake.api);
    const sibling = await mount(fake.api);
    const invalid = "---\nPassword*: [synthetic-unfinished-secret\n---\n";
    press(shared(root), /^Edit shared properties$/u);
    replace(view(shared(root)), invalid);
    press(shared(root), /^Done$/u);
    await vi.waitFor(() =>
      expect(shared(root).textContent).toContain(
        "Finish a valid Properties block",
      ),
    );
    expect((await fake.store.load()).domains[0]!.markdown).toBe(properties());
    expect(shared(sibling.root).dataset.editing).toBe("false");
    expect(shared(sibling.root).textContent).not.toContain(
      "synthetic-unfinished-secret",
    );
    expect(view(shared(sibling.root)).state.doc.toString()).toBe(properties());
    fake.navigate({ ...second, url: "https://other.example.com/" });
    await vi.waitFor(() =>
      expect(shared(root).textContent).toContain("https://other.example.com"),
    );
    expect(root.textContent).not.toContain("synthetic-unfinished-secret");
    fake.navigate(first);
    await vi.waitFor(() =>
      expect(shared(root).textContent).toContain("https://example.com"),
    );
    expect(shared(root).dataset.editing).toBe("true");
    expect(view(shared(root)).state.doc.toString()).toBe(invalid);
    expect(pageView(root).state.doc.toString()).not.toContain(
      "synthetic-unfinished-secret",
    );
  });
});
