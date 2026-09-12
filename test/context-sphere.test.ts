import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContextSphere,
  layoutContextSphere,
} from "../src/core/context-sphere.js";
import type {
  ContextSphereGraph,
  ContextSphereNode,
  ContextSphereState,
} from "../src/core/context-sphere.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function file(
  id: string,
  overrides: Partial<ContextSphereNode> = {},
): ContextSphereNode {
  return { id, label: id, kind: "file", analysis: "ready", ...overrides };
}
function graph(nodes = [file("a"), file("b"), file("c")]): ContextSphereGraph {
  return {
    nodes,
    edges: [{ id: "a-b", from: "a", to: "b", kind: "import" }],
    activeId: "a",
  };
}
function mount(state?: Partial<ContextSphereState>) {
  const host = document.createElement("div");
  let width = 320;
  Object.defineProperty(host, "clientWidth", { get: () => width });
  document.body.append(host);
  const onOpen = vi.fn(),
    onPin = vi.fn(),
    onStateChange = vi.fn();
  const controller = createContextSphere(host, {
    state,
    onOpen,
    onPin,
    onStateChange,
  });
  disposers.push(controller.dispose);
  const root = host.querySelector<HTMLElement>(".aic-context-sphere")!;
  const toggle = root.querySelector<HTMLButtonElement>(
    ".aic-context-sphere-toggle",
  )!;
  const handle = root.querySelector<HTMLButtonElement>(
    ".aic-context-sphere-handle",
  )!;
  return {
    ...controller,
    host,
    root,
    toggle,
    handle,
    onOpen,
    onPin,
    onStateChange,
    setWidth(next: number) {
      width = next;
    },
  };
}
function pointer(
  target: Element,
  type: string,
  fields: Record<string, unknown> = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 20,
    clientY: 20,
  });
  Object.entries({ pointerId: 1, pointerType: "mouse", ...fields }).forEach(
    ([key, value]) => Object.defineProperty(event, key, { value }),
  );
  target.dispatchEvent(event);
  return event;
}

describe("context sphere layout", () => {
  it("is deterministic on uniform spherical slots regardless of ordering or editor status", () => {
    const input = graph(
      Array.from({ length: 12 }, (_, index) => file(String(index))),
    );
    input.edges = [{ id: "link", from: "0", to: "11", kind: "import" }];
    const result = layoutContextSphere(input);
    const reordered = {
      ...input,
      activeId: "11",
      nodes: [...input.nodes].reverse().map((node) => ({
        ...node,
        changed: true,
        label: `${node.label} edited`,
      })),
      edges: [...input.edges].reverse(),
    };
    expect(layoutContextSphere(reordered)).toEqual(result);
    expect(new Set(result.map(({ x, y, z }) => `${x},${y},${z}`)).size).toBe(
      12,
    );
    for (const point of result)
      expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(1, 10);
    expect(
      layoutContextSphere({
        ...input,
        edges: [
          ...input.edges,
          { id: "second", from: "11", to: "0", kind: "call" },
        ],
      }),
    ).toEqual(result);
  });

  it("places connected files closer while retaining evenly distributed slots", () => {
    const input = graph(
      Array.from({ length: 18 }, (_, index) => file(`file-${index}`)),
    );
    input.edges = [{ id: "far", from: "file-0", to: "file-9", kind: "import" }];
    const result = layoutContextSphere(input);
    const start = result.find(({ id }) => id === "file-0")!;
    const linked = result.find(({ id }) => id === "file-9")!;
    const distance = (point: typeof start) =>
      Math.hypot(point.x - start.x, point.y - start.y, point.z - start.z);
    const unrelated = result.filter(
      ({ id }) => id !== start.id && id !== linked.id,
    );
    expect(distance(linked)).toBeLessThan(
      unrelated.reduce((sum, point) => sum + distance(point), 0) /
        unrelated.length,
    );
    const noEdges = layoutContextSphere({ ...input, edges: [] });
    const slots = (points: typeof result) =>
      points.map(({ x, y, z }) => `${x}:${y}:${z}`).sort();
    expect(slots(result)).toEqual(slots(noEdges));
  });

  it("deduplicates files and safely ignores links to missing files", () => {
    const input = graph([file("a"), file("a"), file("b")]);
    input.edges = [
      ...input.edges,
      { id: "missing", from: "a", to: "outside", kind: "reference" },
    ];
    expect(layoutContextSphere(input).map(({ id }) => id)).toEqual(["a", "b"]);
  });
});

