import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  parseTable,
  safeExternalUrl,
} from "../src/block-views";
import {
  moveProperty,
  serializeFrontmatter,
  updateProperty,
} from "../src/core/structured-preview.js";

describe("AIC derived Markdown blocks", () => {
  it("parses simple leading properties with stable source metadata", () => {
    const source = "---\nstatus: idea\ntags: aic, notes\n---\nBody";
    expect(parseFrontmatter(source)).toEqual({
      from: 0,
      to: source.indexOf("\nBody"),
      rows: [
        {
          key: "status",
          value: "idea",
          indent: 0,
          depth: 0,
          sequence: false,
          scalar: false,
          spacing: " ",
        },
        {
          key: "tags",
          value: "aic, notes",
          indent: 0,
          depth: 0,
          sequence: false,
          scalar: false,
          spacing: " ",
        },
      ],
    });
  });

  it("round-trips nested maps and mapping sequences at their real levels", () => {
    const frontmatter = [
      "---",
      "document:",
      "  type: index",
      "traceability:",
      "  requirements:",
      "    - type: fsd",
      "      title: Engraving Elevation",
      "      role: primary",
      "    - type: jira",
      "      id: EPC-32962",
      "      role: v1-study",
      "---",
    ].join("\n");
    const parsed = parseFrontmatter(`${frontmatter}\n\nBody`);
    expect(parsed).not.toBeNull();
    expect(
      parsed!.rows.map(({ key, depth, sequence }) => ({
        key,
        depth,
        sequence,
      })),
    ).toEqual([
      { key: "document", depth: 0, sequence: false },
      { key: "type", depth: 1, sequence: false },
      { key: "traceability", depth: 0, sequence: false },
      { key: "requirements", depth: 1, sequence: false },
      { key: "type", depth: 2, sequence: true },
      { key: "title", depth: 3, sequence: false },
      { key: "role", depth: 3, sequence: false },
      { key: "type", depth: 2, sequence: true },
      { key: "id", depth: 3, sequence: false },
      { key: "role", depth: 3, sequence: false },
    ]);
    expect(serializeFrontmatter(parsed!.rows)).toBe(frontmatter);

    const changed = updateProperty(parsed!.rows, 8, "value", "EPC-33349");
    expect(serializeFrontmatter(changed)).toContain("      id: EPC-33349");
    const moved = moveProperty(changed, 7, 4);
    expect(serializeFrontmatter(moved)).toContain(
      "    - type: jira\n      id: EPC-33349\n      role: v1-study\n    - type: fsd",
    );
  });

  it.each([
    "---\n---\nBody",
    "---\nstatus: one\nstatus: two\n---",
    "Body\n---\nstatus: idea\n---",
    "---\n- list\n---",
  ])("keeps unsupported properties raw: %s", (source) => {
    expect(parseFrontmatter(source)).toBeNull();
  });

  it("parses table alignment and escaped pipes", () => {
    expect(
      parseTable("| A \\| B | C | D |\n| :--- | :---: | ---: |\n| x | y | z |"),
    ).toEqual({
      header: ["A | B", "C", "D"],
      aligns: ["left", "center", "right"],
      rows: [["x", "y", "z"]],
    });
  });

  it.each(["| A | B |", "| A | B |\n| -- | --- |", "| A | B |\n| --- |"])(
    "rejects an invalid table: %s",
    (source) => {
      expect(parseTable(source)).toBeNull();
    },
  );

  it("allows only explicit safe external URL schemes", () => {
    expect(safeExternalUrl("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(safeExternalUrl("mailto:notes@example.com")).toBe(
      "mailto:notes@example.com",
    );
    expect(safeExternalUrl("javascript:alert(1)")).toBe("");
    expect(safeExternalUrl("/private/note")).toBe("");
  });
});
