import { describe, it, expect } from "vitest";
import { fileScopeNotes } from "../src/pwa/note-scopes";
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
});
