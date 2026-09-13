import { Compartment, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makePropertiesBlockExtension,
  makeSecurityBlockExtension,
  securityBlocks,
  setPropertyRelationships,
} from "../src/core/security-block.js";
import { parseSecurityBlock } from "../src/core/security-model.js";
import { isSaveAction } from "../src/core/save-boundary.js";
import { securityCardMove } from "../src/core/security-card-order.js";

const note =
  "```aic-security\n# Accounts\n## Work\nEmail: work@example.test\nPassword*: synthetic-hidden-work\n## Personal\nEmail: personal@example.test\nURL: https://example.test\n```\n\nEnd";
const views: EditorView[] = [];
function fixture(doc = note, readOnly = false) {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(() => true);
  const onReadClipboard = vi.fn(async () => "synthetic-paste");
  const saves: boolean[] = [];
  const access = new Compartment();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        access.of(EditorState.readOnly.of(readOnly)),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
        makePropertiesBlockExtension({ document, onCopy, onReadClipboard }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) saves.push(isSaveAction(update));
        }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy, onReadClipboard, saves, access };
}
function control(host: ParentNode, label: string) {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(button, label).not.toBeNull();
  return button!;
}
function search(host: ParentNode, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}
function move(button: HTMLButtonElement, direction = "ArrowDown") {
  button.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: direction,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}
