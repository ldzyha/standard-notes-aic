import { describe, expect, it } from "vitest";
import { FolderIgnore, isHardExcludedPath } from "../src/pwa/folder-ignore";

describe("scoped folder ignore", () => {
  it("anchors slash patterns to their scope and matches slashless names below it", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".gitignore", "/build\n*.tmp\nlogs/");
    expect(rules.isIgnored("build", true)).toBe(true);
    expect(rules.isIgnored("nested/build", true)).toBe(false);
    expect(rules.isIgnored("nested/note.tmp")).toBe(true);
    expect(rules.isIgnored("nested/logs/file.md")).toBe(true);
    expect(rules.isIgnored("logs")).toBe(false);
  });

  it("handles globstars, comments, escaped markers and spaces through the package", () => {
    const rules = new FolderIgnore();
    rules.addRules(
      "",
      ".gitignore",
      "# comment\n**/cache/*.md\n\\#literal.md\n\\!literal.md\ntrailing.md   \nspace\\ \n",
    );
    for (const path of [
      "cache/a.md",
      "a/b/cache/a.md",
      "#literal.md",
      "!literal.md",
      "trailing.md",
      "space ",
    ])
      expect(rules.isIgnored(path)).toBe(true);
    expect(rules.isIgnored("comment")).toBe(false);
    expect(rules.isIgnored("cache/a.txt")).toBe(false);
    expect(rules.isIgnored("space")).toBe(false);
  });

  it("gives .ignore precedence regardless of registration order", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".ignore", "!keep.md\nblocked.md");
    rules.addRules("", ".gitignore", "*.md\n!blocked.md");
    expect(rules.isIgnored("keep.md")).toBe(false);
    expect(rules.isIgnored("blocked.md")).toBe(true);
    expect(rules.isIgnored("other.md")).toBe(true);
  });

  it("lets deeper rules override applicable ancestor file rules in both directions", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".gitignore", "*.md\n!public.md");
    rules.addRules("docs", ".gitignore", "!keep.md\npublic.md\n/local.md");
    rules.addRules("docs/nested", ".ignore", "!local.md");
    expect(rules.isIgnored("docs/keep.md")).toBe(false);
    expect(rules.isIgnored("elsewhere/keep.md")).toBe(true);
    expect(rules.isIgnored("docs/public.md")).toBe(true);
    expect(rules.isIgnored("docs/nested/local.md")).toBe(false);
  });

  it("does not reopen a pruned directory from rules or negation under it", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".gitignore", "private/\n!private/keep.md");
    rules.addRules("private", ".ignore", "!*.md");
    expect(rules.isIgnored("private", true)).toBe(true);
    expect(rules.isIgnored("private/keep.md")).toBe(true);
    rules.addRules("", ".ignore", "!private/");
    expect(rules.isIgnored("private/keep.md")).toBe(false);
  });

  it("hard-skips nested metadata directories case-insensitively, retaining root", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".ignore", "!**/*");
    for (const path of [".GIT", "a/Node_Modules"])
      expect(rules.isIgnored(path, true)).toBe(true);
    expect(rules.isIgnored("a/.Git/note.md")).toBe(true);
    expect(rules.isIgnored("NODE_MODULES/a.md")).toBe(true);
    expect(rules.isIgnored("", true)).toBe(false);
    expect(rules.isIgnored(".git")).toBe(false);
    expect(isHardExcludedPath("a/NODE_MODULES/.ignore")).toBe(true);
    expect(isHardExcludedPath(".GIT", true)).toBe(true);
    expect(isHardExcludedPath("", true)).toBe(false);
    expect(rules.isIgnored("unrelated?.txt")).toBe(false);
  });

  it("keeps normal ignore patterns case-sensitive", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".gitignore", "README.md");
    expect(rules.isIgnored("README.md")).toBe(true);
    expect(rules.isIgnored("readme.md")).toBe(false);
  });

  it("rejects unsafe paths and preserves results after cache resets", () => {
    const rules = new FolderIgnore();
    rules.addRules("", ".gitignore", "*.tmp\n!keep.tmp");
    for (let i = 0; i < 10000; i++)
      expect(rules.isIgnored(`folder/file${i}.tmp`)).toBe(true);
    expect(rules.isIgnored("folder/keep.tmp")).toBe(false);
    for (const path of ["../note.md", "/note.md", "a//b", "a/./b", "a\\b"])
      expect(() => rules.isIgnored(path)).toThrow("safe root-relative");
  });
});
