import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  parseTable,
  safeExternalUrl,
} from "../src/block-views";

describe("AIC derived Markdown blocks", () => {
  it("parses only simple leading top-level properties", () => {
    const source = "---\nstatus: idea\ntags: aic, notes\n---\nBody";
    expect(parseFrontmatter(source)).toEqual({
      from: 0,
      to: source.indexOf("\nBody"),
      rows: [
        { key: "status", value: "idea" },
        { key: "tags", value: "aic, notes" },
      ],
    });
  });

  it.each([
    "---\n---\nBody",
    "---\nstatus: one\nstatus: two\n---",
    "---\nparent:\n  child: value\n---",
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
