import { vi } from "vitest";

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number;
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

Object.defineProperty(globalThis, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("dark") ? false : true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const emptyRect = () => new DOMRect(0, 0, 0, 0);
const emptyRectList = () => {
  const rectangles: DOMRect[] = [];
  return Object.assign(rectangles, {
    item: (index: number) => rectangles[index] ?? null,
  }) as unknown as DOMRectList;
};

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = emptyRect;
}

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = emptyRectList;
}

if (!HTMLElement.prototype.getBoundingClientRect) {
  HTMLElement.prototype.getBoundingClientRect = emptyRect;
}

if (!HTMLElement.prototype.getClientRects) {
  HTMLElement.prototype.getClientRects = emptyRectList;
}

type SvgMetricsPrototype = typeof SVGElement.prototype & {
  getBBox?: () => DOMRect;
  getComputedTextLength?: () => number;
};

const svgMetrics = SVGElement.prototype as SvgMetricsPrototype;

if (!svgMetrics.getBBox) {
  svgMetrics.getBBox = function getBBox(this: SVGElement) {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, (this.textContent?.length ?? 0) * 8),
      height: 16,
    } as DOMRect;
  };
}

if (!svgMetrics.getComputedTextLength) {
  svgMetrics.getComputedTextLength = function getComputedTextLength(
    this: SVGElement,
  ) {
    return Math.max(1, (this.textContent?.length ?? 0) * 8);
  };
}
