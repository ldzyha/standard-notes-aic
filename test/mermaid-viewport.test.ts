import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMermaidViewport,
  type MermaidViewportController,
} from "../src/core/mermaid-viewport.js";
import { readFile } from "node:fs/promises";

const viewportCss = await readFile("src/core/mermaid-viewport.css", "utf8");

const controllers: MermaidViewportController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fixture(initialWidth = 900) {
  const controller = createMermaidViewport(document);
  controllers.push(controller);
  document.body.append(controller.viewport);
  let width = initialWidth;
  Object.defineProperty(controller.viewport, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  return {
    controller,
    resize: (next: number) => {
      width = next;
    },
  };
}

function svg(viewBox: string, attributes: Record<string, string> = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (viewBox) node.setAttribute("viewBox", viewBox);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  return node;
}

function expectSize(
  controller: MermaidViewportController,
  width: number,
  height: number,
) {
  expect(Number.parseFloat(controller.stage.style.width)).toBeCloseTo(width, 2);
  expect(Number.parseFloat(controller.stage.style.height)).toBeCloseTo(
    height,
    2,
  );
  expect(
    controller.stage.style.getPropertyValue("--aic-mermaid-source-width"),
  ).toBe(controller.stage.style.width);
  expect(
    controller.stage.style.getPropertyValue("--aic-mermaid-source-height"),
  ).toBe(controller.stage.style.height);
}

describe("shared Mermaid viewport", () => {
  it("keeps a small diagram at its natural size inside a full-width, non-scrolling canvas", () => {
    const style = document.createElement("style");
    style.textContent = viewportCss;
    document.body.append(style);
    const { controller } = fixture();
    controller.replaceContent(svg("0 0 160 90"));
    expectSize(controller, 160, 90);
    const computed = window.getComputedStyle(controller.viewport);
    expect(computed.width).toBe("100%");
    expect(computed.maxHeight).toBe("none");
    expect(computed.overflow).toBe("visible");
    expect(controller.viewport.tabIndex).toBe(-1);
    expect(controller.viewport.getAttribute("aria-label")).toBe(
      "Rendered Mermaid diagram",
    );
    expect(controller.viewport.querySelector("button")).toBeNull();
  });

  it("retains the full height of a tall, narrow diagram", () => {
    const { controller } = fixture(320);
    controller.replaceContent(svg("0 0 160 1800"));
    expectSize(controller, 160, 1800);
  });

  it.each([320, 390])(
    "fits a wide diagram inside a padded %ipx mobile canvas",
    (width) => {
      const { controller } = fixture(width);
      controller.viewport.style.padding = "12px 16px";
      controller.replaceContent(svg("0 0 900 300"));
      expectSize(controller, width - 32, (width - 32) / 3);
    },
  );

  it("recomputes from intrinsic dimensions after narrowing and widening", () => {
    const { controller, resize } = fixture(900);
    const source = svg("-8 -8 600 300", { width: "100%", height: "100%" });
    controller.replaceContent(source);
    expectSize(controller, 600, 300);
    resize(300);
    controller.refresh();
    expectSize(controller, 300, 150);
    resize(1280);
    controller.refresh();
    expectSize(controller, 600, 300);
    expect(source.getAttribute("viewBox")).toBe("-8 -8 600 300");
    expect(source.getAttribute("width")).toBe("100%");
  });

  it.each([
    { width: "160", height: "90" },
    { width: "160px", height: "90px" },
  ])("supports absolute dimensions without a viewBox: %j", (attributes) => {
    const { controller } = fixture();
    controller.replaceContent(svg("", attributes));
    expectSize(controller, 160, 90);
  });

  it("preserves the whole drawing when absolute dimensions must shrink on mobile", () => {
    const { controller, resize } = fixture(320);
    const source = svg("", { width: "900px", height: "300px" });
    const edge = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    edge.setAttribute("x", "850");
    edge.setAttribute("width", "50");
    edge.setAttribute("height", "300");
    source.append(edge);
    controller.replaceContent(source);
    expectSize(controller, 320, 320 / 3);
    expect(source.getAttribute("viewBox")).toBe("0 0 900 300");
    expect(source.getAttribute("width")).toBe("900px");
    expect(source.querySelector("rect")?.getAttribute("x")).toBe("850");
    resize(1200);
    controller.refresh();
    expectSize(controller, 900, 300);
    expect(source.getAttribute("viewBox")).toBe("0 0 900 300");
  });

  it.each(["", "0 0 0 100", "0 0 NaN 100", "0 0 -20 100"])(
    "does not interpret percentage dimensions as an intrinsic size: %s",
    (viewBox) => {
      const { controller } = fixture();
      controller.replaceContent(svg("0 0 160 90"));
      controller.replaceContent(
        svg(viewBox, { width: "100%", height: "100%" }),
      );
      expect(controller.stage.style.width).toBe("");
      expect(controller.stage.style.height).toBe("");
      expect(
        controller.stage.style.getPropertyValue("--aic-mermaid-source-width"),
      ).toBe("");
    },
  );

  it("recalculates direct SVG replacement and clears dimensions for loading/error content", () => {
    const { controller } = fixture();
    controller.replaceContent(svg("0 0 160 1800"));
    controller.stage.querySelector("svg")!.replaceWith(svg("0 0 120 60"));
    controller.refresh();
    expectSize(controller, 120, 60);
    const error = document.createElement("p");
    error.textContent = "Correct the Mermaid source";
    controller.replaceContent(error);
    expect(controller.stage.style.width).toBe("");
    expect(controller.stage.style.height).toBe("");
    expect(controller.stage.textContent).toBe(error.textContent);
    controller.replaceContent(null);
    expect(controller.stage.childNodes).toHaveLength(0);
  });

  it("does not mutate dimensions when the diagram already fits the changed width", () => {
    const { controller, resize } = fixture(320);
    controller.replaceContent(svg("0 0 160 90"));
    const mutations = new MutationObserver(() => {});
    mutations.observe(controller.stage, { attributes: true });
    try {
      controller.refresh();
      resize(900);
      controller.refresh();
      expect(mutations.takeRecords()).toHaveLength(0);
      resize(80);
      controller.refresh();
      expectSize(controller, 80, 45);
      expect(mutations.takeRecords().length).toBeGreaterThan(0);
      controller.refresh();
      expect(mutations.takeRecords()).toHaveLength(0);
    } finally {
      mutations.disconnect();
    }
  });

  it("does not measure the editor width for loading or error content", () => {
    const { controller } = fixture();
    const measure = vi.spyOn(window, "getComputedStyle");
    const loading = document.createElement("span");
    loading.textContent = "Rendering diagram…";
    controller.replaceContent(loading);
    controller.refresh();
    expect(measure).not.toHaveBeenCalled();
  });

  it("recovers from hidden mounting through ResizeObserver and disposes pending work", () => {
    let onResize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    let pending: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pending = callback;
      return 27;
    });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const flush = () => {
      const callback = pending;
      pending = undefined;
      callback?.(0);
    };
    const { controller, resize } = fixture(0);
    controller.replaceContent(svg("0 0 160 90"));
    flush();
    expect(controller.stage.style.width).toBe("");
    expect(observe).toHaveBeenCalledWith(controller.viewport);
    resize(320);
    onResize?.();
    flush();
    expectSize(controller, 160, 90);
    resize(80);
    onResize?.();
    expect(controller.destroy()).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(27);
    flush();
    expectSize(controller, 160, 90);
    expect(controller.refresh()).toBe(false);
    controller.replaceContent(svg("0 0 20 10"));
    expect(controller.stage.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 160 90",
    );
    expect(controller.destroy()).toBe(false);
  });

  it("responds to window resize without ResizeObserver and removes its listener", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { controller, resize } = fixture(320);
    controller.replaceContent(svg("0 0 600 300"));
    resize(900);
    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => expectSize(controller, 600, 300));
    controller.destroy();
    resize(100);
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expectSize(controller, 600, 300);
  });

  it("coalesces a burst of observer notifications and sizes only the latest SVG", () => {
    let onResize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let pending: FrameRequestCallback | undefined;
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        pending = callback;
        return 42;
      });
    const { controller, resize } = fixture(0);
    controller.replaceContent(svg("0 0 160 1800"));
    for (const width of [100, 200, 300, 390]) {
      resize(width);
      onResize?.();
    }
    controller.stage.querySelector("svg")!.replaceWith(svg("0 0 600 300"));
    expect(request).toHaveBeenCalledOnce();
    pending?.(0);
    expectSize(controller, 390, 195);
  });

  it("does not apply a queued microtask after destruction without animation frames", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { controller, resize } = fixture(320);
    controller.replaceContent(svg("0 0 600 300"));
    expectSize(controller, 320, 160);
    resize(900);
    controller.destroy();
    await Promise.resolve();
    expectSize(controller, 320, 160);
  });
});
