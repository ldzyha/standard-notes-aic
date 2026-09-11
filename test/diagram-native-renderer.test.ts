import { afterEach, describe, expect, it, vi } from "vitest";
import { bindDiagramSvg, mapDiagramSvg } from "../src/core/diagram-renderer.js";
import { createDiagramBuilder } from "../src/core/diagram-builder.js";
import { parseDiagram } from "../src/core/diagram-model.js";
import { activate, renderDiagramFixture } from "./diagram-svg-fixture";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});
function read(source: string) {
  const parsed = parseDiagram(source);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.model;
}
async function open(
  source: string,
  options: Partial<Parameters<typeof createDiagramBuilder>[1]> = {},
) {
  const builder = createDiagramBuilder(document, {
    source,
    render: renderDiagramFixture,
    ...options,
  });
  cleanups.push(builder.destroy);
  document.body.append(builder.element);
  await builder.whenRendered();
  return builder;
}
function click(
  builder: ReturnType<typeof createDiagramBuilder>,
  label: string,
) {
  activate(builder.element.querySelector(`[aria-label="${label}"]`)!);
}

describe("native Mermaid canvas binding", () => {
  it("accepts a void clipboard callback and reports rejected copy without losing the draft", async () => {
    const onCopy = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    const builder = await open("flowchart LR\n A", { onCopy });
    click(builder, "Copy Mermaid source");
    await vi.waitFor(() =>
      expect(
        builder.element.querySelector('[aria-label="Copied"]'),
      ).not.toBeNull(),
    );
    activate(builder.element.querySelector('[aria-label="Copied"]')!);
    await vi.waitFor(() =>
      expect(
        builder.element.querySelector(".aic-db-status")!.textContent,
      ).toContain("Could not copy"),
    );
    expect(
      builder.element.querySelector<HTMLElement>(".aic-db-footer")!.hidden,
    ).toBe(false);
    expect(builder.getSource()).toBe("flowchart LR\n A");
  });
  it.each([
    'flowchart LR\n A["Same"] --> B["Same"]\n A -.-> B',
    "classDiagram\n class A\n class B\n A --> B",
    "sequenceDiagram\n actor A\n participant B\n A->>B: First\n B-->>A: Reply\n A->>A: Self",
  ])(
    "maps semantic identities and uses the actual geometry: %s",
    async (source) => {
      const model = read(source);
      const holder = document.createElement("div");
      holder.innerHTML = await renderDiagramFixture(source);
      document.body.append(holder);
      const svg = holder.querySelector("svg")!;
      const mapping = mapDiagramSvg(svg, model);
      const geometries = [...mapping.edges.values()].map((path) =>
        Object.fromEntries(
          ["d", "x1", "y1", "x2", "y2", "transform"].map((name) => [
            name,
            path.getAttribute(name),
          ]),
        ),
      );
      const onSelect = vi.fn();
      const onConnect = vi.fn();
      bindDiagramSvg(svg, model, { onSelect, onConnect });
      expect(svg.querySelectorAll(".aic-db-node")).toHaveLength(
        model.nodes.length,
      );
      const hits = [...svg.querySelectorAll(".aic-db-edge-hit")];
      expect(hits).toHaveLength(model.edges.length);
      expect(
        hits.map((path) =>
          Object.fromEntries(
            ["d", "x1", "y1", "x2", "y2", "transform"].map((name) => [
              name,
              path.getAttribute(name),
            ]),
          ),
        ),
      ).toEqual(geometries);
      activate(hits[0]!);
      expect(onSelect).toHaveBeenCalledWith(`edge:${model.edges[0]!.id}`);
      activate(svg.querySelector(".aic-db-port")!);
      expect(onConnect).toHaveBeenCalledWith(expect.any(Event), "A");
    },
  );

  it("fails closed when rendered identities no longer match the supported source model", async () => {
    const source = "flowchart LR\n A --> B";
    const builder = await open(source, {
      render: async () =>
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g class="node" id="unexpected"/></svg>',
    });
    expect(builder.element.dataset.renderState).toBe("error");
    expect(
      builder.element.querySelector<HTMLTextAreaElement>(".aic-db-source")!
        .hidden,
    ).toBe(false);
    expect(
      builder.element.querySelector(".aic-db-source-notice")!.textContent,
    ).toContain("Cannot safely locate");
    expect(builder.getSource()).toBe(source);
  });

  it("drops legacy coordinates only on semantic editing, never on opening or no-op fields", async () => {
    const source =
      'flowchart LR\n A["Start"]\n %% aic-builder-layout {"version":1,"nodes":{"A":{"x":300,"y":500}}}\n';
    const onApply = vi.fn();
    const builder = await open(source, { onApply });
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    const label = builder.element.querySelector<HTMLInputElement>(
      '[aria-label="Label"]',
    )!;
    label.dispatchEvent(new Event("input", { bubbles: true }));
    expect(builder.getSource()).toBe(source);
    builder.apply();
    expect(onApply).toHaveBeenCalledWith(source);
    label.value = "Updated";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    await builder.whenRendered();
    expect(builder.getSource()).not.toContain("aic-builder-layout");
    expect(read(builder.getSource()).nodes[0]).not.toHaveProperty("x");
    click(builder, "Undo diagram change");
    expect(builder.getSource()).toBe(source);
  });

  it("keeps field focus and rejects a superseded async SVG without replacing the new graph", async () => {
    let resolveOld!: (svg: string) => void;
    let calls = 0;
    const old = new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
    const render = vi.fn((source: string) =>
      ++calls === 1 ? old : renderDiagramFixture(source),
    );
    const builder = createDiagramBuilder(document, {
      source: 'flowchart LR\n A["Start"]',
      render,
    });
    cleanups.push(builder.destroy);
    document.body.append(builder.element);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    click(builder, "Add state");
    const label = builder.element.querySelector<HTMLInputElement>(
      '[aria-label="Label"]',
    )!;
    label.focus();
    label.setSelectionRange(1, 1);
    expect(await builder.whenRendered()).toBe(true);
    expect(document.activeElement).toBe(label);
    expect(label.selectionStart).toBe(1);
    const revision = builder.element.dataset.renderRevision;
    resolveOld(await renderDiagramFixture('flowchart LR\n A["Start"]'));
    await Promise.resolve();
    await Promise.resolve();
    expect(builder.element.dataset.renderRevision).toBe(revision);
    expect(builder.element.querySelectorAll("[data-node-id]")).toHaveLength(2);
    builder.destroy();
    expect(builder.element.isConnected).toBe(false);
  });

  it("copies the current local draft and blocks stale Apply without throwing it away", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onApply = vi.fn();
    const builder = await open("flowchart LR\n A", { onApply });
    click(builder, "Add state");
    builder.setApplyBlocked(
      "The document changed; copy your draft before closing.",
    );
    expect(builder.apply()).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    click(builder, "Copy Mermaid source");
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(builder.getSource()),
    );
    expect(read(builder.getSource()).nodes).toHaveLength(2);
    expect(
      builder.element.querySelector<HTMLButtonElement>(
        '[aria-label="Apply diagram changes"]',
      )!.disabled,
    ).toBe(true);
  });

  it("keeps read-only port gestures inert while permitting inspection", async () => {
    const source = "flowchart LR\n A --> B";
    const builder = await open(source, { readOnly: true });
    click(builder, "Connect A");
    click(builder, "Connect B");
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    expect(
      builder.element.querySelector<HTMLInputElement>('[aria-label="Label"]')!
        .disabled,
    ).toBe(true);
    expect(builder.getSource()).toBe(source);
    expect(builder.apply()).toBe(false);
  });
});
