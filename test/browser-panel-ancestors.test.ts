import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type {
  BrowserDomain,
  BrowserLibrary,
  BrowserNote,
} from "../src/browser/library";
import { BrowserPanel } from "../src/browser/panel";

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

const current: ActivePage = {
  tabId: 7,
  windowId: 2,
  title: "Current page",
  url: "https://example.test/docs/api/items/current?view=full",
};
const sharedSecret = "SYNTHETIC-SHARED-SECRET";
const currentSource = "Current page source only";
const note = (
  url: string,
  title: string,
  markdown = `SYNTHETIC-ANCESTOR-SECRET:${title}`,
): BrowserNote => ({
  id: `note:${url}`,
  url,
  title,
  markdown,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});
const domain: BrowserDomain = {
  id: "domain:https://example.test",
  origin: "https://example.test",
  markdown:
    "```aic\n# Properties\nUsername | shared-user\nPassword *| " +
    sharedSecret +
    "\n```\n",
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
};

function fixture() {
  let state = "unlocked";
  let library: BrowserLibrary = {
    version: 3,
    global: null,
    domains: [domain],
    notes: [
      note("https://example.test/", "Site"),
      note("https://example.test/docs", "Docs"),
      note("https://example.test/docs/api", "API"),
      note("https://example.test/docs/api/items", "Items"),
      note("https://example.test/docs/api/other", "Sibling"),
      note(current.url, current.title, currentSource),
    ],
    history: [],
  };
  const messages: Request[] = [];
  const changed = event<[Record<string, unknown>, string]>();
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        let value: unknown;
        switch (message.type) {
          case "status":
            value = { state };
            break;
          case "context":
            value = structuredClone(current);
            break;
          case "visit":
          case "load":
            value = structuredClone(library);
            break;
          case "save": {
            const saved = library.notes.find(
              (candidate) => candidate.id === message.id,
            )!;
            saved.markdown = message.markdown;
            saved.revision += 1;
            value = structuredClone(saved);
            break;
          }
          case "navigate":
            value = null;
            break;
          case "lock":
            state = "locked";
            value = { state };
            break;
          default:
            throw new Error(`Unexpected request ${message.type}`);
        }
        return { ok: true, value };
      },
    },
    windows: { getCurrent: async () => ({ id: 2, incognito: false }) },
    storage: { onChanged: changed },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    remove(url: string) {
      library = {
        ...library,
        notes: library.notes.filter((candidate) => candidate.url !== url),
      };
      changed.emit(
        { "aic-browser-library": { newValue: "synthetic-envelope" } },
        "local",
      );
    },
    lock() {
      state = "locked";
      changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    },
  };
}

const panels: BrowserPanel[] = [];
async function mount(api: BrowserApi) {
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  await panel.ready;
  return root;
}
function pageView(root: HTMLElement) {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".browser-note .cm-editor")!,
  )!;
}
function press(root: ParentNode, label: RegExp) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      label.test(
        candidate.getAttribute("aria-label") || candidate.textContent || "",
      ),
  );
  expect(button, `Expected button ${label}`).toBeDefined();
  button!.click();
}

afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saved page ancestors in the browser panel", () => {
  it("places metadata-only ancestor links between domain sharing and the current editor", async () => {
    const fake = fixture();
    const root = await mount(fake.api);
    const content = root.querySelector(".browser-content")!;
    const ordered = [
      "browser-shared-host",
      "browser-shared-host",
      "browser-page-ancestors",
      "browser-note",
    ];
    ordered.forEach((name, index) =>
      expect(content.children[index]?.classList.contains(name)).toBe(true),
    );
    const ancestors = content.querySelector(".browser-page-ancestors")!;
    expect(
      [...ancestors.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["Site", "Docs", "API", "Items", "Current page"]);
    expect(ancestors.textContent).not.toContain("Sibling");
    expect(ancestors.textContent).not.toContain("SYNTHETIC-ANCESTOR-SECRET");
    expect(ancestors.innerHTML).not.toContain("markdown");
    expect(pageView(root).state.doc.toString()).toBe(currentSource);
    expect(root.textContent).not.toContain(sharedSecret);
  });

  it("uses the existing save-before-navigation boundary and preserves current export source", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, {
        clipboard: { writeText, readText: vi.fn(async () => "") },
      }),
    );
    const fake = fixture();
    const root = await mount(fake.api);
    const editor = pageView(root);
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\nLocal edit" },
    });
    const expectedSource = `${currentSource}\nLocal edit`;
    const ancestors = root.querySelector(".browser-page-ancestors")!;
    press(ancestors, /^API$/u);
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "navigate")).toBe(
        true,
      ),
    );
    const saveIndex = fake.messages.findIndex(
      (message) => message.type === "save",
    );
    const navigateIndex = fake.messages.findIndex(
      (message) => message.type === "navigate",
    );
    expect(saveIndex).toBeGreaterThan(-1);
    expect(navigateIndex).toBeGreaterThan(saveIndex);
    expect(fake.messages[navigateIndex]).toMatchObject({
      type: "navigate",
      url: "https://example.test/docs/api",
    });
    await vi.waitFor(() =>
      expect(pageView(root).state.doc.toString()).toBe(expectedSource),
    );
    const blobs: Blob[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL(blob: Blob) {
          blobs.push(blob);
          return "blob:synthetic-ancestor-export";
        }
        static override revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    press(root, /^Export Markdown file$/u);
    const exported = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blobs[0]!);
    });
    expect(exported).toBe(expectedSource);
    expect(exported).not.toContain("SYNTHETIC-ANCESTOR-SECRET");
    expect(exported).not.toContain(sharedSecret);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("refreshes removals without replacing the current editor or its selection", async () => {
    const fake = fixture();
    const root = await mount(fake.api);
    const editor = pageView(root);
    editor.dispatch({ selection: { anchor: 4 } });
    fake.remove("https://example.test/docs/api");
    await vi.waitFor(() =>
      expect(
        root.querySelector(".browser-page-ancestors")?.textContent,
      ).not.toContain("API"),
    );
    expect(pageView(root)).toBe(editor);
    expect(editor.state.selection.main.anchor).toBe(4);
    expect(editor.state.doc.toString()).toBe(currentSource);
  });

  it("removes ancestor metadata and editor plaintext when the vault locks", async () => {
    const fake = fixture();
    const root = await mount(fake.api);
    expect(root.textContent).toContain("Items");
    fake.lock();
    expect(root.querySelector(".browser-page-ancestors")).toBeNull();
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.textContent).not.toContain("Items");
    expect(root.textContent).not.toContain(currentSource);
  });
});
