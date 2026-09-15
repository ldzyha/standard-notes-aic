import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { DomainPropertiesView } from "../src/browser/domain-properties";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";

const secret = "SYNTHETIC-ONLY-SECRET";
const properties =
  '```aic\n# Properties\nPassword *| "' +
  secret +
  '"\nUsername | person@example.com\n```\n';
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

function fixture(initialText: string | null = properties) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn();
  const onSave = vi.fn(async (text: string) => {
    void text;
    return true;
  });
  const onEditingChange = vi.fn();
  const component = new DomainPropertiesView(parent, {
    origin: "https://example.com",
    initialText,
    onChange,
    onSave,
    onEditingChange,
  });
  views.push(component);
  return { parent, component, onChange, onSave, onEditingChange };
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("domain Properties view", () => {
  it("saves state-only Shared actions through the same owner and rejects stale or concurrent intents", async () => {
    const before = "```aic\nCodes 1| synthetic-code\n```\n";
    const after = "```aic\nCodes 0| synthetic-code\n```\n";
    const { component, parent, onChange, onSave } = fixture(before);
    const gate = deferred<boolean>();
    onSave.mockImplementationOnce(() => gate.promise);
    const mutate = (source: string, next: string) =>
      (
        component as unknown as {
          changePreview(before: string, after: string): Promise<boolean>;
        }
      ).changePreview(source, next);
    const pending = mutate(before, after);
    expect(component.value).toBe(after);
    expect(onChange).toHaveBeenCalledWith(after);
    expect(onSave).toHaveBeenCalledWith(after);
    expect(parent.querySelector<HTMLElement>(".cm-editor")!.inert).toBe(true);
    expect(await mutate(after, before)).toBe(false);
    gate.resolve(true);
    expect(await pending).toBe(true);
    expect(await mutate(before, after)).toBe(false);
    expect(parent.innerHTML).not.toContain("synthetic-code");
    expect(component.editing).toBe(false);
    expect(parent.querySelector<HTMLElement>(".cm-editor")!.inert).not.toBe(
      true,
    );
    expect(
      parent.querySelector<HTMLButtonElement>(
        '[aria-label="Reactivate Codes used 1 without copying"]',
      )!.disabled,
    ).toBe(false);
  });

  it("keeps an unsaved consumed-code state as a repairable draft rather than restoring it as unused", async () => {
    const before = "```aic\nCodes 1| synthetic-code\n```\n";
    const after = "```aic\nCodes 0| synthetic-code\n```\n";
    const { component, parent, onSave } = fixture(before);
    onSave.mockResolvedValueOnce(false);
    expect(
      await (
        component as unknown as {
          changePreview(before: string, after: string): Promise<boolean>;
        }
      ).changePreview(before, after),
    ).toBe(false);
    expect(component.value).toBe(after);
    expect(parent.textContent).toContain("Field state was not saved");
    component.startEditing();
    expect(component.value).toBe(after);
    expect(await component.finishEditing()).toBe(true);
    expect(component.value).toBe(after);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("keeps valid secrets masked in a lightweight read-only preview even on selection", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, {
        clipboard: { writeText },
      }),
    );
    const { parent, component } = fixture();
    expect(component.editing).toBe(false);
    expect(parent.querySelector(".aic-editor")).toBeNull();
    const card = parent.querySelector(".cm-aic-security")!;
    expect(card.outerHTML).not.toContain(secret);
    expect(
      parent.querySelector('[aria-label="Copy Password value"]'),
    ).not.toBeNull();
    const preview = (component as unknown as { preview: EditorView }).preview;
    preview.dispatch({
      selection: { anchor: 0, head: preview.state.doc.length },
    });
    expect(parent.querySelector(".cm-aic-security")).not.toBeNull();
    expect(parent.querySelector(".cm-editor")?.textContent).not.toContain(
      secret,
    );
    parent
      .querySelector<HTMLButtonElement>('[aria-label="Copy Password value"]')!
      .click();
    expect(writeText).toHaveBeenCalledWith(secret);
  });

  it("never renders invalid saved source or a fake record for an empty domain", () => {
    const invalid = fixture(`---\nPassword*: ${secret}\n# unclosed`);
    expect(invalid.parent.textContent).not.toContain(secret);
    expect(invalid.parent.querySelector(".cm-aic-security")).toBeNull();
    expect(invalid.parent.textContent).toContain(
      "Edit to repair the saved text",
    );
    invalid.component.startEditing();
    expect(invalid.component.value).toBe(
      `---\nPassword*: ${secret}\n# unclosed`,
    );

    const empty = fixture(null);
    expect(empty.parent.querySelector(".cm-editor")).toBeNull();
    expect(empty.component.element.dataset.empty).toBe("true");
    const edit = empty.parent.querySelector<HTMLButtonElement>(
      ".browser-domain-properties-action",
    )!;
    expect(edit.classList.contains("aic-button--ghost")).toBe(true);
    expect(edit.classList.contains("aic-button--compact")).toBe(true);
    expect(edit.textContent).toBe("Shared");
    expect(edit.getAttribute("aria-label")).toBe("Edit shared properties");
    expect(edit.title).toBe("Add shared properties for https://example.com");
    expect(
      empty.parent.querySelector(".browser-domain-properties-empty"),
    ).toBeNull();
    empty.component.startEditing();
    expect(empty.component.editing).toBe(true);
    expect(empty.component.element.dataset.empty).toBe("false");
    expect(edit.textContent).toBe("Done");
    expect(edit.getAttribute("aria-label")).toBe("Done");
    expect(edit.title).toBe("Save and finish editing shared properties");
    expect(empty.component.value).toBe(AIC_EMPTY_DOCUMENT);
  });

  it("collapses a valid zero-field record but keeps real empty-valued fields", () => {
    const clearedSource = "```aic\n# Properties\n```\n";
    const cleared = fixture(clearedSource);
    expect(cleared.component.element.dataset.empty).toBe("true");
    expect(cleared.parent.querySelector(".cm-editor")).toBeNull();
    expect(
      cleared.parent.querySelector(".browser-domain-properties-action")
        ?.textContent,
    ).toBe("Shared");
    expect(cleared.component.value).toBe(clearedSource);
    cleared.component.startEditing();
    expect(cleared.component.value).toBe(clearedSource);

    const emptyField = fixture('```aic\n# Properties\nEmpty | ""\n```\n');
    expect(emptyField.component.element.dataset.empty).toBe("false");
    expect(emptyField.parent.querySelector(".cm-editor")).not.toBeNull();
  });

  it("keeps editing and its draft on failed save, then returns to preview on acknowledgement", async () => {
    const { parent, component, onChange, onSave, onEditingChange } = fixture();
    onSave.mockResolvedValueOnce(false);
    component.startEditing();
    const editor = parent.querySelector(".aic-editor")!;
    component.setSaveState("dirty", true, "saving");
    expect(editor.getAttribute("data-save-feedback")).toBe("saving");
    expect(
      parent.querySelector<HTMLButtonElement>(
        ".browser-domain-properties-action",
      )?.disabled,
    ).toBe(false);
    expect(
      parent
        .querySelector(".browser-domain-properties-action")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    component.setSaveState("dirty", false, "dirty");
    const source = parent.querySelector<HTMLButtonElement>(
      '[aria-label="Show Markdown source"]',
    )!;
    source.click();
    const view = component.element.querySelector(".cm-editor")!;
    expect(view).not.toBeNull();
    const value = component.value!;
    const editView = editorView(component);
    editView.dispatch({ changes: { from: value.length, insert: "\n" } });
    expect(onChange).toHaveBeenCalled();
    expect(await component.finishEditing()).toBe(false);
    expect(component.editing).toBe(true);
    expect(parent.querySelector(".aic-editor")).toBe(editor);
    expect(parent.textContent).toContain("not saved");
    const selectionBefore = editView.state.selection.main.anchor;
    const dirtyText = component.value;
    component.update(
      properties.replace("person@example.com", "other@example.com"),
    );
    expect(parent.querySelector(".aic-editor")).toBe(editor);
    expect(editView.state.selection.main.anchor).toBe(selectionBefore);
    expect(component.value).toBe(dirtyText);
    expect(await component.finishEditing()).toBe(true);
    expect(component.editing).toBe(false);
    expect(parent.querySelector(".cm-aic-security")).not.toBeNull();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([
      true,
      false,
    ]);
  });

  it("does not persist an untouched in-memory seed", async () => {
    const { component, onSave } = fixture(null);
    component.startEditing();
    expect(await component.finishEditing()).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(component.element.textContent).toContain("Shared");
    expect(component.element.textContent).not.toContain(
      "No shared properties yet",
    );
  });

  it.each(["mouse", "keyboard"])(
    "lets %s Done activation finish the boundary save already started by blur",
    async (input) => {
      const { parent, component, onSave, onEditingChange } = fixture();
      const gate = deferred<boolean>();
      onSave.mockImplementationOnce(() => gate.promise);
      component.startEditing();
      const view = editorView(component);
      const next = properties.replace("person@example.com", "blur@example.com");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
      view.focus();
      const done = parent.querySelector<HTMLButtonElement>(
        ".browser-domain-properties-action",
      )!;
      if (input === "mouse")
        done.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      // Native focus transfer fires editor blur before the browser dispatches click.
      done.focus();
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(done.disabled).toBe(false);
      expect(done.getAttribute("aria-busy")).toBe("true");
      expect(document.activeElement).toBe(done);
      // Browsers activate a focused native button on Enter/Space with a click too.
      if (input === "keyboard")
        done.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      done.click();
      done.click();
      expect(onSave).toHaveBeenCalledOnce();
      gate.resolve(true);
      await vi.waitFor(() => expect(component.editing).toBe(false));
      expect(parent.textContent).toContain("blur@example.com");
      expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([
        true,
        false,
      ]);
    },
  );

  it("restores an incomplete draft in the editor without exposing it in read-only preview", () => {
    const incomplete = `---\n# aic-fields: v2\nPassword*: ${secret}`;
    const { parent, component } = fixture(null);
    expect(parent.innerHTML).not.toContain(secret);
    component.startEditing(incomplete);
    expect(component.editing).toBe(true);
    expect(component.value).toBe(incomplete);
    expect(editorView(component).state.doc.toString()).toBe(incomplete);
  });

  it("synchronizes a clean open editor to newer saved data without making a stale write", async () => {
    const { parent, component, onChange, onSave } = fixture();
    component.startEditing();
    const editor = parent.querySelector(".aic-editor");
    const newer = properties.replace("person@example.com", "new@example.com");
    component.update(newer);
    expect(parent.querySelector(".aic-editor")).toBe(editor);
    expect(component.value).toBe(newer);
    expect(onChange).not.toHaveBeenCalled();
    expect(await component.finishEditing()).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(parent.querySelector(".cm-aic-security")?.outerHTML).toContain(
      "new@example.com",
    );
  });

  it("keeps the latest edit open when an older save is acknowledged late", async () => {
    const { parent, component, onSave } = fixture();
    const first = properties.replace("person@example.com", "first@example.com");
    const latest = properties.replace(
      "person@example.com",
      "latest@example.com",
    );
    const gate = deferred<boolean>();
    onSave.mockImplementationOnce(() => gate.promise);
    component.startEditing();
    const view = editorView(component);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: first },
    });
    const finishing = component.finishEditing();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: latest },
    });
    gate.resolve(true);
    expect(await finishing).toBe(false);
    expect(component.editing).toBe(true);
    expect(component.value).toBe(latest);
    expect(parent.querySelector(".cm-aic-security")?.outerHTML).not.toContain(
      "first@example.com",
    );
    expect(await component.finishEditing()).toBe(true);
    expect(component.editing).toBe(false);
    expect(parent.querySelector(".cm-aic-security")?.outerHTML).toContain(
      "latest@example.com",
    );
    expect(onSave.mock.calls.map(([text]) => text)).toEqual([first, latest]);
  });
});
