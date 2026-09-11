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

function abortError(): Error {
  const error = new Error("Mermaid render was superseded");
  error.name = "AbortError";
  return error;
}

type QueueJob<T> = {
  task: () => Promise<T> | T;
  signal: AbortSignal | null;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  active: boolean;
  settled: boolean;
  abort: () => void;
};

export function makeMermaidRenderQueue({
  concurrency = 1,
  maxPending = 128,
} = {}) {
  const activeLimit = Math.max(1, Math.trunc(concurrency));
  const pendingLimit = Math.max(1, Math.trunc(maxPending));
  const pending: QueueJob<unknown>[] = [];
  let active = 0;

  const drain = () => {
    while (active < activeLimit && pending.length) {
      const job = pending.shift()!;
      if (job.settled) {
        job.signal?.removeEventListener("abort", job.abort);
        continue;
      }
      if (job.signal?.aborted) {
        job.settled = true;
        job.reject(abortError());
        continue;
      }
      active++;
      job.active = true;
      Promise.resolve()
        .then(job.task)
        .then(
          (value) => {
            if (job.settled) return;
            job.settled = true;
            if (job.signal?.aborted) job.reject(abortError());
            else job.resolve(value);
          },
          (error) => {
            if (job.settled) return;
            job.settled = true;
            job.reject(job.signal?.aborted ? abortError() : error);
          },
        )
        .finally(() => {
          job.signal?.removeEventListener("abort", job.abort);
          active--;
          drain();
        });
    }
  };

  function schedule<T>(
    task: () => Promise<T> | T,
    { signal = null }: { signal?: AbortSignal | null } = {},
  ) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (pending.filter((job) => !job.settled).length >= pendingLimit) {
      return Promise.reject(
        new Error(
          `Mermaid render queue is limited to ${pendingLimit} pending diagrams.`,
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const job: QueueJob<T> = {
        task,
        signal,
        resolve,
        reject,
        active: false,
        settled: false,
        abort: () => {},
      };
      job.abort = () => {
        if (job.settled) return;
        job.settled = true;
        reject(abortError());
        if (!job.active) {
          const index = pending.indexOf(job as QueueJob<unknown>);
          if (index >= 0) pending.splice(index, 1);
          signal?.removeEventListener("abort", job.abort);
          drain();
        }
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      pending.push(job as QueueJob<unknown>);
      drain();
    });
  }

  return Object.freeze({
    schedule,
    state: () =>
      Object.freeze({
        active,
        pending: pending.filter((job) => !job.settled).length,
      }),
  });
}

export const sharedMermaidQueue = makeMermaidRenderQueue();

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
  render = renderMermaidSvg,
  queue = sharedMermaidQueue,
  document = globalThis.document,
}: {
  source: string;
  theme: MermaidTheme;
  onEdit: () => void;
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
  const edit = createIconButton(document, {
    label: "Edit Mermaid source",
    icon: "source",
    className: "cm-mermaid-edit cm-md-edit-source",
    onActivate: () => onEdit(),
  });
  const viewportController = createMermaidViewport(document);
  actions.append(copy, edit, viewportController.controls);
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
    currentSource = nextSource;
    const token = ++epoch;
    activeAbort?.abort();
    const abort = new AbortController();
    activeAbort = abort;
    figure.setAttribute("aria-busy", "true");
    const loading = document.createElement("span");
    loading.className = "cm-mermaid-loading";
    loading.textContent = "Rendering diagram…";
    viewportController.replaceContent(loading);
    try {
      const svg = await queue.schedule(
        () =>
          render({
            source: nextSource,
            theme: nextTheme,
            document,
            signal: abort.signal,
          }),
        {
          signal: abort.signal,
        },
      );
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
