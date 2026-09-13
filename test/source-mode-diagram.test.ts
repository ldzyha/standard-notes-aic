import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/mermaid-runtime.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/mermaid-runtime.js")>();
  const { renderDiagramFixture } = await import("./diagram-svg-fixture");
  return {
    ...actual,
    renderMermaidSvg: (_document: Document, options: { source: string }) =>
      renderDiagramFixture(options.source),
  };
});

import { AicEditor } from "../src/editor";
import { openDiagramEditor } from "../src/core/diagram-session.js";

const editors: AicEditor[] = [];
const diagram = 'flowchart LR\n  A["Start"] --> B["Finish"]\n';
const draft = diagram.replace("Start", "Unsaved draft");
const source = `before\n\n\`\`\`mermaid\n${diagram}\`\`\`\n\nafter`;

function fixture() {
  const host = document.createElement("div");
  document.body.append(host);
  const onSave = vi.fn();
  const onChange = vi.fn();
  const editor = new AicEditor(host, { initialText: source, onSave, onChange });
  editors.push(editor);
  editor.switchDocument("note-a", source);
  const toggle = editor.element.querySelector<HTMLButtonElement>(
    ".aic-source-mode-toggle",
  )!;
  const from = source.indexOf(diagram);
  const range = { from, to: from + diagram.length };
  return { editor, toggle, range, onSave, onChange };
}

function openDraft(editor: AicEditor, range: { from: number; to: number }) {
  const container =
    editor.view.dom.querySelector<HTMLElement>(".cm-mermaid-inline")!;
  const session = openDiagramEditor(editor.view, range, { container })!;
  session.element
    .querySelector<HTMLButtonElement>('[aria-label="Edit Mermaid source"]')!
    .click();
  const input = session.element.querySelector<HTMLTextAreaElement>(
    '[aria-label="Mermaid diagram source"]',
  )!;
  input.value = draft;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return { session, input };
}

