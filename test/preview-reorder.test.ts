import { afterEach, describe, expect, it, vi } from "vitest";
import {
  wirePreviewReorder,
  type PreviewReorderItem,
} from "../src/core/preview-reorder.js";

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function pointer(
  target: EventTarget,
  type: string,
  y: number,
  extra: Record<string, unknown> = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 30,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(
    event,
    Object.fromEntries(
      Object.entries({
        pointerId: 7,
        isPrimary: true,
        pointerType: "touch",
        ...extra,
      }).map(([key, value]) => [key, { value }]),
    ),
  );
  target.dispatchEvent(event);
  return event;
}

function key(target: EventTarget, value: string, altKey = true) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    altKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function fixture(
  options: {
    managed?: boolean;
    onStart?: () => boolean;
    canMove?: (from: number, to: number) => boolean;
  } = {},
) {
  const root = document.createElement("div");
  document.body.append(root);
  const entries: PreviewReorderItem[] = Array.from(
    { length: 3 },
    (_, index) => {
      const element = document.createElement("div");
      const handle =
        options.managed && index === 0
          ? null
          : document.createElement("button");
      if (handle) {
        handle.setAttribute("aria-label", `Move row ${index}`);
        handle.append(document.createElement("span"));
        element.append(handle);
      }
      const input = document.createElement("input");
      input.value = "synthetic private value";
      element.append(input);
      root.append(element);
      element.getBoundingClientRect = () =>
        new DOMRect(10, index * 100 + 10, 100, 80);
      return { element, handle };
    },
  );
  root.getBoundingClientRect = () => new DOMRect(0, 0, 120, 310);
  const onMove = vi.fn();
  const canMove = vi.fn(options.canMove ?? (() => true));
  const onStart = vi.fn(options.onStart ?? (() => true));
  const cleanup = wirePreviewReorder({
    root,
    items: () => entries,
    canMove,
    onMove,
    onStart,
  });
  disposals.push(cleanup);
  return { root, entries, onMove, canMove, onStart, cleanup };
}

