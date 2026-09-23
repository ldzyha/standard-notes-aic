import { history, undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { AicEditor } from "../src/editor";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";
import { sortSecurityRecords } from "../src/core/security-model.js";
import { isSaveAction } from "../src/core/save-boundary.js";
import { createSourceModeController } from "../src/core/source-mode.js";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

function fixture(source: string, readOnly = false) {
  const host = document.body.appendChild(document.createElement("div"));
  const saves: boolean[] = [];
  const onCopy = vi.fn(() => true);
  const mode = createSourceModeController();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.readOnly.of(readOnly),
        mode.extension([makeSecurityBlockExtension({ document, onCopy })]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) saves.push(isSaveAction(update));
        }),
      ],
    }),
  });
  views.push(view);
  const button = (label: string) => {
    const element = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(element, label).not.toBeNull();
    return element!;
  };
  return { view, host, mode, button, onCopy, saves };
}

function fenced(body: string) {
  return `<!-- Keep before -->\n\n\`\`\`aic\n${body}\`\`\`\n\n<!-- Keep after -->`;
}

describe("record source ordering", () => {
  it("sorts English and Ukrainian labels naturally, keeping equal and unnamed records stable", () => {
    const labels = [
      "Їжак",
      "Account 10",
      "Ірис",
      "alpha",
      "Ґанок",
      "ALPHA",
      "Гора",
      "Account 2",
      "Єнот",
    ];
    const body = [
      ...labels.map((label, index) => `${label} | value-${index}`),
      '| "unnamed first"',
      'Beta | "between unnamed rows"',
      '*| "unnamed second"',
    ].join("\n");
    expect(sortSecurityRecords(body)).toBe(
      [
        "Гора | value-6",
        "Ґанок | value-4",
        "Єнот | value-8",
        "Ірис | value-2",
        "Їжак | value-0",
        "Account 2 | value-7",
        "Account 10 | value-1",
        "alpha | value-3",
        "ALPHA | value-5",
        'Beta | "between unnamed rows"',
        '| "unnamed first"',
        '*| "unnamed second"',
      ].join("\n"),
    );
  });

  it("preserves section order, exact field spelling, part order, blank lines and line endings", () => {
    const zulu =
      'Zulu  *| "synthetic secret"  | "note\\nline"  1| active 0| used';
    const alpha =
      '"Alpha: work" | "a@example.invalid" _| "4242 4242 4242 1234"';
    const body = `# Authored title\r\n## Zebra\r\n${zulu}\r\n\r\n${alpha}\r\n---\r\n## Alpha\r\nZulu | end\r\nAlpha | start\r\n`;
    const sorted = `# Authored title\r\n## Zebra\r\n${alpha}\r\n\r\n${zulu}\r\n---\r\n## Alpha\r\nAlpha | start\r\nZulu | end\r\n`;
    expect(sortSecurityRecords(body)).toBe(sorted);
    expect(sortSecurityRecords(sorted)).toBe(sorted);
    const invalid =
      "Zulu | valid\n<!-- Preserve unsupported authored content -->\nAlpha | valid\n";
    expect(sortSecurityRecords(invalid)).toBe(invalid);
  });
});

describe("sort on finishing source editing", () => {
  const body = "Zulu *| synthetic-secret | last\nAlpha | first\n";
  const sortedBody = "Alpha | first\nZulu *| synthetic-secret | last\n";

  it("sorts only when leaving an explicitly edited block, in one undoable save", () => {
    const source = fenced(body);
    const { view, host, button, saves } = fixture(source);
    expect(view.state.doc.toString()).toBe(source);
    button("Copy security block").click();
    expect(saves).toEqual([]);
    button("Edit security block").click();
    view.dispatch({ selection: { anchor: source.indexOf("last") } });
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.state.doc.toString()).toBe(fenced(sortedBody));
    expect(host.querySelector(".cm-aic-security")!.innerHTML).not.toContain(
      "synthetic-secret",
    );
    expect(saves).toEqual([true]);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("sorts after Escape, including the final source edit without sorting during typing", () => {
    const source = fenced(body);
    const { view, host, button, saves } = fixture(source);
    button("Edit security block").click();
    const from = source.indexOf("Alpha");
    view.dispatch({
      changes: { from, to: from + 5, insert: "Beta" },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toBe(
      fenced(body.replace("Alpha", "Beta")),
    );
    expect(saves).toEqual([false]);
    view.contentDOM.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toBe(
      fenced(sortedBody.replace("Alpha", "Beta")),
    );
    expect(saves).toEqual([false, true]);
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(host.innerHTML).not.toContain("synthetic-secret");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      fenced(body.replace("Alpha", "Beta")),
    );
  });

  it("restores the real editor's masked preview after Escape sorts multiple sections", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const source = fenced(
      "# Accounts\n## Workspace\nGoogle 10 *| synthetic-password | account@example.test\nGoogle 6 *| synthetic-password | other@example.test\n---\n## Personal\nOTP #| JBSWY3DPEHPK3PXP\nBroken OTP #| !\n",
    );
    const onSave = vi.fn();
    const editor = new AicEditor(host, { initialText: source, onSave });
    try {
      host
        .querySelector<HTMLButtonElement>('[aria-label="Edit security block"]')!
        .click();
      expect(host.querySelector(".cm-aic-security")).toBeNull();
      editor.view.contentDOM.focus();
      editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(editor.value.indexOf("Google 6")).toBeLessThan(
        editor.value.indexOf("Google 10"),
      );
      expect(editor.value.indexOf("Broken OTP")).toBeLessThan(
        editor.value.indexOf("\nOTP"),
      );
      expect(host.querySelector(".cm-aic-security")).not.toBeNull();
      expect(host.innerHTML).not.toContain("synthetic-password");
      expect(host.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(undo(editor.view)).toBe(true);
      expect(editor.value).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  it("sorts all valid security blocks when whole-note source returns to preview", () => {
    const source =
      fenced(body) + "\n\n```js\n// untouched code\n```\n\n" + fenced(body);
    const { view, mode, saves } = fixture(source);
    mode.toggle(view);
    expect(view.state.doc.toString()).toBe(source);
    mode.toggle(view);
    expect(view.state.doc.toString()).toBe(source.replaceAll(body, sortedBody));
    expect(saves).toEqual([true]);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    mode.toggle(view);
    mode.toggle(view);
    const saved = saves.length;
    mode.toggle(view);
    mode.toggle(view);
    expect(saves).toHaveLength(saved);
  });

  it("keeps read-only, invalid, unfinished and retired Properties source unchanged", () => {
    const sources = [
      "```aic\n" + body,
      "```aic-security\n" + body + "```",
      fenced("Zulu | valid\n<!-- Preserve this comment -->\nAlpha | valid\n"),
      "---\nZulu: authored\nAlpha: authored\n---\n\nAfter",
    ];
    for (const source of sources) {
      const { view, mode, saves } = fixture(source);
      mode.toggle(view);
      mode.toggle(view);
      expect(view.state.doc.toString()).toBe(source);
      expect(saves).toEqual([]);
    }
    const source = fenced(body);
    const { view, mode, saves } = fixture(source, true);
    mode.toggle(view);
    mode.toggle(view);
    expect(view.state.doc.toString()).toBe(source);
    expect(saves).toEqual([]);
  });

  it("preserves manual preview reordering until a source edit ends", () => {
    const { view, button, saves } = fixture(fenced(sortedBody));
    button("Reorder Alpha").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toBe(fenced(body));
    expect(saves).toEqual([true]);
    button("Copy security block").click();
    expect(view.state.doc.toString()).toBe(fenced(body));
  });
});
