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

const views: EditorView[] = [];
const aic = (body: string) => `\`\`\`aic\n${body}\n\`\`\`\n`;
function fixture(doc: string, readOnly = true) {
  const host = document.body.appendChild(document.createElement("div"));
  const onOpen = vi.fn();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makePropertiesBlockExtension({ document, onRelationshipOpen: onOpen }),
        makeSecurityBlockExtension({ document, previewOnly: true }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onOpen };
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("retired YAML Properties", () => {
  it.each([
    "---\nPassword*: synthetic-retired-secret\n---\nBody",
    "---\n# aic-fields: v2\nPassword*: synthetic-retired-secret\n---\nBody",
    "---\n# aic-fields: v2\nPassword*: synthetic-retired-secret",
    "---\nPassword*: synthetic-retired-secret\n" +
      aic("Password *| synthetic-nested-secret"),
  ])("keeps legacy bytes opaque without parsing or conversion: %s", (doc) => {
    const { host, view } = fixture(doc);
    expect(host.textContent).toContain(
      "YAML Properties are no longer supported",
    );
    expect(host.innerHTML).not.toContain("synthetic-retired-secret");
    expect(host.innerHTML).not.toContain("synthetic-nested-secret");
    expect(host.querySelector(".cm-aic-security-filter")).toBeNull();
    expect(host.querySelector('[aria-label="Copy Password value"]')).toBeNull();
    view.dispatch({ selection: { anchor: 0, head: doc.length } });
    expect(host.innerHTML).not.toContain("synthetic-retired-secret");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("allows explicit source repair but not incidental selection in an editable note", () => {
    const doc = "---\nPassword*: synthetic-retired-secret\n---\nBody";
    const { host, view } = fixture(doc, false);
    view.dispatch({ selection: { anchor: 0, head: 10 } });
    expect(host.innerHTML).not.toContain("synthetic-retired-secret");
    host
      .querySelector<HTMLButtonElement>('[aria-label="Edit properties"]')!
      .click();
    expect(host.textContent).toContain("synthetic-retired-secret");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not quarantine an ordinary leading horizontal rule and prose", () => {
    const doc = "---\n\nOrdinary Markdown prose without legacy fields.";
    const { host, view } = fixture(doc);
    expect(propertiesBlocks(view.state)).toHaveLength(0);
    expect(host.textContent).toContain("Ordinary Markdown prose");
  });

  it("renders AIC fields once and attaches host-only relationships to the first valid block", () => {
    const doc =
      aic(
        "# Properties\nEmail | public@example.test\nPassword *| synthetic-new-secret",
      ) +
      "\n" +
      aic("# Other\nURL | https://example.test");
    const { host, view, onOpen } = fixture(doc);
    expect(propertiesBlocks(view.state)).toHaveLength(0);
    expect(securityBlocks(view.state)).toHaveLength(2);
    expect(host.querySelectorAll(".cm-aic-security")).toHaveLength(2);
    expect(host.innerHTML).not.toContain("synthetic-new-secret");
    view.dispatch({
      effects: setPropertyRelationships.of([
        {
          relation: "parent",
          label: "Project",
          path: "/project.note.md",
          exists: true,
        },
      ]),
    });
    const cards = host.querySelectorAll(".cm-aic-security");
    expect(cards[0]!.querySelector(".cm-aic-note-relations")).not.toBeNull();
    expect(cards[1]!.querySelector(".cm-aic-note-relations")).toBeNull();
    cards[0]!
      .querySelector<HTMLButtonElement>(
        '[aria-label="Open parent note Project"]',
      )!
      .click();
    expect(onOpen).toHaveBeenCalledWith("/project.note.md");
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("capacity feedback above eighty percent", () => {
  it.each([true, false])(
    "keeps unnamed empty section headers layoutless without drop instructions (read-only: %s)",
    (readOnly) => {
      const { host } = fixture(aic("# Properties"), readOnly);
      expect(
        host
          .querySelector(".cm-aic-security-section-header")
          ?.matches(":empty"),
      ).toBe(true);
      expect(host.querySelector(".cm-aic-security-empty-drop")).toBeNull();
      expect(host.textContent).not.toContain("Drop fields here");
      expect(
        Boolean(host.querySelector('[aria-label="Add row to section"]')),
      ).toBe(!readOnly);
    },
  );

  it("omits counters and advice for ordinary fields", () => {
    const { host } = fixture(aic("# Properties\nEmail | public@example.test"));
    expect(host.querySelector(".cm-aic-security-capacity")).toBeNull();
    expect(host.querySelector(".cm-aic-security-field-count")).toBeNull();
    expect(host.querySelector(".cm-aic-security-capacity-advice")).toBeNull();
  });

  it.each([
    [12, false],
    [13, true],
  ])("warns for %i sections only above eighty percent", (count, warning) => {
    const { host } = fixture(
      aic(
        Array.from(
          { length: count },
          (_, index) => `## Group ${index}\nEmail |`,
        ).join("\n---\n"),
      ),
    );
    expect(Boolean(host.querySelector(".cm-aic-security-capacity"))).toBe(
      warning,
    );
  });

  it.each([
    [51, false],
    [52, true],
  ])("warns for %i fields only above eighty percent", (count, warning) => {
    const { host } = fixture(
      aic(
        "## Group\n" +
          Array.from({ length: count }, (_, index) => `Field ${index} |`).join(
            "\n",
          ),
      ),
    );
    expect(Boolean(host.querySelector(".cm-aic-security-field-count"))).toBe(
      warning,
    );
    expect(
      Boolean(host.querySelector(".cm-aic-security-capacity-advice")),
    ).toBe(warning);
  });

  it.each([
    [13104, false],
    [13105, true],
  ])(
    "warns for a %i-character field without exposing its value",
    (count, warning) => {
      const secret = "x".repeat(count);
      const { host } = fixture(aic(`Password *| ${secret}`));
      expect(Boolean(host.querySelector(".cm-aic-security-capacity"))).toBe(
        warning,
      );
      expect(host.innerHTML).not.toContain(secret);
    },
  );

  it("warns for total text above eighty percent independently of individual fields", () => {
    const body = Array.from(
      { length: 5 },
      (_, index) => `Password ${index} *| ${"x".repeat(10500)}`,
    ).join("\n");
    const { host } = fixture(aic(body));
    expect(
      host.querySelector(".cm-aic-security-capacity")?.textContent,
    ).toContain("Text ");
    expect(
      host.querySelector(".cm-aic-security-capacity")?.textContent,
    ).not.toContain("Largest field");
  });
});
