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

const frontmatter = [
  "---",
  "file: vault.note.md",
  "created: 2026-08-20T10:00:00.000Z",
  "updated: 2026-08-21T10:00:00.000Z",
  'Password*: ""',
  'Email: ""',
  "URL: https://example.com/login",
  "credentials:",
  '  Recovery codes*: ""',
  "---",
  "# Body",
].join("\n");

const views: EditorView[] = [];
function fixture(text = frontmatter, readOnly = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const onCopy = vi.fn(() => true);
  const onOpen = vi.fn();
  const onReadClipboard = vi.fn(async () => "SYNTHETIC-ONLY-SECRET");
  const onRelationshipOpen = vi.fn();
  const actions: boolean[] = [];
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ document, onCopy, onOpen }),
        makePropertiesBlockExtension({
          document,
          onCopy,
          onOpen,
          onReadClipboard,
          onRelationshipOpen,
        }),
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

function control(host: HTMLElement, label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("shared Properties renderer", () => {
  it("detects only closed offset-zero frontmatter and coexists with security fences", () => {
    const text = `${frontmatter}\n\n\`\`\`aic\n## Main\nPassword*: secret\n\`\`\`\n\nTail`;
    const { host, view } = fixture(text);
    expect(propertiesBlocks(view.state)).toHaveLength(1);
    expect(securityBlocks(view.state)).toHaveLength(1);
    expect(host.querySelectorAll(".cm-aic-properties")).toHaveLength(1);
    expect(
      host.querySelectorAll(".cm-aic-security:not(.cm-aic-properties)"),
    ).toHaveLength(1);
    const securityCard = host.querySelector(
      ".cm-aic-security:not(.cm-aic-properties)",
    );
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(host.querySelector(".cm-aic-security:not(.cm-aic-properties)")).toBe(
      securityCard,
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " more" },
    });
    expect(host.querySelector(".cm-aic-security:not(.cm-aic-properties)")).toBe(
      securityCard,
    );
    expect(
      propertiesBlocks(EditorState.create({ doc: "# H\n---\nx: y\n---" })),
    ).toHaveLength(0);
    expect(
      propertiesBlocks(EditorState.create({ doc: "---\nx: y\n# H" })),
    ).toHaveLength(0);
    expect(
      propertiesBlocks(EditorState.create({ doc: "---\nx: y\n..." })),
    ).toHaveLength(1);
  });

  it("shows compact copy-only dates, omits the duplicate filename, and keeps secrets out of metadata", () => {
    const { host, onCopy, onOpen } = fixture(
      frontmatter.replace(
        'Password*: ""',
        'Password*: "SYNTHETIC-ONLY-SECRET"',
      ),
    );
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(
      card.querySelector(".cm-md-preview-header strong")?.textContent,
    ).toBe("Properties");
    expect(card.outerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    expect(card.querySelector('[aria-label="Copy file"]')).toBeNull();
    expect(card.textContent).not.toContain("vault.note.md");
    expect(card.querySelector('[aria-label="Paste file"]')).toBeNull();
    expect(
      card.querySelector('[aria-label="Delete empty file field"]'),
    ).toBeNull();
    expect(
      card.querySelector('[aria-label="Add security section"]'),
    ).toBeNull();
    expect(card.querySelector('[aria-label="New security block"]')).toBeNull();
    expect(card.querySelector(".cm-aic-properties-metadata")).not.toBeNull();
    expect(
      card.querySelector('[aria-label="Copy created"]')?.textContent,
    ).not.toContain("2026-08-20T10:00:00.000Z");
    control(card, "Copy created").click();
    expect(onCopy).toHaveBeenCalledWith("2026-08-20T10:00:00.000Z", "created");
    control(card, "Copy updated").click();
    expect(onCopy).toHaveBeenCalledWith("2026-08-21T10:00:00.000Z", "updated");
    control(card, "Copy properties").click();
    expect(onCopy).toHaveBeenCalledWith(
      frontmatter
        .replace('Password*: ""', 'Password*: "SYNTHETIC-ONLY-SECRET"')
        .split("\n# Body")[0],
      "properties",
    );
    control(card, "Open URL").click();
    expect(onOpen).toHaveBeenCalledWith("https://example.com/login");
  });

  it("shows managed-only frontmatter without an empty custom grid or filter", () => {
    const source = [
      "---",
      "file: vault.note.md",
      "created: 2026-08-20T10:00:00.000Z",
      "updated: 2026-08-21T10:00:00.000Z",
      "---",
      "# Body",
    ].join("\n");
    const { host, view } = fixture(source);
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(card.querySelectorAll(".cm-aic-properties-date")).toHaveLength(2);
    expect(card.querySelector(".cm-aic-security-row")).toBeNull();
    expect(card.querySelector(".cm-aic-security-filter")).toBeNull();
    expect(card.querySelector(".cm-aic-security-section-title")).toBeNull();
    expect(card.querySelector('[aria-label="Add Field"]')).not.toBeNull();
    expect(card.textContent).not.toContain("vault.note.md");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("uses the shared empty-field Paste and quick-add actions with save annotation", async () => {
    const { host, view, onReadClipboard, actions } = fixture();
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    control(card, "Paste Password").click();
    expect(onReadClipboard).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toContain(
        'Password*: "SYNTHETIC-ONLY-SECRET"',
      ),
    );
    expect(actions.at(-1)).toBe(true);
    expect(host.querySelector(".cm-aic-properties")?.outerHTML).not.toContain(
      "SYNTHETIC-ONLY-SECRET",
    );
    expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
    control(host, "Add Field").click();
    expect(view.state.doc.toString()).toContain('"Field": ""');
    expect(actions.at(-1)).toBe(true);
  });

  it("places the heading-free relation tree before the shared custom-field panel and updates it", () => {
    const { host, view, onRelationshipOpen } = fixture();
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
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    const groups = card.querySelectorAll(".cm-aic-security-section");
    const tree = card.querySelector(".cm-aic-note-relations")!;
    expect(groups).toHaveLength(2);
    expect(tree.textContent).not.toContain("Context");
    const metadata = card.querySelector(".cm-aic-properties-metadata")!;
    expect(
      metadata.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tree.compareDocumentPosition(groups[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    control(card, "Open parent note Synthetic parent").click();
    expect(onRelationshipOpen).toHaveBeenCalledWith("/parent.note.md");
    view.dispatch({ effects: setPropertyRelationships.of([]) });
    expect(host.querySelector(".cm-aic-note-relations")).toBeNull();
  });

  it("inherits masking when quick-adding a field inside a hidden custom group", async () => {
    const { host, view } = fixture(
      '---\ncredentials*:\n  existing: ""\n---\n# Body',
    );
    const groups = host.querySelectorAll<HTMLElement>(
      ".cm-aic-properties .cm-aic-security-section",
    );
    const nested = [...groups].find((group) =>
      group.textContent?.includes("/credentials*"),
    )!;
    control(nested, "Add Field").click();
    expect(view.state.doc.toString()).toContain('  "Field": ""');
    const refreshed = host.querySelectorAll<HTMLElement>(
      ".cm-aic-properties .cm-aic-security-section",
    );
    const newGroup = [...refreshed].find((group) =>
      group.textContent?.includes("/credentials*"),
    )!;
    expect(
      newGroup.querySelector('[aria-label="Copy Field value"]')?.textContent,
    ).toBe("—");
    control(newGroup, "Paste Field").click();
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toContain(
        '  "Field": "SYNTHETIC-ONLY-SECRET"',
      ),
    );
    expect(host.querySelector(".cm-aic-properties")?.outerHTML).not.toContain(
      "SYNTHETIC-ONLY-SECRET",
    );
  });

  it("reveals source for editing and leaves read-only cards copyable", () => {
    const writable = fixture();
    control(writable.host, "Edit properties").click();
    expect(writable.host.querySelector(".cm-aic-properties")).toBeNull();
    writable.view.dispatch({
      selection: { anchor: writable.view.state.doc.length },
    });
    expect(writable.host.querySelector(".cm-aic-properties")).not.toBeNull();
    const readOnly = fixture(frontmatter, true);
    expect(readOnly.host.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(
      readOnly.host.querySelector('[aria-label="Edit properties"]'),
    ).toBeNull();
    expect(
      readOnly.host.querySelector('[aria-label="Paste Email"]'),
    ).toBeNull();
    expect(readOnly.onCopy).not.toHaveBeenCalled();
    control(readOnly.host, "Copy Email").click();
    expect(readOnly.onCopy).toHaveBeenCalledWith("Email", "Email label");
    control(readOnly.host, "Copy created").click();
    expect(readOnly.onCopy).toHaveBeenCalledWith(
      "2026-08-20T10:00:00.000Z",
      "created",
    );
  });

  it("masks invalid YAML until explicit source editing", () => {
    const malformed = "---\npassword: [SYNTHETIC-ONLY-SECRET\n---\n# Body";
    const { host, onCopy } = fixture(malformed);
    const card = host.querySelector<HTMLElement>(".cm-aic-properties")!;
    expect(card.textContent).toContain("Line 3, column 1");
    expect(card.textContent).toContain("YAML syntax or indentation");
    expect(card.outerHTML).not.toContain("SYNTHETIC-ONLY-SECRET");
    control(card, "Copy properties").click();
    expect(onCopy).toHaveBeenCalledWith(
      "---\npassword: [SYNTHETIC-ONLY-SECRET\n---",
      "properties",
    );
    control(card, "Edit properties").click();
    expect(host.querySelector(".cm-aic-properties")).toBeNull();
  });
});
