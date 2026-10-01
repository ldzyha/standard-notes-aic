import { describe, it, expect } from "vitest";
import { fileScopeNotes, scopedNotes } from "../src/pwa/note-scopes";
import { createPwaFile } from "../src/pwa/model";
const file = (path: string) =>
  createPwaFile(path, new TextEncoder().encode(path), "text/markdown", 1);
describe("PWA existing note scope resolution", () => {
  it("resolves nearest sibling folder and project notes without mutating imported files", () => {
    const files = [
      "app/app.note.md",
      "app/src.note.md",
      "app/src/ui.note.md",
      "app/src/ui/button.md",
      "other/other.note.md",
    ].map(file);
    const before = JSON.stringify(files);
    const scopes = fileScopeNotes(files, files[3]!.id);
    expect(scopes.shared?.title).toBe("app/src/ui.note.md");
    expect(scopes.global?.title).toBe("app/app.note.md");
    expect(scopes.current?.id).toBe(files[3]!.id);
    expect(JSON.stringify(files)).toBe(before);
  });
  it("does not invent missing records, use labels, or repeat a project as its own Global", () => {
    const files = ["app/app.note.md", "app/note.md", "loose.md"].map(file);
    expect(fileScopeNotes(files, files[1]!.id).shared).toBeUndefined();
    expect(fileScopeNotes(files, files[0]!.id).global).toBeUndefined();
    expect(fileScopeNotes(files, files[2]!.id).global).toBeUndefined();
  });
  it("resolves imported browser scopes by exact origin with profile Global", () => {
    const current = {
      id: "page",
      url: "https://example.com/path",
      title: "Page",
      markdown: "page",
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    };
    const scopes = scopedNotes(
      {
        format: "aic-notes-pwa",
        version: 1,
        kind: "browser-library",
        library: {
          version: 3,
          notes: [current],
          domains: [
            {
              id: "shared",
              origin: "https://example.com",
              markdown: "shared",
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
            {
              id: "wrong",
              origin: "http://example.com",
              markdown: "wrong",
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
          ],
          global: {
            id: "global",
            scope: "global",
            markdown: "global",
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
          },
          history: [],
        },
      },
      "page",
    );
    expect(scopes.shared?.id).toBe("shared");
    expect(scopes.global?.id).toBe("global");
  });
});
