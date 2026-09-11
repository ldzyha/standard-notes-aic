import { afterEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { renderDiagramFixture, activate } from "./diagram-svg-fixture";
import { createDiagramBuilder } from "../src/core/diagram-builder.js";
import {
  moveSequenceMessage,
  parseDiagram,
  serializeDiagram,
  type DiagramModel,
} from "../src/core/diagram-model.js";

const examples = {
  flowchart: `flowchart LR
    initial["Показано каталог"]
    loading["Результат оновлюється"]
    filtered["Показано відповідні товари"]
    emptyResult["Показано порожній результат"]
    failed["Показано помилку"]

    initial -->|"Користувач змінив фільтр"| loading
    loading -->|"Отримано товари"| filtered
    loading -->|"Отримано порожній список"| emptyResult
    loading -->|"Отримано помилку"| failed
    failed -->|"Користувач повторив запит"| loading
    filtered -->|"Користувач змінив фільтр"| loading
    emptyResult -->|"Користувач змінив фільтр"| loading`,
  classDiagram: `classDiagram
    class FilterController {
        +apply()
        +retry()
    }
    class FilterState {
        +boolean availableOnly
    }
    class CatalogSource {
        +load()
    }
    FilterController *-- FilterState : містить
    FilterController ..> CatalogSource : запитує дані`,
  sequenceDiagram: `sequenceDiagram
    actor User as Користувач
    participant Filter as Обробник фільтра
    participant Catalog as Джерело даних каталогу
    User->>Filter: Змінює фільтр доступності
    Filter->>Filter: Оновлює стан фільтра
    Filter->>Catalog: Запитує товари з обмеженням
    alt Успішна відповідь
        Catalog-->>Filter: Товари або порожній список
        Filter-->>User: Показує відповідний результат
    else Помилка
        Catalog-->>Filter: Повідомляє про помилку
        Filter-->>User: Показує помилку та можливість повторення
    end`,
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.replaceChildren();
});
function read(source: string): DiagramModel {
  const result = parseDiagram(source);
  if (!result.ok) throw new Error(`${result.line}: ${result.reason}`);
  return result.model;
}
async function open(source: string, readOnly = false) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const builder = createDiagramBuilder(document, {
    source,
    render: renderDiagramFixture,
    readOnly,
    onApply,
    onClose,
  });
  document.body.append(builder.element);
  cleanups.push(() => builder.destroy());
  await builder.whenRendered();
  return { ...builder, onApply, onClose };
}
function click(element: HTMLElement, label: string) {
  const button = element.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`,
  );
  expect(button, label).not.toBeNull();
  activate(button!);
}

describe("guarded shared Mermaid model", async () => {
  it.each(Object.entries(examples))(
    "round trips the actual Core %s example and produces valid Mermaid",
    async (_type, source) => {
      const first = read(source);
      const output = serializeDiagram(first);
      expect(read(output)).toEqual(first);
      await expect(mermaid.parse(output)).resolves.toBeTruthy();
    },
  );

  it("supports class direction, custom labels, properties and typed relations", async () => {
    const model = read(
      'classDiagram\n direction LR\n class A["Account"]\n class A {\n +save()\n }\n A <|-- B : inherits',
    );
    expect(model.direction).toBe("LR");
    expect(model.nodes[0]).toMatchObject({
      label: "Account",
      members: ["+save()"],
    });
    expect(read(serializeDiagram(model))).toEqual(model);
    await expect(mermaid.parse(serializeDiagram(model))).resolves.toBeTruthy();
  });

  it("retains an entity map marker and builder positions without a second content format", async () => {
    const model = read(
      '%% aic:entity-map\nflowchart LR\n A["System"] --> B["Module"]',
    );
    model.nodes[0]!.x = 125;
    model.nodes[0]!.y = 78;
    const output = serializeDiagram(model);
    expect(output).toContain("%% aic:entity-map");
    expect(output).toContain("%% aic-builder-layout ");
    expect(read(output)).toEqual(model);
  });

  it("retains quoted label characters safely", async () => {
    const model = read('flowchart LR\n A["Start"]');
    model.nodes[0]!.label = 'A "quoted" # value\nSecond line';
    const output = serializeDiagram(model);
    expect(read(output).nodes[0]!.label).toBe(model.nodes[0]!.label);
    await expect(mermaid.parse(output)).resolves.toBeTruthy();
  });

  it.each([
    "flowchart LR\n A --> B --> C",
    "flowchart LR\n A --> B\n style A fill:red",
    "flowchart LR\n subgraph X\n A --> B\n end",
    "flowchart LR\n A((Circle))",
    'flowchart LR\n click A "https://example.com"',
    '%%{init: {"theme": "dark"}}%%\nflowchart LR\n A --> B',
    'classDiagram\n A "1" --> "*" B',
    "sequenceDiagram\n autonumber\n A->>B: Message",
    "sequenceDiagram\n A->>B: One; B->>A: Two",
    "sequenceDiagram\n alt Condition\n A->>B: Message",
    'flowchart LR\n A --> B\n %% aic-builder-layout {"version":1,"nodes":{"missing":{"x":4,"y":5}}}',
  ])(
    "rejects unsupported source instead of deleting its constructs: %s",
    async (source) => {
      expect(parseDiagram(source).ok).toBe(false);
    },
  );

  it("moves sequence messages semantically but never across a branch boundary", async () => {
    const model = read(examples.sequenceDiagram);
    const before = model.steps
      .filter(({ kind }) => kind === "message")
      .map(({ edgeId }) => edgeId);
    expect(moveSequenceMessage(model, before[1]!, -1)).toBe(true);
    expect(model.steps[0]!.edgeId).toBe(before[1]);
    const branchFirst = model.steps.findIndex(({ kind }) => kind === "alt") + 1;
    expect(
      moveSequenceMessage(model, model.steps[branchFirst]!.edgeId!, -1),
    ).toBe(false);
    expect(read(serializeDiagram(model)).steps.map(({ kind }) => kind)).toEqual(
      model.steps.map(({ kind }) => kind),
    );
  });
});

describe("shared local diagram draft surface", async () => {
  it.each(Object.values(examples))(
    "applies untouched source byte for byte, even after switching modes",
    async (source) => {
      const original = `${source}\r\n\r\n`;
      const builder = await open(original);
      click(builder.element, "Edit Mermaid source");
      click(builder.element, "Edit diagram visually");
      expect(builder.apply()).toBe(true);
      expect(builder.onApply).toHaveBeenCalledWith(original);
    },
  );

  it("keeps unsupported source code-only without stripping directives or styling", async () => {
    const source = "flowchart LR\n A --> B\n style A fill:red\n";
    const builder = await open(source);
    const code = builder.element.querySelector<HTMLTextAreaElement>(
      '[aria-label="Mermaid diagram source"]',
    )!;
    expect(code.hidden).toBe(false);
    expect(code.value).toBe(source);
    expect(builder.element.textContent).toContain("Source only");
    expect(
      builder.element.querySelector<HTMLButtonElement>(
        '[aria-label="Edit diagram visually"]',
      )!.disabled,
    ).toBe(true);
    builder.apply();
    expect(builder.onApply).toHaveBeenCalledWith(source);
  });

  it("creates elements and handle connections locally; Undo and Cancel do not save", async () => {
    const builder = await open('flowchart LR\n A["Initial"]');
    click(builder.element, "Add state");
    const label = builder.element.querySelector<HTMLInputElement>(
      'input[aria-label="Label"]',
    )!;
    label.value = "Ready";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    await builder.whenRendered();
    click(builder.element, "Connect Initial");
    click(builder.element, "Connect Ready");
    expect(builder.onApply).not.toHaveBeenCalled();
    builder.apply();
    const model = read(builder.onApply.mock.calls[0]![0]);
    expect(model.nodes).toHaveLength(2);
    expect(model.edges[0]).toMatchObject({ from: "A", to: "N1", kind: "-->" });
    click(builder.element, "Undo diagram change");
    builder.apply();
    expect(read(builder.onApply.mock.calls[1]![0]).edges).toHaveLength(0);
    click(builder.element, "Cancel diagram changes");
    expect(builder.onClose).toHaveBeenCalledOnce();
    expect(builder.onApply).toHaveBeenCalledTimes(2);
  });

  it("preserves the focused label control while typing", async () => {
    const builder = await open('flowchart LR\n A["Start"]');
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    const label = builder.element.querySelector<HTMLInputElement>(
      'input[aria-label="Label"]',
    )!;
    label.focus();
    label.value = "Updated";
    label.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.activeElement).toBe(label);
    expect(label.isConnected).toBe(true);
    builder.apply();
    expect(read(builder.onApply.mock.calls[0]![0]).nodes[0]!.label).toBe(
      "Updated",
    );
  });

  it("does not invent manual coordinates from keyboard movement", async () => {
    const builder = await open('flowchart LR\n A["Start"]');
    const node =
      builder.element.querySelector<HTMLElement>('[data-node-id="A"]')!;
    node.focus();
    activate(node);
    expect(document.activeElement).toBe(node);
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      }),
    );
    builder.apply();
    expect(read(builder.onApply.mock.calls[0]![0]).nodes[0]!.x).toBeUndefined();
    expect(document.activeElement?.getAttribute("data-node-id")).toBe("A");
  });

  it("rejects Apply and mode switching while an unsupported field draft is visible", async () => {
    const builder = await open("classDiagram\n class A {\n +name: string\n }");
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    click(builder.element, "Entity members");
    const members = builder.element.querySelector<HTMLTextAreaElement>(
      ".aic-db-inspector textarea",
    )!;
    members.value = "+make(): {x: string}";
    members.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      builder.element.querySelector<HTMLButtonElement>(
        '[aria-label="Apply diagram changes"]',
      )!.disabled,
    ).toBe(true);
    expect(builder.apply()).toBe(false);
    expect(builder.onApply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(members);
    click(builder.element, "Edit Mermaid source");
    expect(members.isConnected).toBe(true);
    members.value = "+make(): string";
    members.dispatchEvent(new Event("input", { bubbles: true }));
    expect(builder.apply()).toBe(true);
    expect(builder.onApply.mock.calls[0]![0]).toContain("+make(): string");
  });

  it("can reorder participants and create self messages without changing to an arbitrary graph", async () => {
    const builder = await open(
      "sequenceDiagram\n participant A\n participant B\n A->>B: Message",
    );
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    click(builder.element, "Move participant right");
    await builder.whenRendered();
    click(builder.element, "Connect A");
    click(builder.element, "Connect A");
    builder.apply();
    const model = read(builder.onApply.mock.calls[0]![0]);
    expect(model.nodes.map(({ id }) => id)).toEqual(["B", "A"]);
    expect(model.edges[1]).toMatchObject({ from: "A", to: "A" });
    expect(model.steps).toHaveLength(2);
    expect(
      model.nodes.every(({ x, y }) => x === undefined && y === undefined),
    ).toBe(true);
  });

  it("keeps rejected Apply open and never applies readonly drafts", async () => {
    const onApply = vi.fn(() => false);
    const builder = createDiagramBuilder(document, {
      source: "flowchart LR\n A --> B",
      onApply,
    });
    document.body.append(builder.element);
    cleanups.push(builder.destroy);
    expect(builder.apply()).toBe(false);
    expect(builder.element.isConnected).toBe(true);
    expect(builder.element.textContent).toContain("Reopen");
    const locked = await open("flowchart LR\n A --> B", true);
    expect(locked.apply()).toBe(false);
    expect(locked.onApply).not.toHaveBeenCalled();
    expect(
      locked.element.querySelector<HTMLButtonElement>(
        '[aria-label="Add state"]',
      )!.disabled,
    ).toBe(true);
  });

  it("retains exact source after pan, zoom, selection, and cancellation", async () => {
    const source = '\nflowchart LR\n    A["State"]\n';
    const builder = await open(source);
    click(builder.element, "Zoom in");
    click(builder.element, "Zoom out");
    activate(builder.element.querySelector('[data-node-id="A"]')!);
    builder.apply();
    expect(builder.onApply).toHaveBeenCalledWith(source);
  });
});
