import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserNote } from "../src/browser/library";
import { focusedPage } from "../src/core/note-page-cards.js";
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
const A = "https://example.com/a";
const B = "https://example.com/b";
const NOTE = `--- ${A}\nOriginal\n\n--- ${B}\nSecond\n`;

function fixture(
  options: {
    state?: "unselected" | "unavailable" | "ready";
    private?: boolean;
    markdown?: string;
  } = {},
) {
  let state = options.state ?? "ready";
  const openedTab = vi.fn(async () => ({}));
  let page: ActivePage | null = {
    tabId: 7,
    windowId: 2,
    title: "Active page",
    url: A,
  };
  const note: BrowserNote = {
    id: "file-note",
    filePath: "aic.md",
    markdown: options.markdown ?? NOTE,
    revision: 1,
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
    source: { kind: "directory", id: "browser-panel-test", name: "notes" },
    access: { read: "granted", write: "granted" },
  });
  const api = {
    runtime: {
      getURL: (path: string) => `chrome-extension://fixture/${path}`,
      sendMessage: async (message: Request) => {
        messages.push(message);
        try {
          const custom = override?.(message);
          if (custom) return { ok: true, value: await custom };
        } catch (error) {
          return {
            ok: false,
            error: (error as Error).message,
            code: (error as { code?: string }).code,
          };
        }
        let value: unknown = null;
        switch (message.type) {
          case "status":
            value = status();
            break;
          case "connect-source":
            state = "ready";
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
            break;
          case "context":
            value = page;
            break;
          case "load":
            value = { ...note };
            break;
          case "save":
            Object.assign(note, {
              markdown: message.markdown,
              revision: message.revision + 1,
            });
            value = { ...note };
            break;
          case "capture":
            value = {
              url: message.page.url,
              title: "Imported",
              html: "<p>Captured content</p><hr><p>After the rule</p>",
              truncated: false,
            };
            break;
        }
        return { ok: true, value };
      },
    },
    windows: {
      getCurrent: async () => ({ id: 2, incognito: options.private ?? false }),
    },
    storage: { onChanged: changed },
    tabs: {
      onActivated: activated,
      onUpdated: updated,
      onRemoved: removed,
      create: openedTab,
    },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    openedTab,
    messages,
    recoveries,
    note,
    changed,
    activated,
    go: (url: string | null, tabId = 9) => {
      page = url ? { tabId, windowId: 2, title: "Next page", url } : null;
      activated.emit({ tabId, windowId: 2 });
    },
    override: (callback: typeof override) => {
      override = callback;
    },
  };
}