describe("context sphere interactions", () => {
  it("keeps the empty translucent shell mounted in both display states", () => {
    const current = mount();
    expect(current.root.hidden).toBe(false);
    expect(current.root.dataset.expanded).toBe("false");
    expect(
      current.root.querySelector(".aic-context-sphere-shell"),
    ).not.toBeNull();
    expect(
      current.root.querySelector<HTMLElement>(".aic-context-sphere-empty")!
        .hidden,
    ).toBe(false);
    current.toggle.click();
    expect(current.root.dataset.expanded).toBe("true");
    expect(current.root.textContent).toContain("No files in context yet");
    current.root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(current.root.dataset.expanded).toBe("false");
    expect(
      current.root.querySelector(".aic-context-sphere-shell"),
    ).not.toBeNull();
    expect(current.root.isConnected).toBe(true);
  });

  it("Escape and Collapse stay collapsed until the pointer leaves the region", () => {
    const current = mount();
    const dock = current.root.querySelector<HTMLElement>(
      ".aic-context-sphere-dock",
    )!;
    pointer(dock, "pointerenter");
    expect(current.root.dataset.expanded).toBe("true");
    current.root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    pointer(dock, "pointerenter");
    expect(current.root.dataset.expanded).toBe("false");
    pointer(current.root, "pointerleave");
    pointer(dock, "pointerenter");
    expect(current.root.dataset.expanded).toBe("true");
    current.toggle.click();
    pointer(dock, "pointerenter");
    expect(current.root.dataset.expanded).toBe("false");
    current.toggle.click();
    pointer(current.root, "pointerleave");
    document.body.focus();
    expect(current.root.dataset.expanded).toBe("true");
    const externalEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(externalEscape);
    expect(externalEscape.defaultPrevented).toBe(false);
    expect(current.root.dataset.expanded).toBe("true");
  });

  it("opens nodes separately from pin controls and preserves focused nodes on text/status updates", () => {
    const current = mount({ expanded: true });
    const input = graph();
    current.update(input);
    const node = current.root.querySelector<HTMLButtonElement>(
      '.aic-context-sphere-node[data-node-id="b"]',
    )!;
    const initialPosition = [node.style.left, node.style.top];
    node.focus();
    node.click();
    expect(current.onOpen).toHaveBeenCalledExactlyOnceWith("b");
    expect(current.onPin).not.toHaveBeenCalled();
    current.update({
      ...input,
      nodes: input.nodes.map((item) => ({
        ...item,
        dirty: true,
        changed: true,
        label: `${item.label} edited`,
      })),
    });
    expect(document.activeElement).toBe(node);
    expect(
      current.root.querySelector('.aic-context-sphere-node[data-node-id="b"]'),
    ).toBe(node);
    expect([node.style.left, node.style.top]).toEqual(initialPosition);
    current.root
      .querySelector<HTMLButtonElement>(".aic-context-sphere-pin")!
      .click();
    expect(current.onPin).toHaveBeenCalledExactlyOnceWith("b", true);
    expect(current.onOpen).toHaveBeenCalledTimes(1);
    current.root
      .querySelector<HTMLButtonElement>(
        '.aic-context-sphere-file[data-node-id="c"] .aic-context-sphere-file-pin',
      )!
      .click();
    expect(current.onPin).toHaveBeenLastCalledWith("c", true);
    expect(current.onOpen).toHaveBeenCalledTimes(1);
    current.setState({ expanded: false });
    expect(document.activeElement).toBe(current.toggle);
  });

  it("provides distinct file/note, missing analysis, change, open and pin states", () => {
    const current = mount({ expanded: true });
    current.update({
      ...graph([
        file("a", { pinned: true, open: true, changed: true }),
        file("b", { kind: "note", analysis: "partial" }),
        file("c", { analysis: "unavailable", provisional: true }),
      ]),
      limited: true,
    });
    const node = (id: string) =>
      current.root.querySelector<HTMLButtonElement>(
        `.aic-context-sphere-node[data-node-id="${id}"]`,
      )!;
    expect(node("a").dataset.linked).toBe("true");
    expect(node("a").dataset.changed).toBe("true");
    expect(node("a").dataset.pinned).toBe("true");
    expect(node("a").getAttribute("aria-label")).toContain(
      "open · changed · pinned",
    );
    expect(node("b").dataset.kind).toBe("note");
    expect(node("b").getAttribute("aria-label")).toContain(
      "analysis incomplete",
    );
    expect(node("c").dataset.linked).toBe("false");
    expect(node("c").textContent).toBe("?");
    expect(node("c").getAttribute("aria-label")).toContain(
      "analysis unavailable",
    );
    expect(current.root.textContent).toContain("Showing a bounded context");
  });

  it("moves only from its dedicated handle, persists normalized coordinates and stays inside resized bounds", () => {
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const current = mount({ expanded: true, position: { x: 0.5, y: 0.5 } });
    current.update(graph());
    const node = current.root.querySelector<HTMLButtonElement>(
      ".aic-context-sphere-node",
    )!;
    expect(pointer(node, "pointerdown").defaultPrevented).toBe(false);
    expect(current.onStateChange).not.toHaveBeenCalled();
    expect(pointer(current.handle, "pointerdown").defaultPrevented).toBe(true);
    pointer(current.handle, "pointermove", { clientX: 2000, clientY: -2000 });
    pointer(current.handle, "pointerup");
    expect(current.onStateChange).toHaveBeenLastCalledWith({
      expanded: true,
      position: { x: 1, y: 0 },
    });
    current.setWidth(150);
    resized!();
    const dock = current.root.querySelector<HTMLElement>(
      ".aic-context-sphere-dock",
    )!;
    expect(Number.parseFloat(dock.style.left)).toBeGreaterThanOrEqual(0);
    expect(
      Number.parseFloat(dock.style.left) + Number.parseFloat(dock.style.width),
    ).toBeLessThanOrEqual(150);
    current.handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(current.onStateChange).toHaveBeenLastCalledWith({
      expanded: true,
      position: { x: 0.5, y: 0.5 },
    });
    current.handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(current.onStateChange).toHaveBeenLastCalledWith({
      expanded: true,
      position: { x: 0.55, y: 0.5 },
    });
    current.setState({ position: { x: -10, y: 10 } });
    expect(Number.parseFloat(dock.style.left)).toBe(8);
    current.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each([150, 320])(
    "does not overlap projected nodes at panel width %i",
    (width) => {
      const current = mount({ expanded: true });
      current.setWidth(width);
      current.setState({ expanded: true });
      current.update(
        graph(Array.from({ length: 48 }, (_, index) => file(String(index)))),
      );
      const nodes = [
        ...current.root.querySelectorAll<HTMLButtonElement>(
          ".aic-context-sphere-node",
        ),
      ];
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const first = nodes[a]!,
            second = nodes[b]!;
          const distance = Math.hypot(
            Number.parseFloat(first.style.left) -
              Number.parseFloat(second.style.left),
            Number.parseFloat(first.style.top) -
              Number.parseFloat(second.style.top),
          );
          expect(distance).toBeGreaterThanOrEqual(
            Number.parseFloat(first.style.width) - 0.01,
          );
        }
      }
    },
  );

  it("uses a finite active-file rotation, respects reduced motion, and cancels work on disposal", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    let requestId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.set(++requestId, callback);
      return requestId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });
    const current = mount({ expanded: true });
    const input = graph();
    current.update(input);
    expect(callbacks.size).toBe(0);
    current.update({ ...input, activeId: "b" });
    expect(current.root.dataset.rotating).toBe("true");
    for (let time = 0; time <= 600; time += 100) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(time));
    }
    expect(current.root.dataset.rotating).toBe("false");
    expect(callbacks.size).toBe(0);
    current.update({ ...input, activeId: "c" });
    expect(callbacks.size).toBe(1);
    const toggle = current.toggle;
    current.dispose();
    expect(callbacks.size).toBe(0);
    toggle.click();
    current.update(input);
    current.setState({ expanded: true });
    current.dispose();
    expect(current.host.children).toHaveLength(0);
    expect(current.onStateChange).not.toHaveBeenCalled();
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const reduced = mount({ expanded: true });
    reduced.update(input);
    reduced.update({ ...input, activeId: "b" });
    expect(callbacks.size).toBe(0);
    expect(reduced.root.dataset.rotating).toBe("false");
  });
});
