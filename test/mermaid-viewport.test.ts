import { describe, expect, it } from "vitest";
import { createMermaidViewport } from "../src/core/mermaid-viewport.js";

describe("shared Mermaid viewport", () => {
  it("allocates scrollable bounds for zoom and every 90 degree turn", () => {
    const controller = createMermaidViewport(document);
    Object.defineProperty(controller.viewport, "clientWidth", {
      configurable: true,
      value: 200,
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 400 200");
    controller.replaceContent(svg);
    controller.refresh();

    expect(controller.viewport.tabIndex).toBe(0);
    expect(controller.state).toEqual({ zoom: 100, rotation: 0 });
    expect(controller.stage.style.width).toBe("200px");
    expect(controller.stage.style.height).toBe("100px");

    controller.controls
      .querySelector<HTMLButtonElement>('[data-aic-icon="zoom-in"]')!
      .click();
    expect(controller.state).toEqual({ zoom: 125, rotation: 0 });
    expect(controller.stage.style.width).toBe("250px");
    expect(controller.stage.style.height).toBe("125px");

    const rotate = controller.controls.querySelector<HTMLButtonElement>(
      '[data-aic-icon="rotate"]',
    )!;
    rotate.click();
    expect(controller.state).toEqual({ zoom: 125, rotation: 90 });
    expect(controller.stage.style.width).toBe("125px");
    expect(controller.stage.style.height).toBe("250px");
    expect(
      controller.stage.style.getPropertyValue("--aic-mermaid-source-width"),
    ).toBe("250px");
    expect(
      controller.stage.style.getPropertyValue("--aic-mermaid-source-height"),
    ).toBe("125px");
    expect(rotate.getAttribute("aria-label")).toContain("currently 90°");

    controller.controls
      .querySelector<HTMLButtonElement>('[data-aic-icon="reset"]')!
      .click();
    expect(controller.state).toEqual({ zoom: 100, rotation: 0 });
    expect(controller.destroy()).toBe(true);
    expect(controller.destroy()).toBe(false);
  });
});
