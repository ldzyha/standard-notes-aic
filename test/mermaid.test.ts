import { describe, expect, it, vi } from "vitest";
import {
  createMermaidPreview,
  makeMermaidRenderQueue,
  mermaidConfig,
  mermaidDiagnostic,
  renderMermaidSvg,
  sanitizeMermaidSvg,
} from "../src/mermaid-render";
import {
  MERMAID_LIMITS,
  mermaidFences,
  mermaidLimitError,
  scanMermaidCandidates,
} from "../src/mermaid-source";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Mermaid source scanning", () => {
  it("finds backtick and tilde fences with exact source", () => {
    const source =
      "before\n```mermaid title\nflowchart LR\n  A --> B\n```\n~~~MERMAID\nsequenceDiagram\n~~~\n";
    const candidates = mermaidFences(source);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      source: "flowchart LR\n  A --> B\n",
      closed: true,
      line: 2,
    });
    expect(candidates[1]).toMatchObject({
      source: "sequenceDiagram\n",
      closed: true,
      line: 6,
    });
  });

  it("does not derive a preview from an empty or unclosed fence", () => {
    expect(scanMermaidCandidates("```mermaid\n```\n").candidates).toHaveLength(
      0,
    );
    expect(
      scanMermaidCandidates("```mermaid\nflowchart LR").candidates,
    ).toHaveLength(0);
  });

  it("bounds document scanning and candidate count", () => {
    const oversized = "x".repeat(MERMAID_LIMITS.documentCharacters + 1);
    expect(scanMermaidCandidates(oversized)).toMatchObject({
      limited: true,
      reason: "documentCharacters",
      candidates: [],
    });
    const many = Array.from(
      { length: MERMAID_LIMITS.candidates + 1 },
      (_, index) => `\`\`\`mermaid\nflowchart LR\nA${index}-->B\n\`\`\``,
    ).join("\n");
    const scan = scanMermaidCandidates(many);
    expect(scan).toMatchObject({ limited: true, reason: "candidates" });
    expect(scan.candidates).toHaveLength(MERMAID_LIMITS.candidates);
  });

  it("reports per-diagram character and line limits", () => {
    expect(
      mermaidLimitError("x".repeat(MERMAID_LIMITS.characters + 1)),
    ).toHaveProperty("message", expect.stringContaining("50,000 characters"));
    expect(
      mermaidLimitError("x\n".repeat(MERMAID_LIMITS.lines)),
    ).toHaveProperty("message", expect.stringContaining("10,000 lines"));
    expect(mermaidLimitError("flowchart LR\nA-->B")).toBeNull();
  });
});

describe("Mermaid rendering boundary", () => {
  it("uses SVG text labels that survive the strict sanitizer", () => {
    const config = mermaidConfig("default");
    expect(config).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { useMaxWidth: true },
    });
    expect(config.flowchart).not.toHaveProperty("htmlLabels");
  });

  it("renders a real diagram with the pinned strict runtime", async () => {
    for (const theme of ["default", "dark"] as const) {
      const svg = await renderMermaidSvg({
        source: "flowchart LR\n  Markdown --> AIC",
        theme,
      });
      expect(svg).toMatch(/^<svg/u);
      expect(svg).toContain("Markdown");
      expect(svg).toContain("AIC");
      expect(svg).toContain("<text");
      expect(svg).not.toMatch(/<script|<foreignObject|onload=|href=/u);
    }
  });

  it("serializes jobs and rejects an overflowing queue", async () => {
    const queue = makeMermaidRenderQueue({ concurrency: 1, maxPending: 1 });
    const first = deferred<string>();
    const one = queue.schedule(() => first.promise);
    const two = queue.schedule(() => "two");
    await expect(queue.schedule(() => "three")).rejects.toThrow(
      "limited to 1 pending",
    );
    expect(queue.state()).toEqual({ active: 1, pending: 1 });
    first.resolve("one");
    await expect(one).resolves.toBe("one");
    await expect(two).resolves.toBe("two");
    expect(queue.state()).toEqual({ active: 0, pending: 0 });
  });

  it("cancels superseded pending work immediately", async () => {
    const queue = makeMermaidRenderQueue({ concurrency: 1, maxPending: 2 });
    const first = deferred<void>();
    const active = queue.schedule(() => first.promise);
    const abort = new AbortController();
    const pending = queue.schedule(() => "stale", { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.state()).toEqual({ active: 1, pending: 0 });
    first.resolve();
    await active;
  });

  it("removes active content and navigation from rendered SVG", () => {
    const unsafe =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><a href="https://example.com"><text>safe</text></a><foreignObject>bad</foreignObject></svg>';
    const clean = sanitizeMermaidSvg(unsafe);
    expect(clean).toContain("safe");
    expect(clean).not.toMatch(/script|foreignObject|onload|href=/u);
    expect(() => sanitizeMermaidSvg("<div>not svg</div>")).toThrow(
      "invalid SVG",
    );
  });

  it("keeps only the newest preview result and exposes source editing", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const onEdit = vi.fn();
    const render = vi.fn(({ source }: { source: string }) =>
      source === "first" ? first.promise : second.promise,
    );
    const preview = createMermaidPreview({
      source: "first",
      theme: "default",
      onEdit,
      render,
      queue: makeMermaidRenderQueue({ concurrency: 2 }),
    });
    await Promise.resolve();
    const newest = preview.update("second", "dark");
    second.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>second</text></svg>',
    );
    await expect(newest).resolves.toBe(true);
    first.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>first</text></svg>',
    );
    await Promise.resolve();
    expect(preview.element.textContent).toContain("second");
    expect(preview.element.textContent).not.toContain("first");
    preview.element
      .querySelector<HTMLButtonElement>(".cm-mermaid-edit")!
      .click();
    expect(onEdit).toHaveBeenCalledOnce();
    const canvas =
      preview.element.querySelector<HTMLElement>(".cm-mermaid-canvas")!;
    expect(canvas.getAttribute("role")).toBe("region");
    expect(canvas.tabIndex).toBe(-1);
    canvas.click();
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onEdit).toHaveBeenCalledOnce();
    expect(preview.destroy()).toBe(true);
    expect(preview.destroy()).toBe(false);
  });

  it("turns parser locations into a stable diagnostic", () => {
    expect(
      mermaidDiagnostic(new Error("Parse error on line 7 column 3")),
    ).toMatchObject({ line: 7, column: 3 });
  });
});
