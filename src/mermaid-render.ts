import { mermaidLimitError } from "./mermaid-source";
import {
  createIconButton,
  showIconFeedback,
  writeTextToClipboard,
} from "./core/structured-preview.js";
import { createMermaidViewport } from "./core/mermaid-viewport.js";
import {
  renderMermaidSvg as renderSharedMermaidSvg,
  sanitizeMermaidSvg as sanitizeSharedMermaidSvg,
} from "./core/mermaid-runtime.js";
export { mermaidConfig } from "./core/mermaid-runtime.js";

export type MermaidTheme = "dark" | "default";

export function sanitizeMermaidSvg(
  svg: string,
  document: Document = globalThis.document,
): string {
  return sanitizeSharedMermaidSvg(svg, document);
}

import { makeMermaidRenderQueue } from "./core/render-queue.js";
export { makeMermaidRenderQueue } from "./core/render-queue.js";

export async function renderMermaidSvg({
  source,
  theme = "default",
  document = globalThis.document,
  signal,
}: {
  source: string;
  theme?: MermaidTheme;
  document?: Document;
  signal?: AbortSignal;
}): Promise<string> {
  const limit = mermaidLimitError(source);
  if (limit) throw limit;
  return renderSharedMermaidSvg(document, { source, theme, signal });
}

export function mermaidDiagnostic(error: unknown) {
  const detail = String(
    error instanceof Error ? error.message : error || "Unknown Mermaid error",
  ).trim();
  const line = detail.match(
    /(?:parse error on|at)?\s*line\s*[:#]?\s*(\d+)(?::(\d+))?/iu,
  );
  const column = detail.match(/(?:column|col)\s*[:#]?\s*(\d+)/iu);
  return Object.freeze({
    summary: /limit(?:ed)? to/iu.test(detail)
      ? "This diagram is too large to render safely."
      : "Mermaid could not render this diagram.",
    detail,
    line: line?.[1] ? Number(line[1]) : null,
    column: line?.[2]
      ? Number(line[2])
      : column?.[1]
        ? Number(column[1])
        : null,
  });
}

export type MermaidPreviewController = Readonly<{
  element: HTMLElement;
  update: (source: string, theme?: MermaidTheme) => Promise<boolean>;
  destroy: () => boolean;
}>;

export function createMermaidPreview({
  source,
  theme,
  onEdit,
  onCut,
  render = renderMermaidSvg,
  queue,
  document = globalThis.document,
}: {
  source: string;
  theme: MermaidTheme;
  onEdit?: () => void;
  onCut?: () => boolean | void | Promise<boolean | void>;
  render?: typeof renderMermaidSvg;
  queue?: ReturnType<typeof makeMermaidRenderQueue>;
  document?: Document;
}): MermaidPreviewController {
  const figure = document.createElement("figure");
  figure.className = "cm-mermaid-inline";
  figure.setAttribute("aria-label", "Mermaid diagram preview");
  const caption = document.createElement("figcaption");
  const label = document.createElement("span");
  label.textContent = "Mermaid";
  let currentSource = source;
  const actions = document.createElement("span");
  actions.className = "cm-md-preview-actions";
  const copy = createIconButton(document, {
    label: "Copy Mermaid source",
    icon: "copy",
    className: "cm-mermaid-copy cm-md-edit-source",
    onActivate: async (button) => {
      if (!(await writeTextToClipboard(currentSource, document))) return;
      showIconFeedback(button, { restoreLabel: "Copy Mermaid source" });
    },
  });
  const edit = onEdit
    ? createIconButton(document, {
        label: "Edit Mermaid source",
        icon: "edit",
        className: "cm-mermaid-edit cm-md-edit-source",
        onActivate: onEdit,
      })
    : null;
  const cut = onCut
    ? createIconButton(document, {
        label: "Cut Mermaid block",
        icon: "cut",
        className: "cm-mermaid-cut cm-md-edit-source",
        onActivate: onCut,
      })
    : null;
  const viewportController = createMermaidViewport(document);
  actions.append(
    copy,
    ...(edit ? [edit] : []),
    ...(cut ? [cut] : []),
    viewportController.controls,
  );
  caption.append(label, actions);
  const canvas = viewportController.viewport;
  canvas.classList.add("cm-mermaid-canvas");
  canvas.setAttribute("role", "region");
  canvas.setAttribute("aria-label", "Rendered Mermaid diagram");
  figure.append(caption, canvas);

  let epoch = 0;
  let destroyed = false;
  let activeAbort: AbortController | null = null;

  const update = async (
    nextSource: string,
    nextTheme: MermaidTheme = theme,
  ) => {
    if (destroyed) return false;
    currentSource = nextSource;
    const token = ++epoch;
    activeAbort?.abort();
    const abort = new AbortController();
    activeAbort = abort;
    figure.setAttribute("aria-busy", "true");
    const loading = document.createElement("span");
    loading.className = "cm-mermaid-loading";
    loading.textContent = "Rendering diagram…";
    if (!viewportController.stage.querySelector("svg"))
      viewportController.replaceContent(loading);
    try {
      const task = () =>
        render({
          source: nextSource,
          theme: nextTheme,
          document,
          signal: abort.signal,
        });
      // The shared runtime already owns the engine queue. A queue is injectable
      // only for host tests/custom renderers, never stacked in normal operation.
      const svg = await (queue
        ? queue.schedule(task, { signal: abort.signal })
        : task());
      if (destroyed || token !== epoch) return false;
      activeAbort = null;
      const holder = document.createElement("div");
      holder.innerHTML = svg;
      const diagram = holder.firstElementChild ?? holder;
      diagram.setAttribute("inert", "");
      diagram.setAttribute("aria-hidden", "true");
      viewportController.replaceContent(diagram);
      figure.setAttribute("aria-busy", "false");
      return true;
    } catch (error) {
      if (
        destroyed ||
        token !== epoch ||
        (error instanceof Error && error.name === "AbortError")
      )
        return false;
      activeAbort = null;
      const diagnostic = mermaidDiagnostic(error);
      const card = document.createElement("div");
      card.className = "cm-mermaid-error";
      const summary = document.createElement("strong");
      summary.textContent = diagnostic.summary;
      const detail = document.createElement("pre");
      detail.textContent = diagnostic.detail;
      card.append(summary, detail);
      viewportController.replaceContent(card);
      figure.setAttribute("aria-busy", "false");
      return false;
    }
  };

  void update(source, theme);
  return Object.freeze({
    element: figure,
    update,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      epoch++;
      activeAbort?.abort();
      activeAbort = null;
      viewportController.destroy();
      figure.setAttribute("aria-busy", "false");
      return true;
    },
  });
}
