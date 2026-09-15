import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import { parseSecurityBlock } from "../src/core/security-model.js";
import { isSaveAction } from "../src/core/save-boundary.js";

const views: EditorView[] = [];

function fixture(body: string, readOnly = false) {
  const source = `\`\`\`aic\n${body}\n\`\`\`\n\nAfter`;
  const host = document.body.appendChild(document.createElement("div"));
  const saves: boolean[] = [];
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: source,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ document }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) saves.push(isSaveAction(update));
        }),
      ],
    }),
  });
  views.push(view);
  return { source, host, view, saves };
}

function model(view: EditorView) {
  const block = securityBlocks(view.state)[0]!;
  const parsed = parseSecurityBlock(block.body);
  if (!parsed.ok) throw new Error("Invalid synthetic Security fixture");
  return parsed.model;
}

function control(host: ParentNode, label: string) {
  const result = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(result, label).not.toBeNull();
  return result!;
}

function move(button: HTMLButtonElement, direction: "ArrowUp" | "ArrowDown") {
  button.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: direction,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function pointer(target: EventTarget, type: string, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 30,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Security cross-section field reorder", () => {
  it("moves into another populated section as one undoable save without exposing secrets", () => {
    const { source, host, view, saves } = fixture(
      "# Accounts\n## Work\nPassword *| synthetic-private-value\n---\n## Personal\nEmail | public@example.test",
    );
    move(control(host, "Reorder Password"), "ArrowDown");
    expect(
      model(view).sections.map((section) =>
        section.fields.map((field) => field.label),
      ),
    ).toEqual([[], ["Password", "Email"]]);
    expect(model(view).sections[1]!.fields[0]!.parts[0]!.value).toBe(
      "synthetic-private-value",
    );
    expect(host.querySelector(".cm-aic-security")?.innerHTML).not.toContain(
      "synthetic-private-value",
    );
    expect(saves).toEqual([true]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("moves into an empty section via keyboard without permanent drop instructions", () => {
    const { host, view, saves } = fixture(
      "## Work\nEmail | public@example.test\n---\n## Empty",
    );
    const placeholder = host.querySelector<HTMLElement>(
      ".cm-aic-security-empty-drop",
    );
    expect(placeholder).toBeNull();
    move(control(host, "Reorder Email"), "ArrowDown");
    expect(
      model(view).sections.map((section) => section.fields.length),
    ).toEqual([0, 1]);
    expect(model(view).sections[1]!.fields[0]!.label).toBe("Email");
    expect(saves).toEqual([true]);
  });

  it("accepts a pointer drop on an empty section header without drag payload", () => {
    const { host, view, saves } = fixture(
      "## Work\nEmail | public@example.test\n---\n## Empty",
    );
    const body = host.querySelector<HTMLElement>(".cm-aic-security-body")!;
    const targets = [
      ...body.querySelectorAll<HTMLElement>(
        ".cm-aic-security-section > .cm-aic-security-section-header, .cm-aic-security-section > .cm-aic-security-card",
      ),
    ];
    targets.forEach((target, index) => {
      target.getBoundingClientRect = () =>
        new DOMRect(10, 10 + index * 60, 180, 50);
    });
    body.getBoundingClientRect = () => new DOMRect(0, 0, 200, 250);
    const handle = control(host, "Reorder Email");
    const transfer = { setData: vi.fn() };
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(drag, "dataTransfer", { value: transfer });
    handle.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
    expect(transfer.setData).not.toHaveBeenCalled();
    pointer(handle, "pointerdown", 80);
    pointer(document, "pointermove", 170);
    pointer(document, "pointerup", 170);
    expect(model(view).sections[1]!.fields.map((field) => field.label)).toEqual(
      ["Email"],
    );
    expect(saves).toEqual([true]);
  });

  it("blocks moves while filtered or read-only, and never enters a full target section", () => {
    const { host, view, saves } = fixture(
      "## Work\nEmail | public@example.test\n---\n## Empty",
    );
    const search = host.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    search.value = "Email";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(control(host, "Reorder Email").disabled).toBe(true);
    move(control(host, "Reorder Email"), "ArrowDown");
    expect(model(view).sections[0]!.fields).toHaveLength(1);
    expect(saves).toEqual([]);

    const locked = fixture(
      "## Work\nEmail | public@example.test\n---\n## Empty",
      true,
    );
    expect(
      locked.host.querySelector('[aria-label="Reorder Email"]'),
    ).toBeNull();
    const full = fixture(
      "## Work\nEmail | public@example.test\n---\n## Full\n" +
        Array.from({ length: 64 }, (_, index) => `Field ${index} | x`).join(
          "\n",
        ),
    );
    expect(full.host.querySelector('[aria-label="Reorder Email"]')).toBeNull();
    expect(full.view.state.doc.toString()).toContain("Field 63 | x");
  });

  it("abandons an in-flight pointer move after the source document changes", () => {
    const { host, view, saves } = fixture(
      "## Work\nEmail | public@example.test\n---\n## Empty",
    );
    const body = host.querySelector<HTMLElement>(".cm-aic-security-body")!;
    const targets = [
      ...body.querySelectorAll<HTMLElement>(
        ".cm-aic-security-section > .cm-aic-security-section-header, .cm-aic-security-section > .cm-aic-security-card",
      ),
    ];
    targets.forEach((target, index) => {
      target.getBoundingClientRect = () =>
        new DOMRect(10, 10 + index * 60, 180, 50);
    });
    body.getBoundingClientRect = () => new DOMRect(0, 0, 200, 250);
    const handle = control(host, "Reorder Email");
    pointer(handle, "pointerdown", 80);
    const original = view.state.doc.toString();
    const from = original.indexOf("public@example.test");
    view.dispatch({
      changes: {
        from,
        to: from + "public@example.test".length,
        insert: "changed@example.test",
      },
    });
    pointer(document, "pointermove", 170);
    pointer(document, "pointerup", 170);
    expect(
      model(view).sections.map((section) => section.fields.length),
    ).toEqual([1, 0]);
    expect(model(view).sections[0]!.fields[0]!.parts[0]!.value).toBe(
      "changed@example.test",
    );
    expect(saves).toEqual([false]);
  });
});
