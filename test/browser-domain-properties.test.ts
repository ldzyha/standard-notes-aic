import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { DomainPropertiesView } from "../src/browser/domain-properties";

const secret = "SYNTHETIC-ONLY-SECRET";
const properties = `\`\`\`aic\n# Properties\nPassword *| "${secret}"\nUsername | person@example.com\n\`\`\`\n`;
const views: DomainPropertiesView[] = [];
function editorView(component: DomainPropertiesView): EditorView {
  return (component as unknown as { editor: { view: EditorView } }).editor.view;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  initialText: string | null = properties,
  scope: "domain" | "global" = "domain",
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn();
  const onSave = vi.fn(async (text: string) => {
    void text;
    return true;
  });
  const component = new DomainPropertiesView(parent, {
    origin: "https://example.com",
    scope,
    initialText,
    onChange,
    onSave,
  });
  views.push(component);
  return { parent, component, onChange, onSave };
}
function replace(component: DomainPropertiesView, text: string) {
  const view = editorView(component);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("direct Shared and Global Markdown editors", () => {
  it.each(["domain", "global"] as const)(
    "mounts %s ready to edit without an extra action",
    (scope) => {
      const { parent, component, onChange, onSave } = fixture(null, scope);
      expect(parent.querySelector(".aic-editor")).not.toBeNull();
      expect(
        parent.querySelector(".browser-domain-properties-action"),
      ).toBeNull();
      expect(component.value).toBe("");
      expect(onChange).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("saves ordinary Markdown mixed with AIC using the same owner", async () => {
    const { component, onSave, onChange } = fixture(null);
    const text = `# Shared notes\n\nA decision.\n\n${properties}`;
    replace(component, text);
    expect(onChange).toHaveBeenLastCalledWith(text);
    expect(await component.save()).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith(text);
    expect(component.value).toBe(text);
  });

  it("allows clearing or partially writing a document without adding syntax", async () => {
    const { component, onSave } = fixture(properties);
    replace(component, "");
    expect(await component.save()).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith("");
    replace(component, "```aic\nunfinished");
    expect(await component.save()).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith("```aic\nunfinished");
  });

  it("keeps AIC values masked and independent copy available in the shared editor", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, {
        clipboard: { writeText },
      }),
    );
    const { parent } = fixture();
    expect(parent.querySelector(".cm-aic-security")?.outerHTML).not.toContain(
      secret,
    );
    const copy = parent.querySelector<HTMLButtonElement>(
      '[aria-label="Copy Password value"]',
    );
    expect(copy).not.toBeNull();
    copy!.click();
    expect(writeText).toHaveBeenCalledWith(secret);
  });

  it("retains text, selection and undo history after a failed save and retry", async () => {
    const { component, onSave } = fixture("Original");
    const view = editorView(component);
    replace(component, "A local edit");
    view.dispatch({ selection: { anchor: 3 } });
    onSave.mockResolvedValueOnce(false);
    expect(await component.save()).toBe(false);
    expect(component.value).toBe("A local edit");
    expect(editorView(component)).toBe(view);
    expect(view.state.selection.main.anchor).toBe(3);
    expect(await component.save()).toBe(true);
    expect(undo(view)).toBe(true);
    expect(component.value).toBe("Original");
  });

  it("shares a pending save and rejects its ACK as a scope barrier when later edits exist", async () => {
    const { component, onSave } = fixture("Original");
    replace(component, "First edit");
    const gate = deferred<boolean>();
    onSave.mockImplementationOnce(() => gate.promise);
    const pending = component.save();
    expect(component.save()).toBe(pending);
    await Promise.resolve();
    replace(component, "Later edit");
    gate.resolve(true);
    expect(await pending).toBe(false);
    expect(component.value).toBe("Later edit");
    expect(await component.save()).toBe(true);
    expect(onSave).toHaveBeenLastCalledWith("Later edit");
  });

  it("updates clean documents and preserves local edits during external refresh", () => {
    const { component } = fixture("Original");
    component.update("External text");
    expect(component.value).toBe("External text");
    replace(component, "Local draft");
    editorView(component).dispatch({ selection: { anchor: 4 } });
    component.update("Another external text");
    expect(component.value).toBe("Local draft");
    expect(editorView(component).state.selection.main.anchor).toBe(4);
  });

  it("does not turn a rejected or disposed save into success", async () => {
    const { component, onSave } = fixture("Original");
    replace(component, "Local draft");
    onSave.mockRejectedValueOnce(new Error("Disk unavailable"));
    expect(await component.save()).toBe(false);
    const gate = deferred<boolean>();
    onSave.mockImplementationOnce(() => gate.promise);
    const pending = component.save();
    await Promise.resolve();
    component.destroy();
    gate.resolve(true);
    expect(await pending).toBe(false);
    expect(await component.save()).toBe(false);
  });
});
