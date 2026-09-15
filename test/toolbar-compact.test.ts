import { afterEach, describe, expect, it } from "vitest";
import { AicEditor } from "../src/editor";

afterEach(() => document.body.replaceChildren());

function mount(options: ConstructorParameters<typeof AicEditor>[1] = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  return new AicEditor(host, options);
}

describe("optional compact toolbar", () => {
  it("keeps the existing Standard Notes toolbar structure by default", () => {
    const editor = mount();
    const toolbar = editor.toolbar.element;
    expect(toolbar.classList.contains("aic-toolbar--compact")).toBe(false);
    expect(toolbar.querySelector(".aic-toolbar-tray")).toBeNull();
    expect(toolbar.querySelector(".aic-formatting-toggle")).toBeNull();
    expect(
      toolbar.querySelectorAll(":scope > .aic-toolbar-group"),
    ).toHaveLength(4);
    editor.destroy();
  });

  it("discloses the same commands without replacing the view or its selection", () => {
    const editor = mount({ compactToolbar: true, initialText: "hello world" });
    const toolbar = editor.toolbar.element;
    const trigger = toolbar.querySelector<HTMLButtonElement>(
      ".aic-formatting-toggle",
    )!;
    const tray = toolbar.querySelector<HTMLElement>(".aic-toolbar-tray")!;
    const bold = tray.querySelector<HTMLButtonElement>(
      '[aria-label="Bold (Ctrl/Command+B)"]',
    )!;
    const view = editor.view;
    const editorDOM = editor.editorHost.querySelector(".cm-editor");
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });

    expect(tray.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(tray.id);
    expect(trigger.textContent).toBe("Format");
    expect(trigger.classList.contains("aic-button--ghost")).toBe(true);
    expect(trigger.classList.contains("aic-button--compact")).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe("Formatting");
    expect(trigger.title).toBe("Formatting");
    expect(tray.querySelectorAll(".aic-toolbar-group")).toHaveLength(4);
    trigger.click();
    expect(tray.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(editor.view).toBe(view);
    expect(editor.editorHost.querySelector(".cm-editor")).toBe(editorDOM);
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.view.state.selection.main.to).toBe(5);

    trigger.click();
    expect(tray.hidden).toBe(true);
    expect(editor.view.state.selection.main.from).toBe(0);
    expect(editor.view.state.selection.main.to).toBe(5);
    trigger.click();

    bold.click();
    expect(editor.value).toBe("**hello** world");
    expect(editor.view).toBe(view);
    expect(tray.querySelector('[aria-label="Bold (Ctrl/Command+B)"]')).toBe(
      bold,
    );
    editor.destroy();
  });

  it("gives each compact tray a distinct disclosure target", () => {
    const first = mount({ compactToolbar: true });
    const second = mount({ compactToolbar: true });
    const firstId =
      first.toolbar.element.querySelector(".aic-toolbar-tray")!.id;
    const secondId =
      second.toolbar.element.querySelector(".aic-toolbar-tray")!.id;
    expect(firstId).not.toBe(secondId);
    expect(document.getElementById(firstId)).not.toBeNull();
    expect(document.getElementById(secondId)).not.toBeNull();
    first.destroy();
    second.destroy();
  });

  it("closes on Escape from the tray and restores the disclosure focus", () => {
    const editor = mount({ compactToolbar: true });
    const trigger = editor.toolbar.element.querySelector<HTMLButtonElement>(
      ".aic-formatting-toggle",
    )!;
    const tray =
      editor.toolbar.element.querySelector<HTMLElement>(".aic-toolbar-tray")!;
    trigger.click();
    tray.querySelector<HTMLSelectElement>("select")!.focus();
    expect(document.activeElement).toBe(tray.querySelector("select"));

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    tray.querySelector("select")!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(tray.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    editor.destroy();
  });

  it("places an open tray in the larger viewport space", () => {
    const editor = mount({ compactToolbar: true });
    const toolbar = editor.toolbar.element;
    const trigger = toolbar.querySelector<HTMLButtonElement>(
      ".aic-formatting-toggle",
    )!;
    const tray = toolbar.querySelector<HTMLElement>(".aic-toolbar-tray")!;
    toolbar.getBoundingClientRect = () =>
      ({ top: 650, bottom: 686 }) as DOMRect;
    Object.defineProperty(tray, "scrollHeight", {
      configurable: true,
      value: 160,
    });
    trigger.click();
    expect(tray.dataset.placement).toBe("above");
    expect(tray.style.maxHeight).toBe("643px");

    trigger.click();
    toolbar.getBoundingClientRect = () => ({ top: 40, bottom: 76 }) as DOMRect;
    trigger.click();
    expect(tray.dataset.placement).toBe("below");
    expect(tray.style.maxHeight).toBe("685px");
    editor.destroy();
  });

  it("keeps save, source, and disclosure accessible while locked", () => {
    const editor = mount({
      compactToolbar: true,
      initialText: "word",
      readOnly: true,
      onSave: () => true,
    });
    const toolbar = editor.toolbar.element;
    const trigger = toolbar.querySelector<HTMLButtonElement>(
      ".aic-formatting-toggle",
    )!;
    const source = toolbar.querySelector<HTMLButtonElement>(
      ".aic-source-mode-toggle",
    )!;
    const tray = toolbar.querySelector<HTMLElement>(".aic-toolbar-tray")!;
    expect(source.parentElement).toBe(toolbar);
    expect(trigger.parentElement).toBe(toolbar);
    expect(toolbar.querySelector(".aic-save-controls")?.parentElement).toBe(
      toolbar,
    );
    expect(source.disabled).toBe(false);
    expect(trigger.disabled).toBe(false);
    expect(
      [
        ...tray.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        ),
      ].every((control) => control.disabled),
    ).toBe(true);

    trigger.click();
    expect(tray.hidden).toBe(false);
    source.click();
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(editor.value).toBe("word");
    expect(editor.setReadOnly(false)).toBe(true);
    expect(
      [
        ...tray.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        ),
      ].every((control) => !control.disabled),
    ).toBe(true);
    editor.destroy();
  });
});
