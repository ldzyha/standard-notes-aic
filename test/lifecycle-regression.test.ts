import { describe, expect, it, vi } from "vitest";
import { wirePreviewSelection } from "../src/core/structured-preview.js";
import { NoteDraftRegistry } from "../src/note-draft-registry";
import { renderMermaidSvg } from "../src/core/mermaid-runtime.js";

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: engine }));

describe("surface and pending-work ownership", () => {
  it("leaves select-all in nested controls and nested CodeMirror editors", () => {
    const dom = document.createElement("div");
    dom.className = "cm-editor";
    const contentDOM = dom.appendChild(document.createElement("div"));
    contentDOM.className = "cm-content";
    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      dom,
      contentDOM,
      dispatch,
      focus,
      state: { doc: { length: 1234 } },
    };
    const detach = wirePreviewSelection(view as never);
    document.body.append(dom);
    try {
      for (const tag of ["textarea", "input", "select"]) {
        const child = contentDOM.appendChild(document.createElement(tag));
        const event = new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        child.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        child.remove();
      }
      const nested = contentDOM.appendChild(document.createElement("div"));
      nested.className = "cm-editor";
      const nestedContent = nested.appendChild(document.createElement("div"));
      nestedContent.className = "cm-content";
      nestedContent.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(dispatch).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
      contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
      detach();
      contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      detach();
      dom.remove();
    }
  });

  it("evicts inactive clean drafts after a late acknowledgement, but retains newer or failed drafts", () => {
    const drafts = new NoteDraftRegistry();
    const retained = () =>
      (drafts as unknown as { sessions: Map<string, unknown> }).sessions.size;
    for (let index = 0; index < 200; index++) {
      drafts.activate(`note-${index}`, "base");
      drafts.edit("x".repeat(2048));
      const commit = drafts.begin()!;
      drafts.activate("active", "Active note");
      expect(drafts.acknowledge({ ...commit, saved: true })).toBe(true);
      expect(retained()).toBe(1);
    }
    for (const saved of [true, false]) {
      drafts.activate(`keep-${saved}`, "base");
      drafts.edit("submitted");
      const commit = drafts.begin()!;
      if (saved) drafts.edit("newer");
      drafts.activate("active", "Active note");
      drafts.acknowledge({ ...commit, saved });
      expect(drafts.activate(`keep-${saved}`, "base").text).toBe(
        saved ? "newer" : "submitted",
      );
    }
  });

  it("promptly removes canceled renders while preserving the actual engine mutex", async () => {
    let finish!: (value: { svg: string }) => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    engine.render.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const activeAbort = new AbortController();
    const active = renderMermaidSvg(document, {
      source: "flowchart LR; A-->B",
      signal: activeAbort.signal,
    });
    const activeResult = active.catch((error: Error) => error.name);
    await start;
    const canceled: Promise<unknown>[] = [];
    for (let index = 0; index < 256; index++) {
      const abort = new AbortController();
      canceled.push(
        renderMermaidSvg(document, {
          source: `flowchart LR; A-->B${index}`,
          signal: abort.signal,
        }).catch((error: Error) => error.name),
      );
      abort.abort();
    }
    activeAbort.abort();
    // A microtask checkpoint, not a wall-clock performance assertion.
    const pending = Symbol("pending");
    let results: unknown = pending;
    void Promise.all(canceled).then((value) => {
      results = value;
    });
    for (let index = 0; index < 12; index++) await Promise.resolve();
    try {
      expect(results).not.toBe(pending);
      expect(results).toEqual(Array(256).fill("AbortError"));
      expect(
        await Promise.race([activeResult, Promise.resolve("pending")]),
      ).toBe("AbortError");
      expect(engine.render).toHaveBeenCalledTimes(1);
    } finally {
      finish({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      await activeResult;
      await Promise.all(canceled);
    }
  });
});
