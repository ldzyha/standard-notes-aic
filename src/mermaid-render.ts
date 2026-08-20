import { mermaidLimitError } from "./mermaid-source";

export type MermaidTheme = "dark" | "default";

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

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let sequence = 0;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((module) => module.default)
      .catch((error) => {
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

export function mermaidConfig(theme: MermaidTheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    theme,
    htmlLabels: false,
    flowchart: { useMaxWidth: true },
  };
}

export function sanitizeMermaidSvg(
  svg: string,
  document: Document = globalThis.document,
): string {
  const parser = new document.defaultView!.DOMParser();
  const parsed = parser.parseFromString(String(svg || ""), "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg"
  ) {
    throw new Error("Mermaid returned invalid SVG");
  }
  parsed
    .querySelectorAll("script,foreignObject,iframe,object,embed")
    .forEach((element) => element.remove());
  for (const element of parsed.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "href" || name === "xlink:href") {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new document.defaultView!.XMLSerializer().serializeToString(
    parsed.documentElement,
  );
}

export async function renderMermaidSvg({
  source,
  theme = "default",
  document = globalThis.document,
}: {
  source: string;
  theme?: MermaidTheme;
  document?: Document;
}): Promise<string> {
  const limit = mermaidLimitError(source);
  if (limit) throw limit;
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidConfig(theme));
  const result = await mermaid.render(
    `aic-standard-notes-${++sequence}`,
    source,
  );
  return sanitizeMermaidSvg(result?.svg || "", document);
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
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "cm-mermaid-edit";
  edit.textContent = "Edit source";
  caption.append(label, edit);
  const canvas = document.createElement("div");
  canvas.className = "cm-mermaid-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "button");
  canvas.setAttribute("aria-label", "Mermaid diagram; activate to edit source");
  figure.append(caption, canvas);

  let epoch = 0;
  let destroyed = false;
  let activeAbort: AbortController | null = null;

  const reveal = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    onEdit();
  };
  edit.addEventListener("click", reveal);
  canvas.addEventListener("click", reveal);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") reveal(event);
  });

  const update = async (
    nextSource: string,
    nextTheme: MermaidTheme = theme,
  ) => {
    const token = ++epoch;
    activeAbort?.abort();
    const abort = new AbortController();
    activeAbort = abort;
    figure.setAttribute("aria-busy", "true");
    canvas.replaceChildren();
    const loading = document.createElement("span");
    loading.className = "cm-mermaid-loading";
    loading.textContent = "Rendering diagram…";
    canvas.append(loading);
    try {
      const svg = await queue.schedule(
        () => render({ source: nextSource, theme: nextTheme, document }),
        {
          signal: abort.signal,
        },
      );
      if (destroyed || token !== epoch) return false;
      activeAbort = null;
      const diagram = document.createElement("div");
      diagram.className = "cm-mermaid-diagram";
      diagram.setAttribute("inert", "");
      diagram.setAttribute("aria-hidden", "true");
      diagram.innerHTML = svg;
      canvas.replaceChildren(diagram);
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
      canvas.replaceChildren(card);
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
      figure.setAttribute("aria-busy", "false");
      return true;
    },
  });
}
