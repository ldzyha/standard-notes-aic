import { describe, expect, it } from "vitest";
import {
  isMarkdownDocumentName,
  stampFileProperties,
} from "../src/core/file-properties.js";

describe("shared file properties core", () => {
  it("targets ordinary Markdown documents but not note sidecars", () => {
    expect(isMarkdownDocumentName("docs/map.md")).toBe(true);
    expect(isMarkdownDocumentName("docs/map.note.md")).toBe(false);
    expect(isMarkdownDocumentName("docs/map.txt")).toBe(false);
  });

  it("writes only filename, creation, and explicit-save update properties", () => {
    expect(
      stampFileProperties("# Map\n", {
        fileName: "docs/00-documentation-map.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(
      "---\n" +
        "file: 00-documentation-map.md\n" +
        "created: 2026-08-20T10:00:00.000Z\n" +
        "updated: 2026-09-01T18:00:00.000Z\n" +
        "---\n\n" +
        "# Map\n",
    );
  });

  it("preserves creation and body while replacing legacy properties", () => {
    const source =
      "---\r\n" +
      "title: old\r\n" +
      "status: live\r\n" +
      "created: 2026-07-10\r\n" +
      "updated: 2026-07-11\r\n" +
      "---\r\n\r\n" +
      "Body  \r\n";
    expect(
      stampFileProperties(source, {
        fileName: "renamed.md",
        createdAt: "ignored",
        updatedAt: "2026-09-01T18:05:00.000Z",
      }),
    ).toBe(
      "---\r\n" +
        "file: renamed.md\r\n" +
        "created: 2026-07-10\r\n" +
        "updated: 2026-09-01T18:05:00.000Z\r\n" +
        "---\r\n\r\n" +
        "Body  \r\n",
    );
  });

  it("keeps note sidecars byte-identical", () => {
    const source = "---\nlevel: file-note\n---\n\n# Note\n";
    expect(
      stampFileProperties(source, {
        fileName: "file.note.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(source);
  });
});
