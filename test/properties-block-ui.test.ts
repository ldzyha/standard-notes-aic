import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makePropertiesBlockExtension,
  makeSecurityBlockExtension,
  propertiesBlocks,
  securityBlocks,
  setPropertyRelationships,
} from "../src/core/security-block.js";
import { isSaveAction } from "../src/core/save-boundary.js";

const properties =
  "```aic\n# Properties\nPassword *|\nEmail |\nURL | https://example.com/login\n---\n## Credentials\nRecovery codes 1|\n```\n\n# Body";
const views: EditorView[] = [];
function fixture(text = properties, readOnly = false) {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(() => true),
    onOpen = vi.fn(),
    onReadClipboard = vi.fn(async () => "SYNTHETIC-ONLY-SECRET"),
    onRelationshipOpen = vi.fn();
  const actions: boolean[] = [];
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({
          document,
          onCopy,
          onOpen,
          onReadClipboard,
          previewOnly: true,
        }),
        makePropertiesBlockExtension({ document, onCopy, onRelationshipOpen }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) actions.push(isSaveAction(update));
        }),
      ],
    }),
  });
  views.push(view);
  return {
    host,
    view,
    onCopy,
    onOpen,
    onReadClipboard,
    onRelationshipOpen,
    actions,
  };
}
function control(host: ParentNode, label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    '[aria-label="' + label + '"]',
  );
  expect(found, label).not.toBeNull();
  return found!;
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});
describe("Properties share the AIC renderer", () => {
  it("quarantines leading legacy frontmatter while rendering later canonical blocks once", () => {
    const legacy = "---\nPassword*: synthetic-legacy\n---";
    const { host, view } = fixture(legacy + "\n\n" + properties);
    expect(propertiesBlocks(view.state)).toHaveLength(1);
    expect(securityBlocks(view.state)).toHaveLength(1);
    expect(host.querySelectorAll(".cm-aic-security")).toHaveLength(2);
    expect(host.querySelector(".cm-aic-properties")!.textContent).toContain(
      "no longer supported",
    );
    expect(host.innerHTML).not.toContain("synthetic-legacy");
    expect(
      propertiesBlocks(EditorState.create({ doc: "# H\n---\nx: y\n---" })),
    ).toHaveLength(0);
    expect(
      propertiesBlocks(EditorState.create({ doc: "---\nx: y\n# H" })),
    ).toHaveLength(1);
  });
  it("does not interpret old managed dates, filename or nested secrets", () => {
    const doc =
      "---\nfile: vault.note.md\ncreated: 2026-08-20T10:00:00Z\nupdated: 2026-08-21T10:00:00Z\ncredentials*:\n  Password: SYNTHETIC-ONLY-SECRET\n---\nBody";
    const { host, view, onCopy } = fixture(doc);
    const card = host.querySelector(".cm-aic-properties")!;
    for (const value of [
      "vault.note.md",
      "2026-08-20",
      "SYNTHETIC-ONLY-SECRET",
    ])
      expect(card.innerHTML).not.toContain(value);
    expect(card.querySelector(".cm-aic-properties-metadata")).toBeNull();
    expect(card.querySelector(".cm-aic-security-row")).toBeNull();
    control(card, "Copy properties").click();
    expect(onCopy).toHaveBeenCalledWith(doc.split("\nBody")[0], "properties");
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("renders canonical fields with masking and independent copy/open actions", () => {
    const { host, onCopy, onOpen } = fixture(
      properties.replace("Password *|", "Password *| SYNTHETIC-ONLY-SECRET"),
    );
    const card = host.querySelector(".cm-aic-security")!;
    expect(card.querySelector(".aic-card__title")?.textContent).toBe(
      "Properties",
    );
    expect(card.innerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    control(card, "Copy Password label").click();
    expect(onCopy).toHaveBeenLastCalledWith("Password", "Password label");
    control(card, "Copy Password value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "SYNTHETIC-ONLY-SECRET",
      "Password",
    );
    control(card, "Open URL").click();
    expect(onOpen).toHaveBeenCalledWith("https://example.com/login");
  });
  it("uses shared Paste and Add actions with a save annotation, never overwriting a filled field", async () => {
    const { host, view, onReadClipboard, actions } = fixture();
    control(host, "Paste Password").click();
    expect(onReadClipboard).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toContain(
        "Password *| SYNTHETIC-ONLY-SECRET",
      ),
    );
    expect(actions.at(-1)).toBe(true);
    expect(host.innerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
    control(host, "Add field to Email").click();
    control(host, "Add text field to Email").click();
    expect(view.state.doc.toString()).toContain("Email | |");
    expect(actions.at(-1)).toBe(true);
  });
  it("keeps the host relation tree before fields and updates it without writing source", () => {
    const { host, view, onRelationshipOpen, actions } = fixture();
    view.dispatch({
      effects: setPropertyRelationships.of([
        {
          relation: "parent",
          label: "Synthetic parent",
          path: "/parent.note.md",
          depth: 1,
          exists: true,
        },
      ]),
    });
    const card = host.querySelector(".cm-aic-security")!;
    const tree = card.querySelector(".cm-aic-note-relations")!;
    const body = card.querySelector(".cm-aic-security-body")!;
    expect(tree.textContent).not.toContain("Context");
    expect(
      tree.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    control(card, "Open parent note Synthetic parent").click();
    expect(onRelationshipOpen).toHaveBeenCalledWith("/parent.note.md");
    view.dispatch({ effects: setPropertyRelationships.of([]) });
    expect(host.querySelector(".cm-aic-note-relations")).toBeNull();
    expect(actions).toEqual([]);
  });
  it("requires explicit field masking rather than inherited YAML parent masking", () => {
    const { host, view } = fixture(
      "```aic\n# Properties\n## Credentials\nPassword *| SYNTHETIC-ONLY-SECRET\nEmail | public@example.test\n```",
    );
    expect(host.innerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    expect(host.textContent).toContain("public@example.test");
    control(host, "Add field to Password").click();
    control(host, "Add secret field to Password").click();
    expect(view.state.doc.toString()).toContain(
      "Password *| SYNTHETIC-ONLY-SECRET *|\n",
    );
  });
  it("uses explicit source Edit and keeps read-only fields copyable without mutation controls", () => {
    const writable = fixture();
    control(writable.host, "Edit security block").click();
    expect(writable.host.querySelector(".cm-aic-security")).toBeNull();
    writable.view.dispatch({
      selection: { anchor: writable.view.state.doc.length },
    });
    expect(writable.host.querySelector(".cm-aic-security")).not.toBeNull();
    const readOnly = fixture(properties, true);
    expect(
      readOnly.host.querySelector('[aria-label="Edit security block"]'),
    ).toBeNull();
    expect(
      readOnly.host.querySelector('[aria-label="Paste Email"]'),
    ).toBeNull();
    control(readOnly.host, "Copy Email label").click();
    expect(readOnly.onCopy).toHaveBeenCalledWith("Email", "Email label");
  });
  it("keeps malformed retired YAML opaque until explicit raw source repair", () => {
    const doc = "---\npassword: [SYNTHETIC-ONLY-SECRET\n---\nBody";
    const { host, view } = fixture(doc);
    const card = host.querySelector(".cm-aic-properties")!;
    expect(card.textContent).toContain("no longer supported");
    expect(card.innerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    control(card, "Edit properties").click();
    expect(host.querySelector(".cm-aic-properties")).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });
});
