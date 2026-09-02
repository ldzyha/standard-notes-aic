import { createIconButton } from "./structured-preview.js";

export const MERMAID_VIEW = Object.freeze({
  minZoom: 50,
  maxZoom: 400,
  zoomStep: 25,
  quarterTurn: 90,
});

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function svgAspectRatio(svg) {
  const viewBox = String(svg?.getAttribute?.("viewBox") || "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    viewBox.length === 4 &&
    Number.isFinite(viewBox[2]) &&
    Number.isFinite(viewBox[3]) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    return viewBox[2] / viewBox[3];
  }
  const width = Number.parseFloat(svg?.getAttribute?.("width") || "");
  const height = Number.parseFloat(svg?.getAttribute?.("height") || "");
  return positive(width, 1) / positive(height, 1);
}

function viewportWidth(viewport, document) {
  const measured =
    viewport.clientWidth || viewport.getBoundingClientRect?.().width || 0;
  const win = document.defaultView;
  if (!win?.getComputedStyle) return positive(measured, 1);
  const style = win.getComputedStyle(viewport);
  const horizontalPadding =
    Number.parseFloat(style.paddingLeft || "0") +
    Number.parseFloat(style.paddingRight || "0");
  return positive(measured - horizontalPadding, 1);
}

function pixels(value) {
  return `${Math.max(1, Math.round(value * 1000) / 1000)}px`;
}

// Dependency-free viewport behavior shared byte-for-byte by the VS Code and
// Standard Notes adapters. The stage owns the transformed diagram's real
// layout bounds, so browser scrolling remains correct after zoom or rotation.
export function createMermaidViewport(document, options = {}) {
  if (!document?.createElement)
    throw new TypeError("createMermaidViewport requires a document");

  const minZoom = positive(options.minZoom, MERMAID_VIEW.minZoom);
  const maxZoom = Math.max(
    minZoom,
    positive(options.maxZoom, MERMAID_VIEW.maxZoom),
  );
  const zoomStep = positive(options.zoomStep, MERMAID_VIEW.zoomStep);
  const viewport = document.createElement("div");
  viewport.className = "cm-aic-mermaid-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Scrollable Mermaid diagram");
  const stage = document.createElement("div");
  stage.className = "cm-aic-mermaid-stage";
  viewport.appendChild(stage);
  const controls = document.createElement("span");
  controls.className = "cm-aic-mermaid-controls";

  let zoom = 100;
  let rotation = 0;
  let destroyed = false;
  let frame = 0;
  const win = document.defaultView;

  const layout = () => {
    if (destroyed) return false;
    const svg = stage.querySelector("svg");
    stage.dataset.zoom = String(zoom);
    stage.dataset.rotation = String(rotation);
    if (!svg) {
      stage.style.width = "100%";
      stage.style.height = "auto";
      stage.style.removeProperty("--aic-mermaid-source-width");
      stage.style.removeProperty("--aic-mermaid-source-height");
      stage.style.setProperty("--aic-mermaid-rotation", `${rotation}deg`);
      return false;
    }

    const ratio = positive(svgAspectRatio(svg), 1);
    const fitted = viewportWidth(viewport, document) * (zoom / 100);
    const sideways = rotation % 180 !== 0;
    // Fit and zoom the source in its original direction exactly once. A
    // quarter-turn only swaps the resulting layout bounds; fitting the
    // rotated width again would multiply a wide diagram by its aspect ratio
    // and make repeated zoom/rotation grow exponentially.
    const sourceWidth = fitted;
    const sourceHeight = fitted / ratio;
    const boundsWidth = sideways ? sourceHeight : sourceWidth;
    const boundsHeight = sideways ? sourceWidth : sourceHeight;
    stage.style.width = pixels(boundsWidth);
    stage.style.height = pixels(boundsHeight);
    stage.style.setProperty("--aic-mermaid-source-width", pixels(sourceWidth));
    stage.style.setProperty(
      "--aic-mermaid-source-height",
      pixels(sourceHeight),
    );
    stage.style.setProperty("--aic-mermaid-rotation", `${rotation}deg`);
    return true;
  };

  const scheduleLayout = () => {
    if (destroyed || frame) return;
    if (win?.requestAnimationFrame) {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        layout();
      });
      return;
    }
    frame = -1;
    queueMicrotask(() => {
      frame = 0;
      layout();
    });
  };

  let zoomOut;
  let zoomIn;
  let reset;
  let rotate;
  const reflectControls = () => {
    zoomOut.disabled = zoom <= minZoom;
    zoomIn.disabled = zoom >= maxZoom;
    reset.disabled = zoom === 100 && rotation === 0;
    rotate.setAttribute(
      "aria-label",
      `Rotate diagram 90° clockwise (currently ${rotation}°)`,
    );
  };
  const apply = (nextZoom, nextRotation) => {
    zoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
    rotation = ((nextRotation % 360) + 360) % 360;
    reflectControls();
    layout();
    scheduleLayout();
  };
  const button = (label, icon, onActivate) =>
    createIconButton(document, {
      label,
      icon,
      className: "cm-aic-mermaid-control cm-md-edit-source",
      onActivate,
    });
  zoomOut = button("Zoom out", "zoom-out", () =>
    apply(zoom - zoomStep, rotation),
  );
  zoomIn = button("Zoom in", "zoom-in", () => apply(zoom + zoomStep, rotation));
  reset = button("Reset diagram view", "reset", () => apply(100, 0));
  rotate = button("Rotate diagram 90° clockwise", "rotate", () =>
    apply(zoom, rotation + MERMAID_VIEW.quarterTurn),
  );
  controls.append(zoomOut, zoomIn, reset, rotate);
  reflectControls();

  const ResizeObserver = win?.ResizeObserver;
  const observer = ResizeObserver
    ? new ResizeObserver(() => scheduleLayout())
    : null;
  observer?.observe(viewport);

  return Object.freeze({
    viewport,
    stage,
    controls,
    replaceContent(node) {
      stage.replaceChildren(...(node ? [node] : []));
      layout();
      scheduleLayout();
    },
    refresh: layout,
    get state() {
      return Object.freeze({ zoom, rotation });
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      observer?.disconnect();
      if (frame > 0 && win?.cancelAnimationFrame)
        win.cancelAnimationFrame(frame);
      frame = 0;
      return true;
    },
  });
}
