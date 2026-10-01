function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function svgSize(svg) {
  const viewBox = String(svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    viewBox.length === 4 &&
    viewBox.every(Number.isFinite) &&
    positive(viewBox[2]) &&
    positive(viewBox[3])
  )
    return { width: viewBox[2], height: viewBox[3] };

  // Percentages describe the host, not the diagram's intrinsic dimensions.
  const length = (name) => {
    const value = String(svg.getAttribute(name) || "").trim();
    return /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u.test(value)
      ? Number.parseFloat(value)
      : 0;
  };
  const width = length("width");
  const height = length("height");
  return positive(width) && positive(height)
    ? { width, height, needsViewBox: true }
    : null;
}

function viewportWidth(viewport, document) {
  const measured =
    viewport.clientWidth || viewport.getBoundingClientRect?.().width || 0;
  const style = document.defaultView?.getComputedStyle?.(viewport);
  const padding =
    (Number.parseFloat(style?.paddingLeft) || 0) +
    (Number.parseFloat(style?.paddingRight) || 0);
  return Math.max(0, measured - padding);
}

function pixels(value) {
  return `${Math.round(value * 1000) / 1000}px`;
}

// Shared by every host: preserve the SVG's natural size, shrink only when the
// editor is narrower, and let the document own all vertical scrolling.
export function createMermaidViewport(document) {
  if (!document?.createElement)
    throw new TypeError("createMermaidViewport requires a document");
  const viewport = document.createElement("div");
  viewport.className = "cm-aic-mermaid-viewport";
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Rendered Mermaid diagram");
  const stage = document.createElement("div");
  stage.className = "cm-aic-mermaid-stage";
  viewport.appendChild(stage);
  let destroyed = false;
  let frame = 0;
  const win = document.defaultView;
  const reset = () => {
    stage.style.removeProperty("width");
    stage.style.removeProperty("height");
    stage.style.removeProperty("--aic-mermaid-source-width");
    stage.style.removeProperty("--aic-mermaid-source-height");
  };
  const layout = () => {
    if (destroyed) return false;
    const svg = stage.querySelector("svg");
    const size = svg && svgSize(svg);
    // Loading and error content have no intrinsic diagram to fit. Avoid forcing
    // an editor layout while the renderer is still working or showing a failure.
    if (!size) {
      reset();
      return false;
    }
    // CSS dimensions alone crop SVGs without a viewBox. Establish the validated
    // intrinsic coordinates so the fallback scales the entire drawing too.
    if (size.needsViewBox)
      svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    const available = viewportWidth(viewport, document);
    if (!available) {
      reset();
      return false;
    }
    const width = Math.min(size.width, available);
    const height = size.height * (width / size.width);
    stage.style.width = pixels(width);
    stage.style.height = pixels(height);
    stage.style.setProperty("--aic-mermaid-source-width", pixels(width));
    stage.style.setProperty("--aic-mermaid-source-height", pixels(height));
    return true;
  };
  const scheduleLayout = () => {
    if (destroyed || frame) return;
    if (win?.requestAnimationFrame) {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        layout();
      });
    } else {
      frame = -1;
      queueMicrotask(() => {
        frame = 0;
        layout();
      });
    }
  };
  const ResizeObserver = win?.ResizeObserver;
  const observer = ResizeObserver ? new ResizeObserver(scheduleLayout) : null;
  observer?.observe(viewport);
  if (!observer) win?.addEventListener("resize", scheduleLayout);
  return Object.freeze({
    viewport,
    stage,
    replaceContent(node) {
      if (destroyed) return;
      stage.replaceChildren(...(node ? [node] : []));
      layout();
      scheduleLayout();
    },
    refresh: layout,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      observer?.disconnect();
      if (!observer) win?.removeEventListener("resize", scheduleLayout);
      if (frame > 0 && win?.cancelAnimationFrame)
        win.cancelAnimationFrame(frame);
      frame = 0;
      return true;
    },
  });
}
