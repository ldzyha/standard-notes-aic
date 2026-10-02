import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import { chooseBrowserSource } from "../src/browser/markdown-storage";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";
import type { RecoverySnapshot } from "../src/browser/recovery-store";

vi.mock("../src/browser/markdown-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/browser/markdown-storage")>()),
  chooseBrowserSource: vi.fn(async () => "browser-panel-test"),
}));

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
    state?: "unselected" | "unavailable" | "ready";
    private?: boolean;
    fileSource?: boolean;
    warnings?: string[];
    notes?: BrowserNote[];
  } = {},
) {
  let state = options.state ?? "ready";
  let page: ActivePage | null = {
    tabId: 7,
    windowId: 2,
    title: "Active page",
    url: "https://example.com/a",
  };
  const library: BrowserLibrary = {
    version: 3,
    global: null,
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
  const recoveries = new Map<string, RecoverySnapshot>();
  const status = () => ({
    state,
    warnings: options.warnings ?? [],
    ...(options.fileSource
      ? {
          source: {
            kind: "directory",
            id: "browser-panel-test",
            name: "notes.md",
          },
        }
      : {}),
  });
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        const custom = override?.(message);
        if (custom) return { ok: true, value: await custom };
        let value: unknown;
        switch (message.type) {
          case "status":
            value = status();
            break;
          case "scan-status":
            value = { scan: null, notes: [], next: 0 };
            break;
          case "refresh-files":
            value = status();
            break;
          case "connect-source":
            state = "ready";
            value = status();
            break;
          case "lock":
            state = "unavailable";
            changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
            value = status();
            break;
          case "checkpoint-drafts":
            if (message.entries.length)
              recoveries.set(message.clientId, {
                clientId: message.clientId,
                sequence: message.sequence,
                sourceId: message.sourceId!,
                entries: structuredClone(message.entries),
                updatedAt: 1,
              });
            else recoveries.delete(message.clientId);
            value = { sequence: message.sequence };
            break;
          case "list-recovery":
            value = structuredClone([...recoveries.values()]);
            break;
          case "dismiss-recovery":
            recoveries.delete(message.clientId);
            value = null;
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
          case "create-file": {
            const created = {
              ...note("", message.markdown),
              id: `file-${library.notes.length}`,
              filePath: message.path,
              title: message.path,
            };
            library.notes.push(created);
            value = structuredClone(created);
            break;
          }
          case "link-file": {
            const existing = library.notes.find(
              (item) => item.id === message.id,
            )!;
            existing.url = message.page.url;
            value = structuredClone(existing);
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
    recoveries,
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
  if (
    [
      "Pin note",
      "Unpin note",
      "Import current content",
      "Insert from Markdown file",
      "Download copy",
      "AIC guide",
      "Open file",
      "Open folder",
      "Open file…",
      "Open folder…",
      "New file",
      "Follow active tab",
      "Link file to current page",
      "Refresh folder",
    ].includes(label) &&
    !root.querySelector(`button[aria-label="${label}"]`)
  )
    root
      .querySelector<HTMLButtonElement>('button[aria-label="More options"]')!
      .click();
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
  it("opens files and folders without any credentials or encrypted actions", async () => {
    const fake = fixture({ state: "unselected" });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.textContent).toContain("Open your notes");
    const gate = root.querySelector(".browser-files-gate")!;
    expect(
      [...gate.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Open folder", "Open file"]);
    expect(gate.querySelector('[aria-label="New file"]')).toBeNull();
    expect(root.querySelector('input[type="password"]')).toBeNull();
    button(root, "More options").click();
    expect(button(root, "New file")).not.toBeNull();
    expect(root.textContent).not.toMatch(/encrypt|unlock|passphrase|backup/iu);
    expect(button(root, "Lock")).toBeNull();
    expect(
      fake.messages.some((message) =>
        ["setup", "unlock", "lock"].includes(message.type),
      ),
    ).toBe(false);
  });

  it("keeps available notes editable while showing skipped-file notices", async () => {
    const fake = fixture({
      fileSource: true,
      warnings: [
        "Skipped archive/large.md: the file exceeds the note size limit.",
      ],
      notes: [note("https://example.com/a", "Available note")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(editor(root).state.doc.toString()).toBe("Available note");
    expect(root.querySelector(".aic-context__status")?.textContent).toBe(
      "On disk",
    );
    expect(button(root, "Folder notices").textContent).toBe("1 notice");
    button(root, "Folder notices").click();
    expect(root.querySelector(".browser-overlay")?.textContent).toContain(
      "Skipped archive/large.md",
    );
    expect(root.querySelector('input[type="password"]')).toBeNull();
  });

  it("cancels a new-file picker without selecting or creating anything", async () => {
    vi.mocked(chooseBrowserSource).mockResolvedValueOnce(null);
    const fake = fixture({ state: "unselected" });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "New file").click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
        false,
      ),
    );
    expect(
      fake.messages.some((message) => message.type === "connect-source"),
    ).toBe(false);
    expect(root.dataset.state).toBe("unselected");
  });

  it("opens a plain file directly and keeps it selected across active-tab changes", async () => {
    const file = {
      ...note("", "# Plain file"),
      id: "plain-file",
      filePath: "project/readme.md",
      title: "readme.md",
    };
    const fake = fixture({ notes: [file] });
    fake.override((message) =>
      message.type === "status"
        ? Promise.resolve({
            state: "ready",
            source: { kind: "file", id: "browser-plain", name: "readme.md" },
          })
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(editor(root).state.doc.toString()).toBe("# Plain file");
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector('input[type="password"]')).toBeNull();
    fake.setPage({
      tabId: 8,
      windowId: 2,
      title: "Other",
      url: "https://other.example",
    });
    fake.activated.emit({ tabId: 8, windowId: 2 });
    await Promise.resolve();
    expect(editor(root).state.doc.toString()).toBe("# Plain file");
    editor(root).dispatch({ changes: { from: 12, insert: " edit" } });
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    await vi.waitFor(() =>
      expect(fake.library.notes[0]!.markdown).toBe("# Plain file edit"),
    );
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );
  });

  it("renders a connected folder tree and opens a file without navigating the browser", async () => {
    const file = {
      ...note("", "# File"),
      id: "standalone",
      filePath: "project/research/note.md",
      title: "note.md",
    };
    const fake = fixture({ fileSource: true, notes: [file] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "Notes").click();
    const open = button(root, "note.md");
    expect(
      open.closest("details")?.querySelector("summary")?.textContent,
    ).toContain("research");
    open.click();
    await vi.waitFor(() =>
      expect(editor(root).state.doc.toString()).toBe("# File"),
    );
    expect(fake.messages.some((message) => message.type === "navigate")).toBe(
      false,
    );
    button(root, "Link file to current page").click();
    await vi.waitFor(() =>
      expect(fake.library.notes[0]!.url).toBe("https://example.com/a"),
    );
    expect(fake.library.notes[0]!.markdown).toBe("# File");
  });

  it("creates a blank Markdown file in the selected folder", async () => {
    const fake = fixture({ fileSource: true });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "New file").click();
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="File name"]',
    )!;
    input.value = "projects/start.md";
    input
      .closest("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(fake.library.notes[0]?.filePath).toBe("projects/start.md"),
    );
    expect(fake.library.notes[0]!.markdown).toBe("");
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-page-title")?.textContent).toBe(
        "projects/start.md",
      ),
    );
    expect(editor(root).state.doc.toString()).toBe("");
  });

  it("renders large project trees lazily while searching all notes", async () => {
    const notes = Array.from({ length: 360 }, (_, index) => ({
      ...note("", `Document ${index}`),
      id: `file-${index}`,
      title: `note-${index}.md`,
      filePath: `project-${Math.floor(index / 30)}/note-${index}.md`,
    }));
    const fake = fixture({ fileSource: true, notes });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "Notes").click();
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(0);
    const project = root.querySelector<HTMLDetailsElement>(
      '[data-folder-path="project-0"]',
    )!;
    project.open = true;
    project.dispatchEvent(new Event("toggle"));
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(30);
    const search = root.querySelector<HTMLInputElement>(".browser-filter")!;
    search.value = "note-359.md";
    search.dispatchEvent(new Event("input"));
    expect(button(root, "note-359.md")).not.toBeNull();
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(1);
  });

  it("pages a large flat folder without discarding later file matches", async () => {
    const notes = Array.from({ length: 230 }, (_, index) => ({
      ...note("", `Document ${index}`),
      id: `file-${index}`,
      title: `note-${index}.md`,
      filePath: `note-${index}.md`,
    }));
    const { root, panel } = mount(fixture({ fileSource: true, notes }).api);
    await panel.ready;
    button(root, "Notes").click();
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(100);
    button(root, "Show more in this folder").click();
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(200);
    button(root, "Show more in this folder").click();
    expect(
      root.querySelectorAll('.browser-library button[title$=".md"]'),
    ).toHaveLength(230);
    expect(button(root, "Show more in this folder")).toBeNull();
  });

  it("retains dirty text when another panel switches the selected file", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    fake.override((message) =>
      message.type === "status"
        ? Promise.resolve({
            state: "ready",
            source: {
              kind: "file",
              id: "browser-first",
              name: "first.md",
            },
          })
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({ changes: { from: 8, insert: " unsaved" } });
    fake.changed.emit(
      {
        "aic-browser-markdown-source": {
          newValue: { id: "browser-second", name: "second.md" },
        },
      },
      "local",
    );
    fake.changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe("Original unsaved");
    expect(root.textContent).toContain("Save or export this draft");
  });

  it("switches only scope presentation while retaining Current text, selection and Undo", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({
      changes: { from: 8, insert: " edited" },
      selection: { anchor: 3 },
    });
    button(root, "Shared").click();
    await vi.waitFor(() =>
      expect(
        root.querySelector("[role=tab][aria-selected=true]")?.textContent,
      ).toBe("Shared"),
    );
    expect(
      root.querySelector(
        '.browser-toolbar [aria-label="Import current content"]',
      ),
    ).toBeNull();
    expect(
      root.querySelector<HTMLElement>(
        '.browser-scope-panel[data-scope="current"]',
      )!.inert,
    ).toBe(true);
    button(root, "Global").click();
    await vi.waitFor(() =>
      expect(
        root.querySelector("[role=tab][aria-selected=true]")?.textContent,
      ).toBe("Global"),
    );
    button(root, "Current").click();
    await vi.waitFor(() =>
      expect(
        root.querySelector("[role=tab][aria-selected=true]")?.textContent,
      ).toBe("Current"),
    );
    expect(editor(root)).toBe(view);
    expect(view.state.selection.main.anchor).toBe(3);
    expect(view.state.doc.toString()).toBe("Original edited");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Original");
  });

  it("keeps a failed Current save visible instead of activating another scope", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Original")],
    });
    fake.override((message) =>
      message.type === "save"
        ? Promise.reject(new Error("Synthetic failed save"))
        : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({ changes: { from: 8, insert: " recoverable" } });
    button(root, "Shared").click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Scope change paused"),
    );
    expect(
      root.querySelector("[role=tab][aria-selected=true]")?.textContent,
    ).toBe("Current");
    expect(
      root.querySelector<HTMLElement>(
        '.browser-scope-panel[data-scope="current"]',
      )!.hidden,
    ).toBe(false);
    expect(view.state.doc.toString()).toBe("Original recoverable");
  });

  it("pins the editor, links only pages typed about, and unpins to the active page", async () => {
    const fake = fixture({
      notes: [note("https://example.com/a", "Research")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    button(root, "Pin note").click();
    await vi.waitFor(() =>
      expect(button(root, "Unpin note")?.getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(root.querySelector(".browser-page-origin")?.textContent).toContain(
      "Pinned",
    );
    expect(root.querySelectorAll(".browser-toolbar button")).toHaveLength(2);
    const source = {
      tabId: 8,
      windowId: 2,
      title: "Source article",
      url: "https://source.example/article",
    };
    fake.setPage(source);
    fake.activated.emit({ tabId: 8, windowId: 2 });
    await vi.waitFor(() =>
      expect(fake.messages.filter((m) => m.type === "context")).toHaveLength(2),
    );
    await Promise.resolve();
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe("Research");
    view.dispatch({
      changes: { from: 8, insert: " notes" },
      selection: { anchor: 14 },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toContain(
      "- [Source article](<https://source.example/article>)",
    );
    expect(view.state.selection.main.anchor).toBe(14);
    undo(view);
    expect(view.state.doc.toString()).toBe("Research");
    view.dispatch({
      changes: { from: 8, insert: " new" },
      userEvent: "input.type",
    });
    view.dispatch({
      changes: { from: 12, insert: " notes" },
      userEvent: "input.type",
    });
    expect(
      view.state.doc.toString().match(/https:\/\/source.example\/article/gu),
    ).toHaveLength(1);
    button(root, "Save note").click();
    await vi.waitFor(() =>
      expect(fake.library.notes[0]!.markdown).toContain("## Related links"),
    );
    expect(fake.library.notes).toHaveLength(1);
    button(root, "Unpin note").click();
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-page-title")?.textContent).toBe(
        "Source article",
      ),
    );
    expect(editor(root)).not.toBe(view);
  });

  it("keeps the pin across hide/show and ignores obsolete unlock-session changes", async () => {
    const fake = fixture({ notes: [note("https://example.com/a")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "Pin note").click();
    await vi.waitFor(() => expect(button(root, "Unpin note")).not.toBeNull());
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    fake.setPage({
      tabId: 8,
      windowId: 2,
      title: "Other",
      url: "https://other.example",
    });
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(editor(root).state.doc.toString()).toBe("Private body");
    expect(button(root, "Unpin note")).not.toBeNull();
    fake.changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    expect(button(root, "Unpin note")).not.toBeNull();
    expect(root.querySelector(".cm-editor")).not.toBeNull();
  });

  it("keeps failed drafts open when unpinning cannot save", async () => {
    const fake = fixture({ notes: [note("https://example.com/a")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "Pin note").click();
    await vi.waitFor(() => expect(button(root, "Unpin note")).not.toBeNull());
    const view = editor(root);
    view.dispatch({
      changes: { from: 0, insert: "Draft " },
      userEvent: "input.type",
    });
    fake.override((message) =>
      message.type === "save"
        ? Promise.reject(new Error("Disk full"))
        : undefined,
    );
    button(root, "Unpin note").click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain(
        "Save or export your unsaved draft before changing its pin",
      ),
    );
    expect(editor(root)).toBe(view);
    expect(button(root, "Unpin note")).not.toBeNull();
  });

  it("saves a new draft before pinning and imports the active page into that note", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(button(root, "Pin note").disabled).toBe(true);
    const view = editor(root);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "Research" },
      userEvent: "input.type",
    });
    expect(button(root, "Pin note").disabled).toBe(false);
    button(root, "Pin note").click();
    await vi.waitFor(() => expect(button(root, "Unpin note")).not.toBeNull());
    expect(fake.library.notes).toHaveLength(1);
    const source = {
      tabId: 8,
      windowId: 2,
      title: "Source",
      url: "https://source.example/article",
    };
    fake.setPage(source);
    fake.activated.emit({ tabId: 8, windowId: 2 });
    await vi.waitFor(() =>
      expect(fake.messages.filter((m) => m.type === "context")).toHaveLength(2),
    );
    await Promise.resolve();
    button(root, "Import current content").click();
    await vi.waitFor(() =>
      expect(fake.library.notes[0]!.markdown).toContain("Captured content"),
    );
    expect(fake.messages).toContainEqual({
      type: "capture",
      page: source,
      mode: "auto",
      allowPrivate: false,
    });
    expect(fake.library.notes[0]!.url).toBe("https://example.com/a");
    expect(editor(root)).toBe(view);
  });

  it("preserves the caret when a related link is inserted before the edited section", async () => {
    const text = "## Related links\n\n## Conclusions\n\nText";
    const fake = fixture({ notes: [note("https://example.com/a", text)] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    button(root, "Pin note").click();
    await vi.waitFor(() => expect(button(root, "Unpin note")).not.toBeNull());
    fake.setPage({
      tabId: 8,
      windowId: 2,
      title: "Source",
      url: "https://source.example/article",
    });
    fake.activated.emit({ tabId: 8, windowId: 2 });
    await vi.waitFor(() =>
      expect(fake.messages.filter((m) => m.type === "context")).toHaveLength(2),
    );
    await Promise.resolve();
    const view = editor(root);
    view.dispatch({
      changes: { from: text.length, insert: "!" },
      selection: { anchor: text.length + 1 },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString().endsWith("Text!")).toBe(true);
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });

  it("keeps a new blank document unsaved until the first edit", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = editor(root);
    const seed = "";
    expect(initial.state.doc.toString()).toBe(seed);
    expect(root.querySelector(".cm-aic-security")).toBeNull();
    expect(
      root.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState,
    ).toBe("placeholder");
    button(root, "Notes").click();
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

  it("gates private windows before context/history access and keeps consent only in the panel", async () => {
    const fake = fixture({ private: true });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.textContent).toContain("after private browsing ends");
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
    expect(root.querySelector(".cm-aic-security")).toBeNull();
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

  it("shows file status through edit, pending disk write, and settled acknowledgement", async () => {
    const original = note("https://example.com/a", "Text");
    const fake = fixture({ notes: [original], fileSource: true });
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const statusText = () =>
      root.querySelector(".browser-file-location .aic-context__status")
        ?.textContent;
    expect(statusText()).toBe("On disk");
    editor(root).dispatch({ changes: { from: 4, insert: " edited" } });
    expect(statusText()).toBe("Unsaved");
    button(root, "Save note").click();
    await vi.waitFor(() => expect(fake.recoveries.size).toBe(1));
    expect(statusText()).toBe("Unsaved");
    pending.resolve({ ...original, markdown: "Text edited", revision: 2 });
    await vi.waitFor(() => expect(statusText()).toBe("On disk"));
    await vi.waitFor(() => expect(fake.recoveries.size).toBe(0));
  });

  it("keeps the newest recovery text when reload interrupts an older save and never replays it to disk", async () => {
    const original = note("https://example.com/a", "Original");
    const fake = fixture({ notes: [original], fileSource: true });
    const firstSave = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? firstSave.promise : undefined,
    );
    const one = mount(fake.api);
    await one.panel.ready;
    editor(one.root).dispatch({ changes: { from: 8, insert: " first" } });
    button(one.root, "Save note").click();
    editor(one.root).dispatch({ changes: { from: 14, insert: " latest" } });
    await vi.waitFor(() =>
      expect([...fake.recoveries.values()][0]?.entries[0]?.text).toBe(
        "Original first latest",
      ),
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(one.root.textContent).toBe("");
    firstSave.resolve({ ...original, markdown: "Original first", revision: 2 });
    await Promise.resolve();
    const two = mount(fake.api);
    await two.panel.ready;
    expect(two.root.textContent).toContain("1 draft recovery copy available.");
    expect(editor(two.root).state.doc.toString()).toBe("Original");
    expect(
      fake.messages.filter((message) => message.type === "save"),
    ).toHaveLength(1);
    button(two.root, "Review recovered drafts").click();
    expect(two.root.textContent).toContain(
      "Save a Markdown copy to review them",
    );
    expect(two.root.textContent).not.toContain("Original first latest");
    expect(button(two.root, "Save recovered copy: Note")).not.toBeNull();
    expect(fake.recoveries.size).toBe(1);
    button(two.root, "Dismiss this recovery copy…").click();
    expect(fake.recoveries.size).toBe(1);
    button(two.root, "Keep recovery copy").click();
    expect(fake.recoveries.size).toBe(1);
  });

  it("checkpoints an Undo back to the baseline while an older write is still pending", async () => {
    const original = note("https://example.com/a", "Original");
    const fake = fixture({ notes: [original], fileSource: true });
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({
      changes: { from: 8, insert: " changed" },
      userEvent: "input.type",
    });
    button(root, "Save note").click();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Original");
    await vi.waitFor(() =>
      expect([...fake.recoveries.values()][0]?.entries[0]?.text).toBe(
        "Original",
      ),
    );
    window.dispatchEvent(new Event("pagehide"));
    pending.resolve({ ...original, markdown: "Original changed", revision: 2 });
    await Promise.resolve();
    expect([...fake.recoveries.values()][0]?.entries[0]?.text).toBe("Original");
  });

  it("does not recreate a deleted original from a recovery checkpoint", async () => {
    const fake = fixture({ fileSource: true });
    fake.recoveries.set("old-panel", {
      clientId: "old-panel",
      sourceId: "browser-panel-test",
      sequence: 1,
      updatedAt: 1,
      entries: [
        {
          scope: "current",
          key: "deleted-note",
          context: { url: "https://example.com/a", title: "Deleted original" },
          record: { id: "deleted-note", revision: 1, markdown: "Old" },
          text: "Recovered edit",
        },
      ],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.textContent).toContain("1 draft recovery copy available.");
    expect(editor(root).state.doc.toString()).toBe("");
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );
    expect(fake.library.notes).toEqual([]);
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

  it("retains an import that failed to create a note and blocks switching files", async () => {
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
    button(root, "Open file…").click();
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Save or export your unsaved drafts"),
    );
    expect(root.dataset.state).toBe("ready");
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

  it("has no lock control and dispatches a final save before pagehide clears plaintext", async () => {
    const original = note("https://example.com/a", "Original");
    const fake = fixture({ notes: [original] });
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(button(root, "Lock")).toBeNull();
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