const panels: BrowserPanel[] = [];
async function mount(fake: ReturnType<typeof fixture>, wait = true) {
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, fake.api);
  panels.push(panel);
  await panel.ready;
  if (wait)
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
  return { root, panel };
}
function button(root: HTMLElement, label: string) {
  if (
    !root.querySelector(`button[aria-label="${label}"]`) &&
    !root.querySelector(".browser-popover")
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
function shows(root: HTMLElement, target: string | null) {
  return vi.waitFor(() =>
    expect(focusedPage(editor(root).state)?.target ?? null).toBe(target),
  );
}
function type(root: HTMLElement, text: string) {
  const view = editor(root);
  view.dispatch({
    changes: { from: focusedPage(view.state)!.from, insert: text },
  });
}
function downloads() {
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
  return () =>
    Promise.all(
      blobs.map(
        (blob) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsText(blob);
          }),
      ),
    );
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
    const { root } = await mount(fake, false);
    expect(root.textContent).toContain("Open your notes");
    const gate = root.querySelector(".browser-files-gate")!;
    expect(
      [...gate.querySelectorAll("button")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual(["Open folder", "Open file"]);
    expect(root.querySelector('input[type="password"]')).toBeNull();
    expect(root.textContent).not.toMatch(/encrypt|unlock|passphrase|backup/iu);
    button(gate as HTMLElement, "Open folder").click();
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(
      fake.messages.some((message) =>
        ["setup", "unlock", "lock"].includes(message.type),
      ),
    ).toBe(false);
  });

  it("shows only the page of the active tab and follows tab changes without remounting", async () => {
    const fake = fixture();
    const { root } = await mount(fake);
    await shows(root, A);
    const view = editor(root);
    expect(root.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(root.querySelector(".browser-toolbar")!.textContent).toBe(">_ AIC⋯");
    fake.go(`${B}#section`);
    await shows(root, B);
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe(NOTE);
    // Reading pages never saves.
    expect(fake.messages.map((message) => message.type)).not.toContain("save");
    expect(
      fake.messages.every((message) =>
        [
          "status",
          "context",
          "load",
          "list-recovery",
          "checkpoint-drafts",
        ].includes(message.type),
      ),
    ).toBe(true);
    fake.go(null, 10);
    await shows(root, null);
    expect(editor(root)).toBe(view);
  });

  it("opens a page target in a tab from its card", async () => {
    const fake = fixture();
    const { root } = await mount(fake);
    await shows(root, A);
    root
      .querySelector<HTMLButtonElement>(
        '.aic-card--page [aria-label="Open target"]',
      )!
      .click();
    await vi.waitFor(() =>
      expect(fake.openedTab).toHaveBeenCalledWith({ url: A, windowId: 2 }),
    );
  });

  it("imports captured content into the focused page, not the end of the file", async () => {
    const fake = fixture();
    const { root } = await mount(fake);
    await shows(root, A);
    button(root, "Import current content").click();
    expect(fake.api.permissions.request).toHaveBeenCalledWith({
      origins: ["https://example.com/*"],
    });
    await vi.waitFor(() =>
      expect(fake.note.markdown).toBe(
        `--- ${A}\nOriginal\n\nCaptured content\n\n***\n\nAfter the rule\n\n--- ${B}\nSecond\n`,
      ),
    );
    expect(root.textContent).toContain("Imported into this page’s note.");
  });

  it("creates the page when importing into a URL without one", async () => {
    const fake = fixture({ markdown: "Intro\n" });
    const { root } = await mount(fake);
    await shows(root, A);
    expect(focusedPage(editor(root).state)).toMatchObject({ exists: false });
    button(root, "Import current content").click();
    await vi.waitFor(() =>
      expect(fake.note.markdown).toBe(
        `Intro\n\n--- ${A}\nCaptured content\n\n***\n\nAfter the rule`,
      ),
    );
  });

  it("downloads the focused page or, by its own action, the whole note file", async () => {
    const fake = fixture();
    const { root } = await mount(fake);
    await shows(root, A);
    const texts = downloads();
    button(root, "Download page").click();
    button(root, "Download note file").click();
    expect(await texts()).toEqual(["Original", NOTE]);
  });

  it("shows file status through edit, pending disk write, and settled acknowledgement", async () => {
    const fake = fixture();
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root } = await mount(fake);
    await shows(root, A);
    const statusText = () =>
      root.querySelector(".browser-file-location .aic-context__status")
        ?.textContent;
    expect(statusText()).toBe("On disk");
    type(root, "Edited ");
    expect(statusText()).toBe("Unsaved");
    await vi.waitFor(() => expect(fake.recoveries.size).toBe(1));
    expect([...fake.recoveries.values()][0]!.entries[0]).toMatchObject({
      scope: "current",
      context: { url: "file:file-note", title: "aic.md" },
      text: NOTE.replace("Original", "Edited Original"),
    });
    await vi.waitFor(() =>
      expect(fake.messages.some((item) => item.type === "save")).toBe(true),
    );
    expect(statusText()).toBe("Unsaved");
    pending.resolve({
      ...fake.note,
      markdown: NOTE.replace("Original", "Edited Original"),
      revision: 2,
    });
    await vi.waitFor(() => expect(statusText()).toBe("On disk"));
    await vi.waitFor(() => expect(fake.recoveries.size).toBe(0));
  });

  it("says the note file is too large when a save exceeds the cap and keeps the draft", async () => {
    const fake = fixture();
    fake.override((message) =>
      message.type === "save"
        ? Promise.reject(
            Object.assign(new Error("The note file is too large"), {
              code: "quota",
            }),
          )
        : undefined,
    );
    const { root } = await mount(fake);
    await shows(root, A);
    type(root, "Edited ");
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-draft-error")?.textContent).toContain(
        "aic.md: The note file is too large to save (limit 512 KiB). Nothing was truncated",
      ),
    );
    expect(editor(root).state.doc.toString()).toContain("Edited Original");
    expect(fake.note.markdown).toBe(NOTE);
    const texts = downloads();
    button(root, "Export unsaved draft").click();
    expect(await texts()).toEqual([
      NOTE.replace("Original", "Edited Original"),
    ]);
  });

  it("keeps recovery copies of earlier page, Shared and Global drafts reviewable and exportable, and never applies them", async () => {
    const fake = fixture();
    fake.recoveries.set("old-panel", {
      clientId: "old-panel",
      sourceId: "browser-panel-test",
      sequence: 3,
      updatedAt: 1,
      entries: [
        {
          scope: "current",
          key: "pending:https://example.com/old",
          context: { url: "https://example.com/old", title: "Old page" },
          record: null,
          text: "Unsaved page draft",
        },
        {
          scope: "shared",
          key: "pending:https://example.com",
          context: { origin: "https://example.com" },
          record: null,
          text: "Unsaved shared draft",
        },
        {
          scope: "global",
          key: "global-1",
          context: {},
          record: { id: "global-1", revision: 2, markdown: "Saved" },
          text: "Unsaved global draft",
        },
      ],
    });
    const before = structuredClone(fake.recoveries.get("old-panel"));
    const { root } = await mount(fake);
    await shows(root, A);
    await vi.waitFor(() =>
      expect(root.textContent).toContain("3 draft recovery copies available."),
    );
    const texts = downloads();
    button(root, "Review recovered drafts").click();
    button(root, "Save recovered copy: Old page").click();
    button(root, "Save recovered copy: Shared · example.com").click();
    button(root, "Save recovered copy: Global").click();
    expect(await texts()).toEqual([
      "Unsaved page draft",
      "Unsaved shared draft",
      "Unsaved global draft",
    ]);
    expect(editor(root).state.doc.toString()).toBe(NOTE);
    type(root, "Edited ");
    await vi.waitFor(() =>
      expect(fake.messages.some((item) => item.type === "save")).toBe(true),
    );
    expect(fake.note.markdown).not.toContain("Unsaved");
    expect(fake.recoveries.get("old-panel")).toEqual(before);
    expect(fake.messages.some((item) => item.type === "dismiss-recovery")).toBe(
      false,
    );
  });

  it("dispatches a final save before pagehide clears plaintext", async () => {
    const fake = fixture();
    const pending = deferred<BrowserNote>();
    fake.override((message) =>
      message.type === "save" ? pending.promise : undefined,
    );
    const { root } = await mount(fake);
    await shows(root, A);
    type(root, "Edited ");
    window.dispatchEvent(new Event("pagehide"));
    expect(fake.messages).toContainEqual({
      type: "save",
      sourceId: "browser-panel-test",
      id: "file-note",
      markdown: NOTE.replace("Original", "Edited Original"),
      revision: 1,
    });
    expect(root.textContent).toBe("");
    expect(fake.changed.listeners.size).toBe(0);
  });

  it("saves and removes the editor when hidden, ignores tab changes while hidden and resumes on the current page", async () => {
    const fake = fixture();
    const { root } = await mount(fake);
    await shows(root, A);
    type(root, "Edited ");
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fake.messages.some((message) => message.type === "save")).toBe(true);
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.textContent).not.toContain("Original");
    await vi.waitFor(() =>
      expect(fake.note.markdown).toContain("Edited Original"),
    );
    const count = fake.messages.length;
    fake.go(B);
    expect(fake.messages).toHaveLength(count);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    await shows(root, B);
    expect(editor(root).state.doc.toString()).toContain("Edited Original");
  });

  it("asks for consent before using a private window", async () => {
    const fake = fixture({ private: true });
    const { root } = await mount(fake, false);
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(fake.messages.map((item) => item.type)).not.toContain("load");
    button(root, "Use AIC in this private window").click();
    await vi.waitFor(() =>
      expect(root.querySelector(".cm-editor")).not.toBeNull(),
    );
    expect(fake.messages).toContainEqual({
      type: "context",
      windowId: 2,
      allowPrivate: true,
    });
  });
});
