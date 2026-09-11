import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: engine }));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40"/></svg>';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetModules();
  engine.initialize.mockReset();
  engine.render.mockReset().mockResolvedValue({ svg });
});

describe("one shared Mermaid runtime", () => {
  it("serializes theme initialization through completion of each render", async () => {
    const { renderMermaidSvg } = await import("../src/core/mermaid-runtime.js");
    const first = deferred<{ svg: string }>();
    engine.render.mockReturnValueOnce(first.promise);
    const a = renderMermaidSvg(document, {
      source: "flowchart LR\n A",
      theme: "dark",
    });
    const b = renderMermaidSvg(document, {
      source: "flowchart LR\n B",
      theme: "default",
    });
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    expect(
      engine.initialize.mock.calls.map(([config]) => config.theme),
    ).toEqual(["dark"]);
    first.resolve({ svg });
    await Promise.all([a, b]);
    expect(
      engine.initialize.mock.calls.map(([config]) => config.theme),
    ).toEqual(["dark", "default"]);
    expect(engine.initialize.mock.calls[0]![0]).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      sequence: { width: 100 },
    });
  });

  it("skips superseded queued keystrokes before the engine, keeping the latest render", async () => {
    const { renderMermaidSvg } = await import("../src/core/mermaid-runtime.js");
    const first = deferred<{ svg: string }>();
    engine.render.mockReturnValueOnce(first.promise);
    const active = renderMermaidSvg(document, { source: "initial" });
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    const cancelled = [];
    for (let index = 0; index < 160; index++) {
      const abort = new AbortController();
      cancelled.push(
        renderMermaidSvg(document, {
          source: `obsolete ${index}`,
          signal: abort.signal,
        }).catch((error) => error.name),
      );
      abort.abort();
    }
    const latest = renderMermaidSvg(document, { source: "latest" });
    first.resolve({ svg });
    await Promise.all([active, latest]);
    expect(await Promise.all(cancelled)).toEqual(Array(160).fill("AbortError"));
    expect(engine.render.mock.calls.map(([, source]) => source)).toEqual([
      "initial",
      "latest",
    ]);
  });

  it("sanitizes active SVG content and never activates Mermaid bindFunctions", async () => {
    const { renderMermaidSvg, sanitizeMermaidSvg } =
      await import("../src/core/mermaid-runtime.js");
    const bindFunctions = vi.fn();
    engine.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><foreignObject/><a href="https://example.com"><text>Keep</text></a></svg>',
      bindFunctions,
    });
    const clean = await renderMermaidSvg(document, {
      source: "flowchart LR\n A",
    });
    expect(clean).toContain("Keep");
    expect(clean).not.toMatch(/script|foreignObject|onload|href=/u);
    expect(bindFunctions).not.toHaveBeenCalled();
    expect(() =>
      sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/1999/xhtml"/>'),
    ).toThrow("invalid SVG");
  });
});
