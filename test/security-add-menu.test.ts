import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecurityAddMenu } from "../src/core/security-controls.js";

const menus: { dispose: () => void }[] = [];
const rect = (left: number, top: number, width: number, height: number) =>
  new DOMRect(left, top, width, height);

function fixture() {
  const clip = document.createElement("div");
  clip.style.overflow = "auto";
  const menu = createSecurityAddMenu(document, "Add field", [
    { label: "Add Email", run: vi.fn() },
    { label: "Add URL", run: vi.fn() },
  ]);
  menus.push(menu);
  clip.append(menu.element);
  document.body.append(clip);
  const trigger = menu.element.querySelector<HTMLButtonElement>("button")!;
  const panel = menu.element.querySelector<HTMLElement>(
    ".cm-aic-security-add-menu",
  )!;
  const clipRect = vi.spyOn(clip, "getBoundingClientRect");
  const triggerRect = vi.spyOn(trigger, "getBoundingClientRect");
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
    rect(0, 0, 200, 180),
  );
  return { clip, clipRect, trigger, triggerRect, panel, menu };
}

afterEach(() => {
  for (const menu of menus.splice(0)) menu.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("shared Security/Properties add menu positioning", () => {
  it("uses compact labelled BEM rows without square icon-only geometry", () => {
    const { panel } = fixture();
    expect(panel.classList.contains("aic-menu")).toBe(true);
    expect(panel.classList.contains("aic-menu--compact")).toBe(true);
    for (const control of panel.querySelectorAll("button")) {
      expect(control.classList.contains("aic-menu__item")).toBe(true);
      expect(control.classList.contains("aic-button--compact")).toBe(true);
      expect(control.classList.contains("aic-button--icon-only")).toBe(false);
      expect(control.classList.contains("cm-aic-icon-button")).toBe(true);
      expect(control.querySelector(".aic-button__label")?.textContent).toBe(
        control.getAttribute("aria-label"),
      );
    }
  });

  it("keeps literal labels, disabled entries and one activation owner", () => {
    const run = vi.fn();
    const disabledRun = vi.fn();
    const menu = createSecurityAddMenu(document, "Add field", [
      { label: "Add field", text: "<img src=x>", run },
      { label: "Unavailable", disabled: true, run: disabledRun },
    ]);
    menus.push(menu);
    document.body.append(menu.element);
    const [trigger, entry, disabled] = menu.element.querySelectorAll("button");
    expect(entry!.textContent).toBe("<img src=x>");
    expect(entry!.querySelector("img")).toBeNull();
    trigger!.click();
    expect(document.activeElement).toBe(entry);
    disabled!.click();
    expect(disabledRun).not.toHaveBeenCalled();
    entry!.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    menu.dispose();
    entry!.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("opens below the trigger when the clipped editor area has no room above", () => {
    const { clipRect, trigger, triggerRect, panel } = fixture();
    clipRect.mockReturnValue(rect(40, 120, 400, 380));
    triggerRect.mockReturnValue(rect(250, 150, 30, 30));
    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(panel.style.top).toBe("184px");
    expect(panel.style.left).toBe("232px");
    expect(panel.style.maxHeight).toBe("180px");
    expect(document.activeElement).toBe(panel.querySelector("button"));
  });

  it("opens above and scrolls internally in a short visible editor area", () => {
    const { clipRect, trigger, triggerRect, panel } = fixture();
    clipRect.mockReturnValue(rect(40, 120, 210, 180));
    triggerRect.mockReturnValue(rect(230, 220, 20, 30));
    trigger.click();
    expect(panel.style.top).toBe("128px");
    expect(panel.style.left).toBe("48px");
    expect(panel.style.maxWidth).toBe("194px");
    expect(panel.style.maxHeight).toBe("88px");
  });

  it("keeps the menu clear of a containing scroller's scrollbar", () => {
    const { clip, clipRect, trigger, triggerRect, panel } = fixture();
    clipRect.mockReturnValue(rect(40, 120, 400, 380));
    Object.defineProperty(clip, "clientWidth", { value: 360 });
    triggerRect.mockReturnValue(rect(350, 150, 30, 30));
    trigger.click();
    expect(panel.style.maxWidth).toBe("344px");
    expect(panel.style.left).toBe("192px");
  });

  it("tracks clipping-area scroll and resize without leaking an open menu", async () => {
    const { clip, clipRect, trigger, triggerRect, panel, menu } = fixture();
    clipRect.mockReturnValue(rect(40, 120, 400, 380));
    triggerRect.mockReturnValue(rect(250, 150, 30, 30));
    trigger.click();
    triggerRect.mockReturnValue(rect(250, 360, 30, 30));
    clip.dispatchEvent(new Event("scroll"));
    await new Promise((done) => setTimeout(done, 25));
    expect(panel.style.top).toBe("176px");
    triggerRect.mockReturnValue(rect(250, 90, 30, 30));
    window.dispatchEvent(new Event("resize"));
    await new Promise((done) => setTimeout(done, 25));
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    menu.dispose();
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape or focus leaving the menu and restores trigger focus", () => {
    const { clipRect, trigger, triggerRect, panel } = fixture();
    clipRect.mockReturnValue(rect(40, 120, 400, 380));
    triggerRect.mockReturnValue(rect(250, 150, 30, 30));
    trigger.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(outside);
  });
});
