import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDiagramFixture, activate } from "./diagram-svg-fixture";
import { createDiagramBuilder } from "../src/core/diagram-builder.js";

const cleanups: (() => void)[] = [];
const flowchart = 'flowchart LR\n A["Start"] --> B["Finish"]';

async function open(source = flowchart, readOnly = false) {
  const onApply = vi.fn();
  const builder = createDiagramBuilder(document, {
    source,
    render: renderDiagramFixture,
    readOnly,
    onApply,
    onClose: vi.fn(),
  });
  document.body.append(builder.element);
  cleanups.push(() => builder.destroy());
  await builder.whenRendered();
  return { ...builder, onApply };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe("shared compact diagram controls", async () => {
  it("shows only diagram settings and semantic palette before selection", async () => {
    const builder = await open();
    const inspector = builder.element.querySelector(".aic-db-inspector")!;
    expect(inspector.querySelector("h3, p, ol")).toBeNull();
    expect(inspector.getAttribute("aria-label")).toBe("Diagram settings");
    expect(inspector.querySelectorAll(".aic-db-field")).toHaveLength(1);
    expect(
      inspector.querySelector('.aic-db-field[data-field-role="direction"]'),
    ).not.toBeNull();
    const port = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Connect Start"]',
    )!;
    expect(port.hasAttribute("hidden")).toBe(false);
    expect(port.getAttribute("aria-disabled")).toBe("false");
    const add = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Add state"]',
    )!;
    expect(add.title).toContain("drag onto canvas");
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenCalledWith(flowchart);
  });

  it.each([
    [flowchart, "State properties", "Relationship properties"],
    [
      "classDiagram\n class A\n class B\n A *-- B: contains",
      "Entity properties",
      "Relationship properties",
    ],
    [
      "sequenceDiagram\n participant A\n participant B\n A->>B: Request",
      "Participant properties",
      "Message properties",
    ],
  ])(
    "labels selected properties according to their meaning",
    async (source, nodeHeading, edgeHeading) => {
      const builder = await open(source);
      activate(builder.element.querySelector('[data-node-id="A"]')!);
      expect(
        builder.element
          .querySelector(".aic-db-inspector")
          ?.getAttribute("aria-label"),
      ).toBe(nodeHeading);
      activate(builder.element.querySelector(".aic-db-edge-hit")!);
      expect(
        builder.element
          .querySelector(".aic-db-inspector")
          ?.getAttribute("aria-label"),
      ).toBe(edgeHeading);
      expect(
        builder.element.querySelector(".aic-db-inspector h3, .aic-db-guide"),
      ).toBeNull();
    },
  );

  it("has no repeated instructions and disables mutations in read-only mode", async () => {
    const builder = await open(
      "sequenceDiagram\n participant A\n participant B\n A->>B: Request",
    );
    expect(builder.element.querySelector(".aic-db-guide")).toBeNull();
    const locked = await open(flowchart, true);
    expect(
      locked.element
        .querySelector(".aic-db-inspector")
        ?.getAttribute("aria-label"),
    ).toBe("Diagram settings · read-only");
    expect(
      locked.element.querySelector<HTMLSelectElement>(
        '[aria-label="Direction"]',
      )?.disabled,
    ).toBe(true);
  });

  it("makes every incident relationship reachable from the selected card", async () => {
    const original =
      'flowchart LR\n A["Start"] -->|incoming| B["Middle"]\n B -->|outgoing| C["Finish"]\n B -->|repeat| B';
    const builder = await open(original);
    activate(builder.element.querySelector('[data-node-id="B"]')!);
    const popover = builder.element.querySelector<HTMLElement>(
      '.aic-db-popover[data-popover="relations"]',
    )!;
    expect(popover.hidden).toBe(true);
    builder.element
      .querySelector<HTMLButtonElement>(
        '.aic-db-popover-toggle[data-popover="relations"]',
      )!
      .click();
    expect(popover.hidden).toBe(false);
    const list = builder.element.querySelector(".aic-db-relations")!;
    expect(list.querySelectorAll("button")).toHaveLength(3);
    expect(list.textContent).toContain("From Start — incoming");
    expect(list.textContent).toContain("To Finish — outgoing");
    expect(list.textContent).toContain("Self — repeat");
    [...list.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "To Finish — outgoing")!
      .click();
    expect(
      builder.element
        .querySelector(".aic-db-inspector")
        ?.getAttribute("aria-label"),
    ).toBe("Relationship properties");
    const label = builder.element.querySelector<HTMLInputElement>(
      '[aria-label="Message / event"]',
    )!;
    expect(document.activeElement).toBe(label);
    expect(label.value).toBe("outgoing");
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenCalledWith(original);
  });

  it("explains unsupported syntax above source and restores visual control after correction", async () => {
    const unsupported = "flowchart LR\n A --> B\n style A fill:red";
    const builder = await open(unsupported);
    const notice = builder.element.querySelector<HTMLElement>(
      ".aic-db-source-notice",
    )!;
    const code =
      builder.element.querySelector<HTMLTextAreaElement>(".aic-db-source")!;
    const visualButton = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Edit diagram visually"]',
    )!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(
      "Source only — visual editing unavailable",
    );
    expect(notice.textContent).toContain("Line 3:");
    expect(
      notice.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(code.getAttribute("aria-describedby")).toBe(notice.id);
    expect(visualButton.hidden).toBe(true);
    expect(visualButton.disabled).toBe(true);
    expect(
      builder.element.querySelector(".aic-db-status")?.textContent,
    ).not.toContain("Line 3");
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenCalledWith(unsupported);
    code.value = flowchart;
    code.dispatchEvent(new Event("input", { bubbles: true }));
    expect(notice.hidden).toBe(true);
    expect(code.hasAttribute("aria-describedby")).toBe(false);
    expect(visualButton.hidden).toBe(false);
    expect(visualButton.disabled).toBe(false);
    visualButton.click();
    expect(code.hidden).toBe(true);
    expect(
      builder.element.querySelector<HTMLElement>(".aic-db-viewport")?.hidden,
    ).toBe(false);
  });

  it("keeps semantic element roles in the same vocabulary as the visible palette", async () => {
    const builder = await open();
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    const type = builder.element.querySelector<HTMLSelectElement>(
      '[aria-label="Element type"]',
    )!;
    const palette = [
      ...builder.element.querySelectorAll(".aic-diagram-palette-label"),
    ].map((item) => item.textContent);
    expect([...type.options].map((option) => option.textContent)).toEqual(
      palette,
    );
    expect(palette).toEqual(["State", "Event", "Condition"]);
    expect(
      builder.element.querySelector(".aic-db-inspector")?.textContent,
    ).not.toMatch(/rectangle|diamond|rounded/);
    type.focus();
    type.value = "diamond";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    await builder.whenRendered();
    expect(document.activeElement).toBe(type);
    expect(
      builder.element
        .querySelector(".aic-db-inspector")
        ?.getAttribute("aria-label"),
    ).toBe("Condition properties");
    expect(builder.getSource()).toContain('A{"Start"}');
  });

  it("opens endpoints only on request; Escape and outside click dismiss without applying", async () => {
    const builder = await open();
    activate(builder.element.querySelector(".aic-db-edge-hit")!);
    const trigger = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Connection endpoints"]',
    )!;
    const panel = builder.element.querySelector<HTMLElement>(
      '.aic-db-popover[data-popover="endpoint"]',
    )!;
    expect(panel.hidden).toBe(true);
    expect(
      builder.element.querySelector(
        '.aic-db-inspector > [data-field-role="from"]',
      ),
    ).toBeNull();
    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const from = panel.querySelector<HTMLSelectElement>('[aria-label="From"]')!;
    expect(document.activeElement).toBe(from);
    from.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(builder.getSource()).toBe(flowchart);
    expect(builder.onApply).not.toHaveBeenCalled();
    trigger.click();
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    expect(panel.hidden).toBe(true);
    expect(builder.onApply).not.toHaveBeenCalled();
  });

  it("uses entities and associations for the recognized entity-map profile without rewriting source", async () => {
    const source =
      '%% aic:entity-map\nflowchart LR\n A["System"] --> B["Module"]';
    const builder = await open(source);
    expect(
      builder.element.querySelector('[aria-label="Add entity"]'),
    ).not.toBeNull();
    expect(
      builder.element.querySelector('[aria-label="Add state"]'),
    ).toBeNull();
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    const type = builder.element.querySelector<HTMLSelectElement>(
      '[aria-label="Element type"]',
    )!;
    expect(type.selectedOptions[0]!.textContent).toBe("Entity");
    activate(builder.element.querySelector(".aic-db-edge-hit")!);
    const relationship = builder.element.querySelector<HTMLSelectElement>(
      '[aria-label="Relationship type"]',
    )!;
    expect(relationship.selectedOptions[0]!.textContent).toBe("Association");
    expect([...relationship.options].map((item) => item.textContent)).toEqual([
      "Association",
      "Dependency",
      "Emphasized association",
      "Association without direction",
    ]);
    expect(builder.getSource()).toBe(source);
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenCalledWith(source);
  });

  it("keeps a changed endpoint and its focus while Mermaid redraws, then allows Undo", async () => {
    const builder = await open();
    activate(builder.element.querySelector(".aic-db-edge-hit")!);
    builder.element
      .querySelector<HTMLButtonElement>('[aria-label="Connection endpoints"]')!
      .click();
    const from = builder.element.querySelector<HTMLSelectElement>(
      '[aria-label="From"]',
    )!;
    from.value = "B";
    from.dispatchEvent(new Event("change", { bubbles: true }));
    await builder.whenRendered();
    expect(document.activeElement).toBe(from);
    expect(
      builder.element.querySelector<HTMLElement>(
        '.aic-db-popover[data-popover="endpoint"]',
      )!.hidden,
    ).toBe(false);
    expect(
      builder.element.querySelector<HTMLButtonElement>(
        '[aria-label="Reverse direction"]',
      )!.disabled,
    ).toBe(true);
    expect(builder.getSource()).toContain("B --> B");
    builder.element
      .querySelector<HTMLButtonElement>('[aria-label="Undo diagram change"]')!
      .click();
    expect(builder.getSource()).toBe(flowchart);
    expect(builder.onApply).not.toHaveBeenCalled();
  });

  it("keeps class members local and recoverable until Apply", async () => {
    const builder = await open("classDiagram\n class A {\n +name: string\n }");
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    const trigger = builder.element.querySelector<HTMLButtonElement>(
      '[aria-label="Entity members"]',
    )!;
    const panel = builder.element.querySelector<HTMLElement>(
      '.aic-db-popover[data-popover="members"]',
    )!;
    expect(panel.hidden).toBe(true);
    trigger.click();
    const input = panel.querySelector("textarea")!;
    input.value = "+make(): {x: string}";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(builder.apply()).toBe(false);
    input.value = "+make(): string";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await builder.whenRendered();
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(panel.hidden).toBe(true);
    expect(builder.onApply).not.toHaveBeenCalled();
    trigger.click();
    expect(panel.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("+make(): string");
  });

  it("routes source indentation through the same local draft, Apply and Undo", async () => {
    const original = 'flowchart LR\n    A["Start"]';
    const builder = await open(original);
    builder.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
      .click();
    const code =
      builder.element.querySelector<HTMLTextAreaElement>(".aic-db-source")!;
    code.focus();
    code.setSelectionRange(original.length, original.length);
    const input = vi.fn();
    code.addEventListener("input", input);
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    code.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(code.value).toBe(original + "\n    ");
    code.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(code.value).toBe(original + "\n      ");
    code.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(code.value).toBe(original + "\n    ");
    expect(input).toHaveBeenCalledTimes(3);
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenLastCalledWith(code.value);
    builder.element
      .querySelector<HTMLButtonElement>('[aria-label="Undo diagram change"]')!
      .click();
    expect(code.value).toBe(original);
    expect(builder.apply()).toBe(true);
    expect(builder.onApply).toHaveBeenLastCalledWith(original);
    builder.destroy();
    const afterDestroy = code.value;
    code.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(code.value).toBe(afterDestroy);
  });

  it("does not intercept Tab in property fields or mutate locked source", async () => {
    const builder = await open("classDiagram\n class A {\n +name: string\n }");
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    builder.element
      .querySelector<HTMLButtonElement>('[aria-label="Entity members"]')!
      .click();
    const field = builder.element.querySelector<HTMLTextAreaElement>(
      ".aic-db-inspector textarea",
    )!;
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    const locked = await open(flowchart, true);
    locked.element
      .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
      .click();
    const source =
      locked.element.querySelector<HTMLTextAreaElement>(".aic-db-source")!;
    source.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(source.value).toBe(flowchart);
  });
});
