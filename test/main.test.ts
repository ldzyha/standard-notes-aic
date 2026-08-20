import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  let subscriber: ((text: string) => void) | null = null;
  let text = "";
  let preview = "";
  const writes: string[] = [];
  const unsubscribe = vi.fn();
  const api = {
    initialize: vi.fn(),
    subscribe: vi.fn((callback: (text: string) => void) => {
      subscriber = callback;
      return unsubscribe;
    }),
    locked: false,
    get text() {
      return text;
    },
    set text(value: string) {
      text = value;
      writes.push(`text:${value}`);
    },
    get preview() {
      return preview;
    },
    set preview(value: string) {
      preview = value;
      writes.push(`preview:${value}`);
    },
  };
  return {
    api,
    writes,
    unsubscribe,
    subscriber: () => subscriber,
  };
});

vi.mock("sn-extension-api", () => ({ default: bridge.api }));

afterEach(() => {
  document.documentElement.removeAttribute("data-environment");
  document.documentElement.removeAttribute("style");
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.ReactNativeWebView;
  vi.restoreAllMocks();
});

describe("Standard Notes editor bridge", () => {
  it("loads, saves, locks, and tears down exact note text", async () => {
    window.ReactNativeWebView = {};
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);
    await import("../src/main");

    expect(bridge.api.initialize).toHaveBeenCalledWith({ debounceSave: 250 });
    expect(bridge.api.subscribe).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.environment).toBe("standard-notes");

    const editorElement = root.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(editorElement);
    if (!view) throw new Error("CodeMirror view was not mounted");

    expect(view.state.readOnly).toBe(true);
    expect(
      root.querySelector<HTMLElement>(".aic-editor")!.dataset.readOnly,
    ).toBe("true");
    view.dispatch({ changes: { from: 0, insert: "premature" } });
    expect(bridge.writes).toEqual([]);

    const source = "# Synced\n\n- [ ] exact  \n";
    bridge.subscriber()!(source);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.readOnly).toBe(false);
    expect(
      root.querySelector<HTMLElement>(".aic-editor")!.dataset.readOnly,
    ).toBe("false");
    view.dispatch({
      changes: { from: source.length, insert: "next" },
      userEvent: "input",
    });
    expect(bridge.api.text).toBe(`${source}next`);
    expect(bridge.api.preview).toBe("Synced exact next");
    expect(bridge.writes).toEqual([
      `text:${source}next`,
      "preview:Synced exact next",
    ]);

    const remote = "## Remote\r\n\r\nbody  \r\n";
    bridge.subscriber()!(remote);
    expect(bridge.writes).toHaveLength(2);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "more" },
      userEvent: "input",
    });
    expect(bridge.api.text).toBe(`${remote}more`);
    expect(bridge.api.preview).toBe("Remote body more");

    bridge.api.locked = true;
    bridge.subscriber()!(bridge.api.text);
    expect(
      [
        ...root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        ),
      ].every((control) => control.disabled),
    ).toBe(true);
    const saved = bridge.api.text;
    view.dispatch({ changes: { from: 0, insert: "blocked" } });
    expect(bridge.api.text).toBe(saved);

    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(root.querySelector(".aic-editor")).toBeNull();
  });
});
