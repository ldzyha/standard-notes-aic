import { describe, expect, it } from "vitest";
import {
  displayTarget,
  normalizeTarget,
  notePages,
  pageForTarget,
  targetSpecificity,
} from "../src/core/note-pages.js";

const texts = (source: string) =>
  notePages(source).map((page) => source.slice(page.from, page.to));
const targets = (source: string) =>
  notePages(source).map((page) => page.target);

describe("note pages", () => {
  it("always returns one unbound page for text without separators", () => {
    expect(notePages("")).toEqual([{ from: 0, to: 0, target: null }]);
    expect(notePages("One\ntwo")).toEqual([{ from: 0, to: 7, target: null }]);
    expect(notePages(undefined as unknown as string)).toHaveLength(1);
  });

  it("splits on blank-line separated --- lines and binds the following page", () => {
    const source =
      "Intro\n\n---\nPlain\n\n--- /src/app/editor.ts\nCode\n\n---   https://example.com/docs  \nDocs";
    expect(texts(source)).toEqual([
      "Intro\n\n",
      "Plain\n\n",
      "Code\n\n",
      "Docs",
    ]);
    expect(targets(source)).toEqual([
      null,
      null,
      "/src/app/editor.ts",
      "https://example.com/docs",
    ]);
  });

  it("keeps a target containing spaces and trims trailing whitespace", () => {
    expect(targets("A\n\n--- docs/My File.md \t\nB")).toEqual([
      null,
      "docs/My File.md",
    ]);
  });

  it.each(["----", "- - -", "***", "___", " ---", "---x", "-- -", "--- "])(
    "treats %j after a blank line by the exact separator rule",
    (line) => {
      expect(notePages(`A\n\n${line}\nB`)).toHaveLength(
        line === "--- " ? 2 : 1,
      );
    },
  );

  it("leaves a setext heading underline alone", () => {
    expect(notePages("Heading\n---\nBody")).toHaveLength(1);
    expect(notePages("A\n\n---\n---\nB")).toHaveLength(2);
  });

  it("binds page 1 when the body starts with a separator", () => {
    const source = "--- /a.md\nFirst\n\n---\nSecond";
    // Page 1 starts at 0 and keeps its own leading separator line.
    expect(texts(source)).toEqual(["--- /a.md\nFirst\n\n", "Second"]);
    expect(targets(source)).toEqual(["/a.md", null]);
    expect(targets("---\n\n--- /a\nPage")).toEqual(["/a"]);
    expect(notePages("\n\n---\nOnly")).toEqual([
      { from: 0, to: 10, target: null },
    ]);
  });

  it("keeps leading frontmatter inside page 1", () => {
    expect(notePages("---\ntitle: A\n---")).toEqual([
      { from: 0, to: 16, target: null },
    ]);
    const source = "---\ntitle: A\n\nb: 1\n---\nBody\n\n--- /b\nNext";
    expect(texts(source)).toEqual([
      "---\ntitle: A\n\nb: 1\n---\nBody\n\n",
      "Next",
    ]);
    expect(notePages("---\ntitle: A\n---\n--- /first\nBody")).toEqual([
      { from: 0, to: 32, target: "/first" },
    ]);
    const bound = "---\ntitle: x\n---\n\n--- /a\np2\n\n---\np3";
    expect(notePages(bound)).toEqual([
      { from: 0, to: 29, target: "/a" },
      { from: 33, to: 35, target: null },
    ]);
    // Without a closing line the first line is an ordinary leading break.
    expect(targets("---\ntitle: A\n\n--- /b\nNext")).toEqual([null, "/b"]);
  });

  it.each([
    "",
    "---",
    "---\n",
    "\n\n---\nOnly",
    "--- /a\nFirst\n\n---\nSecond",
    "---\n\n--- /a\nPage",
    "---\ntitle: x\n---\n\n--- /a\np2",
    "---\ntitle: x\n---\n--- /a\np1\n\n--- /b\np2\n\n---",
    "---\ntitle: x\n\n--- /b\nNext",
    "A\r\n\r\n--- /b\r\nB\r\n\r\n---\r\n",
    "A\n\n```\n\n---\n```\n\n--- /x\nB\n\n```\n\n---\nopen",
    "A\n\n--- /end",
    "\n\n---\n\n---\n\n---\n",
  ])("covers %j with ordered pages from 0 to the text end", (source) => {
    const pages = notePages(source);
    expect(pages[0]!.from).toBe(0);
    expect(pages.at(-1)!.to).toBe(source.length);
    pages.forEach((page, index) => {
      expect(page.from).toBeLessThanOrEqual(page.to);
      if (index) expect(page.from).toBeGreaterThan(pages[index - 1]!.to);
    });
  });

  it.each(["```", "~~~", "```aic", "```aic-security", "````mermaid"])(
    "ignores separators inside a %s fence",
    (open) => {
      const close = open.replace(/[a-z-]+$/u, "");
      const source = `A\n\n${open}\n# Section\n\n---\n\n--- /x\n${close}\n\n---\nB`;
      expect(targets(source)).toEqual([null, null]);
      expect(texts(source)[1]).toBe("B");
    },
  );

  it("needs a matching closing fence and treats an unclosed fence as open", () => {
    expect(notePages("````\n```\n\n---\n````\n\n---\nB")).toHaveLength(2);
    expect(notePages("~~~\n```\n\n---\n")).toHaveLength(1);
    expect(notePages("```\n\n---\nB")).toHaveLength(1);
    expect(notePages("`a` ``` b ```\n\n---\nB")).toHaveLength(2);
  });

  it("starts an empty last page for a separator at the very end", () => {
    expect(notePages("A\n\n--- /end")).toEqual([
      { from: 0, to: 3, target: null },
      { from: 11, to: 11, target: "/end" },
    ]);
    expect(notePages("A\n\n---\n")).toEqual([
      { from: 0, to: 3, target: null },
      { from: 7, to: 7, target: null },
    ]);
  });

  it("tolerates CRLF line ends", () => {
    const source = "---\r\na: 1\r\n---\r\nA\r\n\r\n--- /b \r\nB";
    expect(targets(source)).toEqual([null, "/b"]);
    expect(texts(source)[1]).toBe("B");
  });
});

