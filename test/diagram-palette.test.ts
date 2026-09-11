import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagramPalette,
  DIAGRAM_PALETTE_MIME,
} from "../src/core/diagram-palette.js";
import type { DiagramType } from "../src/core/diagram-model.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
});

function palette(type: DiagramType = "flowchart", readOnly = false) {
  const onInsert = vi.fn();
  const controller = createDiagramPalette(document, {
    type,
    readOnly,
    onInsert,
  });
  document.body.append(controller.element);
  disposers.push(controller.destroy);
  return { ...controller, onInsert };
}

function transfer() {
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    get types() {
      return [...data.keys()];
    },
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? "";
    },
  } as unknown as DataTransfer;
  return dataTransfer;
}

function dragStart(element: HTMLElement, dataTransfer: DataTransfer) {
  const event = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
  return event;
}

describe("shared diagram element palette", () => {
  it.each([
    ["flowchart", ["rectangle", "rounded", "diamond"]],
    ["classDiagram", ["class"]],
    ["sequenceDiagram", ["participant", "actor"]],
  ] as const)(
    "provides only %s elements as accessible native buttons",
    (type, kinds) => {
      const current = palette(type);
      const buttons = [...current.element.querySelectorAll("button")];
      expect(buttons.map(({ dataset }) => dataset.diagramKind)).toEqual([
        ...kinds,
      ]);
      for (const button of buttons) {
        expect(button.type).toBe("button");
        expect(button.getAttribute("aria-label")).toMatch(/^Add /);
        expect(button.title).toContain("drag onto canvas");
        expect(button.textContent?.toLowerCase()).toBe(
          button.getAttribute("aria-label")!.slice(4),
        );
        expect(
          button.querySelector(".aic-diagram-palette-label"),
        ).not.toBeNull();
        button.dispatchEvent(
          new MouseEvent("click", { detail: 0, bubbles: true }),
        );
      }
      expect(
        current.onInsert.mock.calls.map(([element]) => element.kind),
      ).toEqual([...kinds]);
    },
  );

  it("accepts its own active drag without transferring external HTML or text", () => {
    const current = palette();
    const dataTransfer = transfer();
    const button = current.element.querySelector<HTMLElement>(
      '[data-diagram-kind="diamond"]',
    )!;
    dragStart(button, dataTransfer);
    expect(dataTransfer.types).toEqual([DIAGRAM_PALETTE_MIME]);
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(current.canDrop(dataTransfer)).toBe(true);
    expect(current.readDrop(dataTransfer)).toEqual({
      kind: "diamond",
      label: "Condition",
    });
    expect(current.onInsert).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("dragend"));
    expect(current.canDrop(dataTransfer)).toBe(false);
    expect(current.readDrop(dataTransfer)).toBeNull();
  });

  it("allows dragover with protected payload but validates the payload at drop", () => {
    const current = palette();
    const actual = transfer();
    dragStart(current.element.querySelector("button")!, actual);
    const protectedTransfer = {
      types: [DIAGRAM_PALETTE_MIME],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(current.canDrop(protectedTransfer)).toBe(true);
    expect(current.readDrop(protectedTransfer)).toBeNull();
    expect(current.readDrop(actual)).toEqual({
      kind: "rectangle",
      label: "State",
    });
  });

  it("rejects foreign documents/instances, stale sessions, and arbitrary external data", () => {
    const first = palette();
    const second = palette();
    const dataTransfer = transfer();
    const button = first.element.querySelector("button")!;
    dragStart(button, dataTransfer);
    expect(second.canDrop(dataTransfer)).toBe(false);
    expect(second.readDrop(dataTransfer)).toBeNull();
    const nextTransfer = transfer();
    dragStart(button, nextTransfer);
    expect(first.readDrop(dataTransfer)).toBeNull();
    expect(first.readDrop(nextTransfer)).toEqual({
      kind: "rectangle",
      label: "State",
    });
    const external = transfer();
    external.setData("text/html", "<script>unsafe</script>");
    external.setData("text/plain", "rectangle");
    expect(first.canDrop(external)).toBe(false);
    expect(first.readDrop(external)).toBeNull();
  });

  it.each([
    (payload: Record<string, unknown>) => ({
      ...payload,
      type: "classDiagram",
    }),
    (payload: Record<string, unknown>) => ({ ...payload, kind: "actor" }),
    (payload: Record<string, unknown>) => ({
      ...payload,
      paletteId: "another-instance",
    }),
    (payload: Record<string, unknown>) => ({ ...payload, version: 2 }),
    (payload: Record<string, unknown>) => ({
      ...payload,
      label: "injected external label",
    }),
  ])("rejects changed or extended drag descriptors", (mutate) => {
    const current = palette();
    const dataTransfer = transfer();
    dragStart(current.element.querySelector("button")!, dataTransfer);
    dataTransfer.setData(
      DIAGRAM_PALETTE_MIME,
      JSON.stringify(
        mutate(JSON.parse(dataTransfer.getData(DIAGRAM_PALETTE_MIME))),
      ),
    );
    expect(current.readDrop(dataTransfer)).toBeNull();
  });

  it("rejects malformed data and all actions after destruction or in readonly mode", () => {
    const current = palette();
    const dataTransfer = transfer();
    const button = current.element.querySelector("button")!;
    dragStart(button, dataTransfer);
    dataTransfer.setData(DIAGRAM_PALETTE_MIME, "not JSON");
    expect(current.readDrop(dataTransfer)).toBeNull();
    current.destroy();
    button.click();
    expect(current.onInsert).not.toHaveBeenCalled();
    expect(current.canDrop(dataTransfer)).toBe(false);
    expect(current.readDrop(dataTransfer)).toBeNull();
    const readonly = palette("flowchart", true);
    const lockedButton = readonly.element.querySelector("button")!;
    expect(lockedButton.disabled).toBe(true);
    expect(lockedButton.draggable).toBe(false);
    lockedButton.click();
    expect(dragStart(lockedButton, transfer()).defaultPrevented).toBe(true);
    expect(readonly.onInsert).not.toHaveBeenCalled();
    expect(readonly.readDrop(dataTransfer)).toBeNull();
  });
});