function model(view: EditorView, index = 0) {
  const block = securityBlocks(view.state)[index]!;
  const parsed = parseSecurityBlock(block.body);
  if (!parsed.ok) throw new Error("Synthetic test model invalid");
  return parsed.model;
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("shared compact Security and Properties groups", () => {
  it("renders # as card title, sections separately, and add choices as hidden disclosures", () => {
    const { host, view, saves } = fixture();
    expect(
      host.querySelector(".cm-md-preview-header strong")?.textContent,
    ).toBe("Accounts");
    expect(
      [...host.querySelectorAll(".cm-aic-security-section-title")].map(
        (e) => e.textContent,
      ),
    ).toEqual(["Work", "Personal"]);
    expect(host.querySelector(".cm-aic-security-quick-add")).toBeNull();
    const menu = host.querySelector<HTMLElement>(".cm-aic-security-add-menu")!;
    expect(menu.hidden).toBe(true);
    const add = control(host, "Add field to Work");
    add.click();
    expect(menu.hidden).toBe(false);
    expect(add.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(add);
    expect(view.state.doc.toString()).toBe(note);
    expect(saves).toEqual([]);
  });

  it("filters labels and public values without mutations, focus loss or searching secrets", () => {
    const { host, view, saves } = fixture();
    const card = host.querySelector(".cm-aic-security");
    const selection = view.state.selection;
    const input = search(host, "personal@example.test");
    input.focus();
    expect(
      host.querySelectorAll(".cm-aic-security-section:not([hidden])"),
    ).toHaveLength(1);
    expect(
      host.querySelectorAll(
        ".cm-aic-security-section:not([hidden]) .cm-aic-security-row:not([hidden])",
      ),
    ).toHaveLength(1);
    search(host, "synthetic-hidden-work");
    expect(
      host.querySelectorAll(".cm-aic-security-section:not([hidden])"),
    ).toHaveLength(0);
    expect(
      host.querySelector<HTMLElement>(".cm-aic-security-filter-empty")?.hidden,
    ).toBe(false);
    expect(host.querySelector(".cm-aic-security")).toBe(card);
    expect(view.state.selection).toBe(selection);
    expect(document.activeElement).toBe(input);
    expect(view.state.doc.toString()).toBe(note);
    expect(saves).toEqual([]);
    control(host, "Clear filter").click();
    expect(
      host.querySelectorAll(".cm-aic-security-section:not([hidden])"),
    ).toHaveLength(2);
  });

  it("retains query for same card mutations but resets when replacing the note", () => {
    const { host, view, saves } = fixture();
    search(host, "Email");
    expect(control(host, "Reorder Email").disabled).toBe(true);
    control(host, "Add field to Work").click();
    control(host, "Add Email").click();
    expect(model(view).title).toBe("Accounts");
    expect(model(view).sections[0]!.fields.at(-1)?.label).toBe("Email");
    expect(
      host.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("Email");
    expect(saves).toEqual([true]);
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: note.replace("Accounts", "Next note"),
      },
    });
    expect(
      host.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("");
  });

  it("reorders fields and groups as one undoable saved action with title and secrets preserved", () => {
    const { host, view, saves } = fixture();
    move(control(host, "Reorder Email"));
    expect(model(view).sections[0]!.fields.map((f) => f.label)).toEqual([
      "Password",
      "Email",
    ]);
    expect(model(view).sections[0]!.fields[0]!.value).toBe(
      "synthetic-hidden-work",
    );
    expect(saves).toEqual([true]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(note);
    move(control(host, "Reorder group Work"));
    expect(model(view).sections.map((s) => s.label)).toEqual([
      "Personal",
      "Work",
    ]);
    expect(model(view).title).toBe("Accounts");
    expect(host.querySelector(".cm-aic-security")?.textContent).not.toContain(
      "synthetic-hidden-work",
    );
  });

  it("keeps managed properties and tree pinned while moving exact custom YAML bytes", () => {
    const doc =
      '---\nfile: sample.note.md\ncreated: 2026-09-13T10:00:00Z\nupdated: 2026-09-13T11:00:00Z\nEmail: public@example.test\n# token comment\nPassword*: "synthetic-hidden-work"\nwork:\n  login: someone\npersonal:\n  login: other\n---\nBody';
    const { host, view, saves } = fixture(doc);
    view.dispatch({
      effects: setPropertyRelationships.of([
        {
          relation: "parent",
          label: "Project",
          path: "/Project.note.md",
          exists: true,
        },
      ]),
    });
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(control(card, "Copy file")).toBeTruthy();
    expect(card.querySelector('[aria-label="Reorder file"]')).toBeNull();
    expect(
      card.querySelector('[aria-label="Reorder group Fields"]'),
    ).toBeNull();
    move(control(card, "Reorder Email"));
    expect(view.state.doc.toString()).toBe(
      doc.replace(
        'Email: public@example.test\n# token comment\nPassword*: "synthetic-hidden-work"',
        '# token comment\nPassword*: "synthetic-hidden-work"\nEmail: public@example.test',
      ),
    );
    expect(saves).toEqual([true]);
    search(host, "no-such-public-value");
    const current = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(
      current.querySelectorAll(".cm-aic-security-section:not([hidden])"),
    ).toHaveLength(1);
    expect(
      current.querySelector(".cm-aic-note-relations")?.textContent,
    ).toContain("Project");
    control(current, "Clear filter").click();
    move(control(current, "Reorder group /work"));
    expect(view.state.doc.toString().indexOf("personal:")).toBeLessThan(
      view.state.doc.toString().indexOf("work:"),
    );
  });

  it("read-only cards allow filter/copy but never add, reorder or source editing", () => {
    const { host, view, onCopy } = fixture(note, true);
    expect(host.querySelector(".cm-aic-security-drag")).toBeNull();
    expect(host.querySelector(".cm-aic-security-add")).toBeNull();
    expect(host.querySelector('[aria-label="Edit security block"]')).toBeNull();
    search(host, "Password");
    control(host, "Copy Password").click();
    expect(onCopy).toHaveBeenCalledWith("synthetic-hidden-work", "Password");
    expect(view.state.doc.toString()).toBe(note);
  });

  it("does not offer field reorder that would silently migrate commented legacy YAML", () => {
    const doc =
      '```aic-security\n# authored comment\nservice: Sample\nlogin: User\nannotation: ""\nfields: []\n```';
    const { host, view } = fixture(doc);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(host.querySelector(".cm-aic-security-drag")).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("shows and filters a description but copies only the exact escaped value", () => {
    const text = note
      .replace("```aic-security", "```aic-security v2")
      .replace(
        "Password*: synthetic-hidden-work",
        "Password*: synthetic\\|secret | WebDAV",
      );
    const { host, view, onCopy } = fixture(text);
    expect(
      host.querySelector('[aria-label="Copy Password description value"]')
        ?.textContent,
    ).toBe("WebDAV");
    search(host, "WebDAV");
    const visible = host.querySelector(".cm-aic-security-card:not([hidden])")!;
    control(visible, "Copy Password value").click();
    expect(onCopy).toHaveBeenCalledWith("synthetic|secret", "Password Value");
    expect(visible.textContent).not.toContain("synthetic|secret");
    expect(view.state.doc.toString()).toBe(text);
  });

  it("inherits parent masking when adding a Properties field", () => {
    const text =
      '---\ncredentials*:\n  Password*: "synthetic|secret"\n---\nBody';
    const { host, view } = fixture(text);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(host.textContent).not.toContain("synthetic|secret");
    const group = [...host.querySelectorAll(".cm-aic-security-section")].find(
      (section) => section.textContent?.includes("/credentials*"),
    )!;
    control(group, "Add Field").click();
    expect(view.state.doc.toString()).toContain('  "Field": ""');
    expect(host.querySelector('[aria-label="Paste Field"]')).not.toBeNull();
    expect(host.textContent).not.toContain("synthetic|secret");
  });

  it("discards an in-flight empty-field paste after a reorder", async () => {
    const { host, view, onReadClipboard } = fixture(
      note.replace("synthetic-hidden-work", ""),
    );
    let resolve!: (value: string) => void;
    onReadClipboard.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    control(host, "Paste Password").click();
    move(control(host, "Reorder Email"));
    resolve("stale-value-must-not-land");
    await new Promise((done) => setTimeout(done, 5));
    expect(view.state.doc.toString()).not.toContain(
      "stale-value-must-not-land",
    );
    expect(model(view).sections[0]!.fields[0]!.value).toBe("");
  });

  it("moves whole standalone cards and preserves non-card text; rejects nested/unclosed fences", () => {
    const second =
      "```aic-security\n# Second\n##\nPassword*: other-synthetic\n```";
    const doc = note + "\n\nParagraph between\n\n" + second + "\n\nTail";
    const { host, view, saves } = fixture(doc);
    const handles = host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Reorder security block"]',
    );
    expect(handles).toHaveLength(2);
    move(handles[0]!);
    expect(model(view).title).toBe("Second");
    expect(model(view, 1).title).toBe("Accounts");
    expect(view.state.doc.toString()).toContain("Paragraph between");
    expect(view.state.doc.toString()).toContain("Tail");
    expect(saves).toEqual([true]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    const unclosed = fixture(
      second + "\n\n```aic-security\n## Open\nPassword*: partial",
    ).view;
    const blocks = securityBlocks(unclosed.state);
    expect(securityCardMove(unclosed.state, blocks[0]!, blocks[1]!)).toBeNull();
    const nested = fixture(
      second +
        "\n\n> ```aic-security\n> ## Nested\n> Password*: partial\n> ```",
    ).view;
    const nestedBlocks = securityBlocks(nested.state);
    expect(
      securityCardMove(nested.state, nestedBlocks[0]!, nestedBlocks[1]!),
    ).toBeNull();
  });
});