async function expectNoPanels(editor: AicEditor) {
  // Flush host release/registration and session update microtasks, not just the
  // immediate compartment transaction: that is where the old recovery leaked.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    editor.view.dom.querySelector(
      ".cm-aic-diagram-inline, .cm-aic-diagram-recovery, .cm-aic-diagram-source-actions, .cm-mermaid-inline",
    ),
  ).toBeNull();
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe("source mode diagram draft suspension", () => {
  it("retains the exact unsaved draft and builder without writing or saving on either toggle", async () => {
    const { editor, toggle, range, onSave, onChange } = fixture();
    const { session, input } = openDraft(editor, range);
    const originalDocument = editor.view.state.doc;
    const builder = session.element.querySelector(".aic-diagram-builder");
    // A second Edit action has already queued focus/reattachment when the user
    // immediately switches to raw mode.
    expect(
      openDiagramEditor(editor.view, range, {
        container: session.element.parentElement!,
      }),
    ).toBe(session);
    toggle.click();
    editor.view.focus();
    await expectNoPanels(editor);
    expect(session.getSource()).toBe(draft);
    expect(session.element.isConnected).toBe(false);
    expect(editor.view.state.doc).toBe(originalDocument);
    expect(editor.view.hasFocus).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    toggle.click();
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    expect(session.element.querySelector(".aic-diagram-builder")).toBe(builder);
    expect(session.element.querySelector("textarea")).toBe(input);
    expect(session.getSource()).toBe(draft);
    expect(editor.view.state.doc).toBe(originalDocument);
    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(session.apply()).toBe(true);
    expect(editor.value).toBe(source.replace(diagram, draft));
  });

  it("blocks retained Apply, Cancel, and save events while source mode is active", async () => {
    const { editor, toggle, range, onSave } = fixture();
    const { session } = openDraft(editor, range);
    const apply =
      session.element.querySelector<HTMLButtonElement>(".aic-db-apply")!;
    const cancel = session.element.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel diagram changes"]',
    )!;
    expect(cancel).toBeDefined();
    toggle.click();
    expect(session.apply()).toBe(false);
    apply.click();
    cancel.click();
    for (const key of ["s", "Escape"])
      session.element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: key === "s",
          bubbles: true,
          cancelable: true,
        }),
      );
    await expectNoPanels(editor);
    expect(editor.value).toBe(source);
    expect(onSave).not.toHaveBeenCalled();
    toggle.click();
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    expect(session.getSource()).toBe(draft);
    expect(session.apply()).toBe(true);
  });

  it("maps raw edits outside the diagram and resumes the same applicable draft", async () => {
    const { editor, toggle, range } = fixture();
    const { session } = openDraft(editor, range);
    toggle.click();
    editor.view.dispatch({ changes: { from: 0, insert: "New prose\n" } });
    await expectNoPanels(editor);
    toggle.click();
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    expect(session.apply()).toBe(true);
    expect(editor.value).toBe("New prose\n" + source.replace(diagram, draft));
  });

  it.each([false, true])(
    "never creates recovery DOM during raw target edits (delete=%s)",
    async (remove) => {
      const { editor, toggle, range, onSave } = fixture();
      const { session } = openDraft(editor, range);
      toggle.click();
      const external = remove
        ? "Only replacement prose"
        : source.replace("Start", "External");
      const changedAt = source.indexOf("Start");
      editor.view.dispatch({
        changes: remove
          ? { from: 0, to: editor.value.length, insert: external }
          : { from: changedAt, to: changedAt + 5, insert: "External" },
      });
      editor.view.focus();
      await expectNoPanels(editor);
      expect(editor.view.hasFocus).toBe(true);
      expect(session.getSource()).toBe(draft);
      expect(session.apply()).toBe(false);
      expect(editor.value).toBe(external);
      toggle.click();
      await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
      expect(session.getSource()).toBe(draft);
      expect(session.apply()).toBe(false);
      expect(
        session.element.querySelector<HTMLButtonElement>(".aic-db-apply")!
          .disabled,
      ).toBe(true);
      expect(
        session.element.querySelector(".cm-aic-diagram-stale-notice")!
          .textContent,
      ).toContain("changed elsewhere");
      expect(editor.value).toBe(external);
      expect(onSave).not.toHaveBeenCalled();
      // An already-stale recovery host must also disappear on subsequent toggles.
      toggle.click();
      await expectNoPanels(editor);
      toggle.click();
      await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    },
  );

  it("retains a newly locked draft off-DOM and returns it with Apply blocked", async () => {
    const { editor, toggle, range } = fixture();
    const { session } = openDraft(editor, range);
    toggle.click();
    editor.setReadOnly(true);
    await expectNoPanels(editor);
    expect(session.apply()).toBe(false);
    toggle.click();
    await vi.waitFor(() => expect(session.element.isConnected).toBe(true));
    expect(session.getSource()).toBe(draft);
    expect(session.apply()).toBe(false);
    expect(
      session.element.querySelector(".cm-aic-diagram-stale-notice")!
        .textContent,
    ).toContain("read-only");
    expect(editor.value).toBe(source);
  });

  it("retires a suspended draft on identity switch and releases the new note", async () => {
    const { editor, toggle, range } = fixture();
    const { session } = openDraft(editor, range);
    toggle.click();
    editor.switchDocument("note-b", source);
    await vi.waitFor(() =>
      expect(
        editor.view.dom.querySelector(".cm-mermaid-inline"),
      ).not.toBeNull(),
    );
    expect(session.element.isConnected).toBe(false);
    expect(session.getSource()).toBe(draft);
    expect(session.apply()).toBe(false);
    const next = openDraft(editor, range).session;
    expect(next).not.toBe(session);
    expect(next.element.isConnected).toBe(true);
  });

  it("releases suspension on identity switch even when there was no draft", () => {
    const { editor, toggle, range } = fixture();
    toggle.click();
    const retainedHost = document.createElement("div");
    editor.view.dom.append(retainedHost);
    expect(
      openDiagramEditor(editor.view, range, { container: retainedHost }),
    ).toBeNull();
    editor.switchDocument("note-b", source);
    expect(openDraft(editor, range).session.element.isConnected).toBe(true);
  });

  it("permanently retires a suspended draft on editor destruction", async () => {
    const { editor, toggle, range } = fixture();
    const { session } = openDraft(editor, range);
    toggle.click();
    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    await Promise.resolve();
    expect(session.getSource()).toBe(draft);
    expect(session.apply()).toBe(false);
    expect(session.element.isConnected).toBe(false);
  });
});
