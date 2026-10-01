import { describe, expect, it, vi } from "vitest";
import { createScopeTabs } from "../src/core/scope-tabs.js";

function fixture(
  onSelect?: (id: string, previous: string) => boolean | Promise<boolean>,
) {
  const panels = ["current", "shared", "global"].map((id) => {
    const panel = document.createElement("section");
    panel.dataset.scope = id;
    panel.append(document.createElement("input"));
    return panel;
  });
  const tabs = createScopeTabs(document, {
    label: "Note scope",
    selected: "current",
    items: panels.map((panel) => ({
      id: panel.dataset.scope!,
      label: panel.dataset.scope!,
      panel,
    })),
    onSelect,
  });
  const root = document.createElement("main");
  root.append(tabs.element, ...panels);
  document.body.append(root);
  return {
    tabs,
    panels,
    buttons: [...tabs.element.querySelectorAll<HTMLButtonElement>("button")],
    root,
  };
}

describe("shared scope tabs", () => {
  it("keeps exactly one labelled panel visible and focusable", async () => {
    const { tabs, panels, buttons, root } = fixture();
    expect(
      buttons.map((button) => button.getAttribute("aria-selected")),
    ).toEqual(["true", "false", "false"]);
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    expect(panels.map((panel) => panel.inert)).toEqual([false, true, true]);
    expect(panels[0]!.getAttribute("aria-labelledby")).toBe(buttons[0]!.id);
    expect(await tabs.activate("global")).toBe(true);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, true, false]);
    tabs.dispose();
    root.remove();
  });

  it("blocks stale actions in hidden panels including programmatic clicks", async () => {
    const { tabs, panels, root } = fixture();
    const copy = document.createElement("button");
    const action = vi.fn();
    copy.addEventListener("click", action);
    panels[0]!.append(copy);
    copy.click();
    expect(action).toHaveBeenCalledOnce();
    await tabs.activate("shared");
    copy.click();
    expect(action).toHaveBeenCalledOnce();
    tabs.dispose();
    root.remove();
  });

  it("uses manual keyboard activation with arrows, Home and End", async () => {
    const { tabs, buttons, root } = fixture();
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[1]!);
    expect(tabs.selected).toBe("current");
    buttons[1]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[2]!);
    buttons[2]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    await vi.waitFor(() => expect(tabs.selected).toBe("global"));
    buttons[2]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[0]!);
    tabs.dispose();
    root.remove();
  });

  it("waits for the host save barrier, rejects failure and never hides the failed draft", async () => {
    let resolve!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const { tabs, panels, root } = fixture(save);
    const operation = tabs.activate("shared");
    expect(tabs.selected).toBe("current");
    expect(panels[0]!.hidden).toBe(false);
    expect(await tabs.activate("global")).toBe(false);
    resolve(false);
    expect(await operation).toBe(false);
    expect(tabs.selected).toBe("current");
    const retry = tabs.activate("shared");
    resolve(true);
    expect(await retry).toBe(true);
    tabs.dispose();
    root.remove();
  });

  it("ignores late saves after disposal and cannot activate unavailable scopes", async () => {
    const panel = document.createElement("section");
    const unavailable = document.createElement("section");
    let resolve!: (saved: boolean) => void;
    const tabs = createScopeTabs(document, {
      label: "Scope",
      items: [
        { id: "current", label: "Current", panel },
        { id: "shared", label: "Shared", panel: unavailable, disabled: true },
      ],
      onSelect: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    expect(await tabs.activate("shared")).toBe(false);
    const other = document.createElement("section");
    tabs.dispose();
    const active = createScopeTabs(document, {
      label: "Scope",
      items: [
        { id: "current", label: "Current", panel },
        { id: "global", label: "Global", panel: other },
      ],
      onSelect: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = active.activate("global");
    active.dispose();
    resolve(true);
    expect(await pending).toBe(false);
    expect(panel.hidden).toBe(false);
  });
});