describe("preview handle reordering", () => {
  it("adds accessible shortcuts and preserves ordinary keyboard navigation", () => {
    const h = fixture();
    const handle = h.entries[1]!.handle!;
    expect(handle.getAttribute("aria-label")).toBe("Move row 1");
    expect(handle.getAttribute("aria-keyshortcuts")).toBe(
      "Alt+ArrowUp Alt+ArrowDown",
    );
    expect(handle.style.touchAction).toBe("none");
    expect(key(handle, "Tab", false).defaultPrevented).toBe(false);
    expect(key(handle, "ArrowUp", false).defaultPrevented).toBe(false);
    expect(key(handle, "ArrowUp").defaultPrevented).toBe(true);
    expect(h.onMove).toHaveBeenLastCalledWith(1, 0);
    key(handle, "ArrowDown");
    expect(h.onMove).toHaveBeenLastCalledWith(1, 2);
    expect(h.onStart).toHaveBeenCalledTimes(2);
  });

  it("retains index slots without handles and respects movement guards", () => {
    const h = fixture({
      managed: true,
      canMove: (from, to) => from > 0 && to > 0,
    });
    key(h.entries[1]!.handle!, "ArrowUp");
    expect(h.canMove).toHaveBeenCalledWith(1, 0);
    expect(h.onMove).not.toHaveBeenCalled();
    key(h.entries[1]!.handle!, "ArrowDown");
    expect(h.onMove).toHaveBeenCalledWith(1, 2);
    pointer(h.entries[0]!.element, "pointerdown", 20);
    pointer(document, "pointermove", 240);
    pointer(document, "pointerup", 240);
    expect(h.onMove).toHaveBeenCalledTimes(1);
  });

  it("keyboard movement skips non-sibling entries in a flattened group list", () => {
    const h = fixture({ canMove: (from, to) => from === 0 && to === 2 });
    key(h.entries[0]!.handle!, "ArrowDown");
    expect(h.onMove).toHaveBeenCalledWith(0, 2);
  });

  it.each([
    [0, 120, 0, "none"],
    [0, 170, 1, "after"],
    [0, 220, 1, "before"],
    [0, 270, 2, "after"],
    [2, 20, 0, "before"],
    [2, 70, 1, "after"],
    [2, 120, 1, "before"],
    [2, 170, 2, "none"],
  ] as const)(
    "uses final-index semantics from %i at y=%i",
    (from, y, to, marker) => {
      const h = fixture();
      const handle = h.entries[from]!.handle!;
      const setCapture = vi.fn(),
        releaseCapture = vi.fn();
      handle.setPointerCapture = setCapture;
      handle.releasePointerCapture = releaseCapture;
      pointer(handle.firstElementChild!, "pointerdown", from * 100 + 30);
      pointer(document, "pointermove", y);
      expect(
        h.root.querySelectorAll(
          ".cm-aic-security-drop-before, .cm-aic-security-drop-after",
        ).length,
      ).toBe(marker === "none" ? 0 : 1);
      if (marker !== "none")
        expect(
          h.root.querySelector(`.cm-aic-security-drop-${marker}`),
        ).not.toBeNull();
      pointer(document, "pointerup", y);
      if (from === to) expect(h.onMove).not.toHaveBeenCalled();
      else expect(h.onMove).toHaveBeenCalledExactlyOnceWith(from, to);
      expect(setCapture).toHaveBeenCalledWith(7);
      expect(releaseCapture).toHaveBeenCalledWith(7);
      expect(
        h.root.querySelector(
          ".cm-aic-security-drop-before, .cm-aic-security-drop-after",
        ),
      ).toBeNull();
    },
  );

  it("never begins on field content, disabled handles, secondary pointers or right clicks", () => {
    const h = fixture();
    const input = h.entries[0]!.element.querySelector("input")!;
    expect(pointer(input, "pointerdown", 20).defaultPrevented).toBe(false);
    pointer(h.entries[0]!.handle!, "pointerdown", 20, { isPrimary: false });
    pointer(h.entries[0]!.handle!, "pointerdown", 20, { button: 2 });
    h.entries[0]!.handle!.disabled = true;
    pointer(h.entries[0]!.handle!, "pointerdown", 20);
    key(h.entries[0]!.handle!, "ArrowDown");
    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it.each([
    "escape",
    "pointercancel",
    "lostcapture",
    "blur",
    "focusout",
    "detach",
    "cleanup",
    "replace",
  ])("cancels on %s and cannot later move", async (reason) => {
    const h = fixture();
    const handle = h.entries[0]!.handle!;
    pointer(handle, "pointerdown", 20);
    pointer(document, "pointermove", 270);
    expect(h.root.querySelector(".cm-aic-security-drop-after")).not.toBeNull();
    if (reason === "escape") key(document, "Escape", false);
    if (reason === "pointercancel") pointer(document, "pointercancel", 270);
    if (reason === "lostcapture") pointer(handle, "lostpointercapture", 270);
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    if (reason === "focusout")
      handle.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    if (reason === "detach") h.root.remove();
    if (reason === "cleanup") h.cleanup();
    if (reason === "replace") h.entries.reverse();
    await Promise.resolve();
    pointer(document, "pointerup", 270);
    expect(h.onMove).not.toHaveBeenCalled();
    expect(
      h.root.querySelector(
        ".cm-aic-security-drop-before, .cm-aic-security-drop-after",
      ),
    ).toBeNull();
  });

  it("ignores unrelated pointer IDs and invalid or outside destinations", () => {
    const h = fixture({ canMove: () => false });
    pointer(h.entries[0]!.handle!, "pointerdown", 20);
    pointer(document, "pointermove", 270, { pointerId: 99 });
    pointer(document, "pointerup", 270, { pointerId: 99 });
    pointer(document, "pointermove", 270);
    expect(h.root.querySelector(".cm-aic-security-drop-after")).toBeNull();
    pointer(document, "pointerup", 900);
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("refuses onStart veto and does not clone or transport source data", () => {
    const h = fixture({ onStart: () => false });
    const handle = h.entries[0]!.handle!;
    const clone = vi.spyOn(h.entries[0]!.element, "cloneNode");
    pointer(handle, "pointerdown", 20);
    pointer(document, "pointermove", 270);
    pointer(document, "pointerup", 270);
    const refusedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    handle.dispatchEvent(refusedClick);
    expect(refusedClick.defaultPrevented).toBe(true);
    key(handle, "ArrowDown");
    const transfer = { setData: vi.fn(), setDragImage: vi.fn() };
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(drag, "dataTransfer", { value: transfer });
    handle.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
    expect(transfer.setData).not.toHaveBeenCalled();
    expect(transfer.setDragImage).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("suppresses the captured pointer's synthetic click but preserves keyboard and later clicks", () => {
    const h = fixture();
    const handle = h.entries[0]!.handle!;
    const clicked = vi.fn();
    handle.addEventListener("click", clicked);
    pointer(handle, "pointerdown", 20);
    pointer(document, "pointermove", 270);
    pointer(document, "pointerup", 270);
    const synthetic = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    handle.dispatchEvent(synthetic);
    expect(synthetic.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    handle.click();
    expect(clicked).toHaveBeenCalledOnce();
    pointer(handle, "pointerdown", 20);
    pointer(document, "pointercancel", 20);
    const input = h.entries[1]!.element.querySelector("input")!;
    pointer(input, "pointerdown", 120);
    const ordinary = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: 30,
      clientY: 20,
    });
    input.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
  });

  it("keeps nested controllers isolated to their own handles", () => {
    const h = fixture();
    const outer = document.createElement("div"),
      other = document.createElement("div"),
      outerHandle = document.createElement("button");
    h.root.before(outer);
    outer.append(h.root, other);
    h.root.prepend(outerHandle);
    const onMove = vi.fn(),
      onStart = vi.fn();
    disposals.push(
      wirePreviewReorder({
        root: outer,
        items: () => [
          { element: h.root, handle: outerHandle },
          { element: other },
        ],
        canMove: () => true,
        onMove,
        onStart,
      }),
    );
    key(h.entries[0]!.handle!, "ArrowDown");
    pointer(h.entries[0]!.handle!, "pointerdown", 20);
    pointer(document, "pointermove", 270);
    pointer(document, "pointerup", 270);
    expect(h.onMove).toHaveBeenCalledTimes(2);
    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("limits shared-root drops to owned item descendants or genuinely empty root gaps", () => {
    const h = fixture();
    const original = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    const hitTest = vi.fn<() => Element | null>();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: hitTest,
    });
    disposals.push(() => {
      if (original)
        Object.defineProperty(document, "elementFromPoint", original);
      else Reflect.deleteProperty(document, "elementFromPoint");
    });
    for (const kind of ["properties", "markdown", "other-list"]) {
      const unrelated = document.createElement("div");
      unrelated.className = kind;
      const descendant = document.createElement("span");
      unrelated.append(descendant);
      h.root.append(unrelated);
      hitTest.mockReturnValue(descendant);
      pointer(h.entries[2]!.handle!, "pointerdown", 230);
      pointer(document, "pointermove", 100);
      expect(
        h.root.querySelector(
          ".cm-aic-security-drop-before, .cm-aic-security-drop-after",
        ),
      ).toBeNull();
      pointer(document, "pointerup", 100);
      expect(h.onMove).not.toHaveBeenCalled();
      unrelated.remove();
    }
    hitTest.mockReturnValue(h.entries[2]!.element.querySelector("input"));
    pointer(h.entries[0]!.handle!, "pointerdown", 30);
    pointer(document, "pointermove", 270);
    pointer(document, "pointerup", 270);
    expect(h.onMove).toHaveBeenLastCalledWith(0, 2);
    for (const emptyHit of [h.root, null]) {
      hitTest.mockReturnValue(emptyHit);
      pointer(h.entries[2]!.handle!, "pointerdown", 230);
      pointer(document, "pointermove", 100);
      pointer(document, "pointerup", 100);
      expect(h.onMove).toHaveBeenLastCalledWith(2, 1);
    }
    expect(h.onMove).toHaveBeenCalledTimes(3);
  });

  it("cleans up transient document listeners and restores handle-owned attributes", () => {
    const add = vi.spyOn(document, "addEventListener"),
      remove = vi.spyOn(document, "removeEventListener");
    const h = fixture();
    const tracked = [
      "pointermove",
      "pointerup",
      "pointercancel",
      "keydown",
      "focusout",
    ];
    expect(
      add.mock.calls.filter(([type]) => tracked.includes(type)),
    ).toHaveLength(0);
    const handle = h.entries[0]!.handle!;
    pointer(handle, "pointerdown", 20);
    const registered = add.mock.calls.filter(([type]) =>
      tracked.includes(type),
    );
    expect(registered).toHaveLength(5);
    h.cleanup();
    for (const [type, listener, options] of registered)
      expect(remove).toHaveBeenCalledWith(type, listener, options);
    expect(handle.getAttribute("aria-keyshortcuts")).toBeNull();
    expect(handle.style.touchAction ?? "").toBe("");
    h.cleanup();
    key(handle, "ArrowDown");
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("restores prior shortcuts and touch behavior, including dynamically supplied handles", async () => {
    const root = document.createElement("div"),
      a = document.createElement("button"),
      b = document.createElement("button");
    document.body.append(root);
    root.append(a, b);
    a.style.touchAction = "pan-y";
    a.setAttribute("aria-keyshortcuts", "Enter");
    const entries: PreviewReorderItem[] = [
      { element: a, handle: a },
      { element: b, handle: b },
    ];
    const cleanup = wirePreviewReorder({
      root,
      items: () => entries,
      canMove: () => true,
      onMove: () => {},
    });
    disposals.push(cleanup);
    expect(a.style.touchAction).toBe("pan-y");
    expect(a.getAttribute("aria-keyshortcuts")).toBe(
      "Enter Alt+ArrowUp Alt+ArrowDown",
    );
    const replacement = document.createElement("button");
    b.replaceWith(replacement);
    entries[1] = { element: replacement, handle: replacement };
    await Promise.resolve();
    expect(b.getAttribute("aria-keyshortcuts")).toBeNull();
    expect(replacement.style.touchAction).toBe("none");
    cleanup();
    expect(a.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(a.style.touchAction).toBe("pan-y");
    expect(replacement.getAttribute("aria-keyshortcuts")).toBeNull();
  });
});
