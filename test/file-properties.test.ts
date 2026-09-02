import { describe, expect, it } from "vitest";
import {
  isManagedNoteName,
  isMarkdownDocumentName,
  stampFileProperties,
} from "../src/core/file-properties.js";

describe("shared file properties core", () => {
  it("targets note sidecars but not ordinary Markdown documents", () => {
    expect(isManagedNoteName("docs/map.md")).toBe(false);
    expect(isManagedNoteName("docs/map.note.md")).toBe(true);
    expect(isMarkdownDocumentName("docs/map.note.md")).toBe(true);
    expect(isMarkdownDocumentName("docs/map.txt")).toBe(false);
  });

  it("writes only filename, creation, and explicit-save update properties", () => {
    expect(
      stampFileProperties("# Map\n", {
        fileName: "docs/00-documentation-map.note.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(
      "---\n" +
        "file: 00-documentation-map.note.md\n" +
        "created: 2026-08-20T10:00:00.000Z\n" +
        "updated: 2026-09-01T18:00:00.000Z\n" +
        "---\n\n" +
        "# Map\n",
    );
  });

  it("preserves authored note properties, creation, and body", () => {
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
        fileName: "renamed.note.md",
        createdAt: "ignored",
        updatedAt: "2026-09-01T18:05:00.000Z",
      }),
    ).toBe(
      "---\r\n" +
        "file: renamed.note.md\r\n" +
        "created: 2026-07-10\r\n" +
        "updated: 2026-09-01T18:05:00.000Z\r\n" +
        "title: old\r\n" +
        "status: live\r\n" +
        "---\r\n\r\n" +
        "Body  \r\n",
    );
  });

  it("removes the complete legacy generated note signature", () => {
    const source =
      "---\n" +
      "file: app.note.md\n" +
      "created: 2026-07-10\n" +
      "updated: 2026-07-11\n" +
      "title: app.js\n" +
      "level: file-note\n" +
      "scope: \n" +
      "status: live\n" +
      "agent: true\n" +
      "owner: team-a\n" +
      "---\n\n" +
      "Body\n";
    expect(
      stampFileProperties(source, {
        fileName: "app.note.md",
        updatedAt: "2026-09-02T08:00:00.000Z",
      }),
    ).toBe(
      "---\n" +
        "file: app.note.md\n" +
        "created: 2026-07-10\n" +
        "updated: 2026-09-02T08:00:00.000Z\n" +
        "owner: team-a\n" +
        "---\n\n" +
        "Body\n",
    );
  });

  it("keeps ordinary Markdown documents byte-identical", () => {
    const source = "---\nstatus: document\n---\n\n# Document\n";
    expect(
      stampFileProperties(source, {
        fileName: "file.md",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-09-01T18:00:00.000Z",
      }),
    ).toBe(source);
  });

  it("removes the legacy managed signature from ordinary Markdown", () => {
    const source =
      "---\nfile: map.md\ncreated: 2026-08-20\nupdated: 2026-09-01\nstatus: draft\n---\n\n# Map\n";
    expect(
      stampFileProperties(source, {
        fileName: "map.md",
        updatedAt: "2026-09-02T08:00:00.000Z",
      }),
    ).toBe("---\nstatus: draft\n---\n\n# Map\n");
  });
});