describe("note page targets", () => {
  it("normalizes URLs and paths", () => {
    expect(normalizeTarget("HTTPS://Example.COM/Docs/?a=1#top")).toBe(
      "https://example.com/Docs?a=1",
    );
    expect(normalizeTarget("https://example.com/")).toBe("https://example.com");
    expect(normalizeTarget(".\\Src\\App\\")).toBe("src/app");
    expect(normalizeTarget("/src/app/Editor.ts")).toBe("src/app/editor.ts");
    expect(normalizeTarget("Café.md")).toBe("café.md");
  });

  it("matches URLs exactly, without hash or trailing slash, and below a bound prefix", () => {
    const bound = "https://example.com/docs";
    expect(targetSpecificity(bound, "https://EXAMPLE.com/docs/#x")).toBe(24);
    expect(targetSpecificity(bound, "https://example.com/docs?q=1")).toBe(24);
    expect(targetSpecificity(bound, "https://example.com/docs/api?q=1")).toBe(
      24,
    );
    expect(targetSpecificity(bound, "https://example.com/docsx")).toBe(0);
    expect(targetSpecificity(bound, "http://example.com/docs")).toBe(0);
    expect(targetSpecificity(bound, "https://example.com/Docs")).toBe(0);
    expect(targetSpecificity(bound, "docs")).toBe(0);
  });

  it("requires the bound query when one is written", () => {
    const bound = "https://example.com/docs?id=1";
    expect(targetSpecificity(bound, "https://example.com/docs?id=1#a")).toBe(
      29,
    );
    expect(targetSpecificity(bound, "https://example.com/docs")).toBe(0);
    expect(targetSpecificity(bound, "https://example.com/docs?id=2")).toBe(0);
    expect(targetSpecificity(bound, "https://example.com/docs/a?id=1")).toBe(0);
  });

  it("matches paths case-insensitively and files under a bound folder", () => {
    expect(targetSpecificity("/src/app/", "SRC\\app\\editor.ts")).toBe(7);
    expect(targetSpecificity("./src/app", "src/app")).toBe(7);
    expect(targetSpecificity("src/app", "src/application.ts")).toBe(0);
    expect(targetSpecificity("/", "src/app")).toBe(0);
    expect(targetSpecificity("src/app", "https://example.com/src/app")).toBe(0);
  });

  it("returns the most specific bound page and the first of equal matches", () => {
    const pages = notePages(
      "A\n\n--- https://example.com\nB\n\n--- https://example.com/docs\nC\n\n--- https://example.com/docs/\nD\n\n---\nE",
    );
    expect(pageForTarget(pages, "https://example.com/docs/api")).toBe(2);
    expect(pageForTarget(pages, "https://example.com/blog")).toBe(1);
    expect(pageForTarget(pages, "https://other.example/docs")).toBe(-1);
    expect(pageForTarget(notePages("A"), "https://example.com")).toBe(-1);
  });
  it("labels a URL target without its username and password", () => {
    expect(displayTarget("https://user:pw@example.com/x?q=1#top")).toBe(
      "https://example.com/x?q=1#top",
    );
    expect(displayTarget("https://user@example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(displayTarget("https://user:pw@")).toBe("https://");
    // Targets without credentials and path targets are shown as written.
    expect(displayTarget("https://Example.com/a@b/")).toBe(
      "https://Example.com/a@b/",
    );
    expect(displayTarget("docs/user:pw@file.md")).toBe("docs/user:pw@file.md");
    expect(displayTarget(null)).toBe("");
    // Matching still uses the written target.
    expect(
      targetSpecificity(
        "https://user:pw@example.com/x",
        "https://example.com/x",
      ),
    ).toBeGreaterThan(0);
  });
});
