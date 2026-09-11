import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDiagramFixture, activate } from "./diagram-svg-fixture";
import { createDiagramBuilder } from "../src/core/diagram-builder.js";
import { parseDiagram } from "../src/core/diagram-model.js";

const cleanups: (() => void)[] = [];
async function open(source = 'flowchart LR\n A["Start"] --> B["Finish"]') {
  const onApply = vi.fn();
  const builder = createDiagramBuilder(document, {
    source,
    onApply,
    render: renderDiagramFixture,
  });
  document.body.append(builder.element);
  cleanups.push(builder.destroy);
  await builder.whenRendered();
  return { ...builder, onApply };
}
function click(element: HTMLElement, label: string) {
  activate(element.querySelector(`[aria-label="${label}"]`)!);
}
function result(builder: Awaited<ReturnType<typeof open>>) {
  expect(builder.apply()).toBe(true);
  const parsed = parseDiagram(builder.onApply.mock.calls.at(-1)![0]);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.model;
}
function dragEvent(type: string, transfer: object, x = 0, y = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}
function transferFixture() {
  const data = new Map<string, string>();
  let protectedMode = false;
  return {
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "",
    dropEffect: "",
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      if (protectedMode) throw new Error("Protected dragover data");
      return data.get(type) || "";
    },
    protect(value: boolean) {
      protectedMode = value;
    },
  };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe("direct diagram canvas editing", async () => {
  it("selects a line itself and reverses its relation in the shared context bar", async () => {
    const builder = await open();
    const bar = builder.element.querySelector(".aic-db-inspector")!;
    const viewport = builder.element.querySelector(".aic-db-viewport")!;
    expect(
      bar.compareDocumentPosition(viewport) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    const path =
      builder.element.querySelector<SVGPathElement>(".aic-db-edge-hit")!;
    expect(path.getAttribute("role")).toBe("button");
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bar.getAttribute("aria-label")).toBe("Relationship properties");
    click(builder.element, "Reverse direction");
    expect(result(builder).edges[0]).toMatchObject({
      from: "B",
      to: "A",
      kind: "-->",
    });
    await builder.whenRendered();
    const changedPath =
      builder.element.querySelector<SVGPathElement>(".aic-db-edge-hit")!;
    changedPath.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(bar.getAttribute("aria-label")).toBe("Relationship properties");
  });

  it("drops a palette module semantically without persisting manual positions", async () => {
    const builder = await open();
    const palette = builder.element.querySelector(".aic-diagram-palette")!;
    const module = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Add condition"]',
    )!;
    const transfer = transferFixture();
    module.dispatchEvent(dragEvent("dragstart", transfer));
    const viewport =
      builder.element.querySelector<HTMLElement>(".aic-db-viewport")!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(20, 30, 400, 300),
    );
    viewport.scrollLeft = 100;
    viewport.scrollTop = 50;
    click(builder.element, "Zoom in");
    transfer.protect(true);
    const over = dragEvent("dragover", transfer, 160, 100);
    viewport.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    transfer.protect(false);
    viewport.dispatchEvent(dragEvent("drop", transfer, 160, 100));
    const model = result(builder);
    expect(model.nodes.at(-1)).toMatchObject({
      kind: "diamond",
      label: "Condition",
    });
    expect(model.nodes.at(-1)).not.toHaveProperty("x");
    expect(model.nodes.at(-1)).not.toHaveProperty("y");
    expect(builder.element.querySelector(".aic-diagram-palette")).toBe(palette);
    expect(
      builder.element.querySelector('[aria-label="Add element"]'),
    ).toBeNull();
  });

  it("creates solid directed class relationships from handles", async () => {
    const builder = await open("classDiagram\n class A\n class B");
    click(builder.element, "Connect A");
    click(builder.element, "Connect B");
    expect(result(builder).edges[0]).toMatchObject({
      from: "A",
      to: "B",
      kind: "-->",
    });
  });

  it("adds sequence participants without arbitrary layout coordinates", async () => {
    const builder = await open(
      "sequenceDiagram\n participant A\n participant B",
    );
    const module = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Add actor"]',
    )!;
    const transfer = transferFixture();
    module.dispatchEvent(dragEvent("dragstart", transfer));
    const viewport =
      builder.element.querySelector<HTMLElement>(".aic-db-viewport")!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 400, 300),
    );
    viewport.dispatchEvent(dragEvent("drop", transfer, 35, 50));
    const model = result(builder);
    expect(model.nodes.map(({ label }) => label)).toEqual(["A", "B", "Actor"]);
    expect(model.nodes.at(-1)).toMatchObject({ kind: "actor" });
    expect(model.nodes[0]).not.toHaveProperty("x");
    expect(model.nodes[0]).not.toHaveProperty("y");
  });
});
