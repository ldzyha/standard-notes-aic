import { describe, expect, it, vi } from "vitest";
import {
  applyUiComponent,
  createUiButton,
  UI_COMPONENTS,
  type UiBlock,
  type UiModifiers,
} from "../src/core/ui-system.js";
import { createIconButton } from "../src/core/structured-preview.js";

describe("shared UI primitives", () => {
  it("creates native accessible buttons without submitting a surrounding form", () => {
    const form = document.createElement("form");
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submit);
    const button = createUiButton(document, { label: "Save note" });
    form.append(button);
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Save note");
    expect(button.title).toBe("Save note");
    expect(button.textContent).toBe("Save note");
    expect(button.classList.contains("aic-button")).toBe(true);
    button.click();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps icon glyph content and explicit visible text separate from accessible labels", () => {
    const icon = createUiButton(document, {
      label: "More options",
      text: "⋯",
      iconOnly: true,
      variant: "ghost",
      size: "compact",
    });
    expect(icon.textContent).toBe("⋯");
    expect(icon.getAttribute("aria-label")).toBe("More options");
    expect([...icon.classList]).toEqual([
      "aic-button",
      "aic-button--ghost",
      "aic-button--compact",
      "aic-button--icon-only",
    ]);
    const mask = createUiButton(document, { label: "Copy", iconOnly: true });
    expect(mask.textContent).toBe("");
    const remove = createUiButton(document, {
      label: "Delete current note",
      text: "Delete",
      variant: "danger",
      size: "touch",
    });
    expect(remove.textContent).toBe("Delete");
    expect(remove.classList.contains("aic-button--touch")).toBe(true);
    expect(remove.classList.contains("aic-button--danger")).toBe(true);
  });

  it("treats button labels and text as plain text", () => {
    const markup = '<img src=x onerror="alert(1)">';
    const button = createUiButton(document, { label: markup, text: markup });
    expect(button.textContent).toBe(markup);
    expect(button.getAttribute("aria-label")).toBe(markup);
    expect(button.childElementCount).toBe(0);
  });

  it("uses registered BEM blocks and elements while preserving host classes", () => {
    const element = document.createElement("div");
    element.className = "host-card";
    expect(applyUiComponent(element, "card", ["compact", "security"])).toBe(
      element,
    );
    applyUiComponent(element, "card", ["compact"]);
    expect([...element.classList]).toEqual([
      "host-card",
      "aic-card",
      "aic-card--compact",
      "aic-card--security",
    ]);
    const input = document.createElement("input");
    applyUiComponent(input, "field", ["invalid"], "control");
    expect([...input.classList]).toEqual([
      "aic-field__control",
      "aic-field__control--invalid",
    ]);
    expect(Object.isFrozen(UI_COMPONENTS)).toBe(true);
    expect(Object.isFrozen(UI_COMPONENTS.button.modifiers)).toBe(true);
  });

  it("rejects unknown modifiers or class injection before changing an element", () => {
    const element = document.createElement("div");
    element.className = "keep";
    for (const block of ["toString", "__proto__", "button extra", "unknown"])
      expect(() => applyUiComponent(element, block as UiBlock)).toThrow(
        TypeError,
      );
    for (const modifier of ["danger extra", "secret", "__proto__"])
      expect(() =>
        applyUiComponent(element, "button", [
          "compact",
          modifier as UiModifiers["button"],
        ]),
      ).toThrow(TypeError);
    expect(() =>
      applyUiComponent(element, "button", [], "icon extra" as "icon"),
    ).toThrow(TypeError);
    expect(element.className).toBe("keep");
    expect(() =>
      applyUiComponent(element, "button", Array(1) as UiModifiers["button"][]),
    ).toThrow(TypeError);
    expect(() => createUiButton(document, { label: " " })).toThrow(TypeError);
    expect(() =>
      createUiButton(document, {
        label: "Save",
        variant: "danger injected" as "danger",
      }),
    ).toThrow(TypeError);
  });

  it("keeps actions owned by callers and respects native disabled behavior", () => {
    const button = createUiButton(document, { label: "Save" });
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    button.disabled = true;
    button.click();
    expect(clicked).not.toHaveBeenCalled();
    button.disabled = false;
    button.click();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("adopts the base factory for legacy icon actions while preserving selection and event boundaries", () => {
    const action = vi.fn();
    const bubble = vi.fn();
    const parent = document.createElement("div");
    parent.addEventListener("click", bubble);
    const button = createIconButton(document, {
      label: "Copy value",
      icon: "copy",
      className: "legacy-copy extra-hook",
      onActivate: action,
    });
    parent.append(button);
    expect(button.classList.contains("aic-button")).toBe(true);
    expect(button.classList.contains("cm-aic-icon-button")).toBe(true);
    expect(button.classList.contains("legacy-copy")).toBe(true);
    expect(button.classList.contains("extra-hook")).toBe(true);
    expect(button.dataset.aicIcon).toBe("copy");
    expect(button.title).toBe("Copy value");
    const pointer = new Event("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(pointer);
    expect(pointer.defaultPrevented).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledExactlyOnceWith(button);
    expect(bubble).not.toHaveBeenCalled();
    button.disabled = true;
    button.click();
    expect(action).toHaveBeenCalledOnce();
  });
});
