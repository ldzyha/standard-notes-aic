import { describe, expect, it } from "vitest";
import {
  appendPageText,
  displayTarget,
  normalizeTarget,
  notePages,
  pageForTarget,
} from "../src/core/note-pages.js";

const texts = (source: string) =>
  notePages(source).map((page) => source.slice(page.from, page.to));
const targets = (source: string) =>
  notePages(source).map((page) => page.target);

describe("note pages", () => {
  it("always returns one unbound page for text without separators", () => {
    const unbound = { target: null, separator: -1, content: 0 };
    expect(notePages("")).toEqual([{ from: 0, to: 0, ...unbound }]);
    expect(notePages("One\ntwo")).toEqual([{ from: 0, to: 7, ...unbound }]);
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
    expect(targets("---\n\n--- /a\nPage")).toEqual([null, "/a"]);
    expect(notePages("\n\n---\nOnly")).toMatchObject([
      { from: 0, to: 10, target: null },
    ]);
  });

  it("keeps empty pages after a leading separator", () => {
    expect(notePages("--- a\n\n--- b\nB\n")).toEqual([
      { from: 0, to: 7, target: "a", separator: 0, content: 6 },
      { from: 13, to: 15, target: "b", separator: 7, content: 13 },
    ]);
    expect(targets("--- a\n\n--- b\n\n--- c\nC")).toEqual(["a", "b", "c"]);
    expect(targets("\n--- a\n\n\n---\n\n--- c")).toEqual(["a", null, "c"]);
    // Only the implicit page before the first separator is dropped.
    expect(targets("---\na: 1\n---\n\n--- a\n\n--- b")).toEqual(["a", "b"]);
    expect(targets("\n\n---\n\n---\n\n---\n")).toEqual([null, null, null]);
  });

  it("keeps leading frontmatter inside page 1", () => {
    expect(notePages("---\ntitle: A\n---")).toMatchObject([
      { from: 0, to: 16, target: null },
    ]);
    const source = "---\ntitle: A\n\nb: 1\n---\nBody\n\n--- /b\nNext";
    expect(texts(source)).toEqual([
      "---\ntitle: A\n\nb: 1\n---\nBody\n\n",
      "Next",
    ]);
    expect(notePages("---\ntitle: A\n---\n--- /first\nBody")).toMatchObject([
      { from: 0, to: 32, target: "/first" },
    ]);
    const bound = "---\ntitle: x\n---\n\n--- /a\np2\n\n---\np3";
    expect(notePages(bound)).toMatchObject([
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
      const source = `A\n\n${open}\n# Section\n\n---\n\n---  \n${close}\n\n---\nB`;
      expect(targets(source)).toEqual([null, null]);
      expect(texts(source)[1]).toBe("B");
    },
  );

  it("starts a page at a bound separator even inside a fence", () => {
    const fenced = "A\n\n```md\n\n--- /x\n```\n\n---\nB";
    // The closing line now opens a fence in page /x, which hides the bare rule.
    expect(targets(fenced)).toEqual([null, "/x"]);
    expect(texts(fenced)).toEqual(["A\n\n```md\n\n", "```\n\n---\nB"]);
    // Without the blank line before it the line stays fenced text.
    expect(targets("A\n\n```md\ntext\n--- /x\n```")).toEqual([null]);
    // Accepted edge: a fenced diff with a blank line before `--- a/file`.
    expect(targets("```diff\n\n--- a/file\n+++ b/file\n```")).toEqual([
      null,
      "a/file",
    ]);
  });

  it("ends an unclosed fence with its page", () => {
    const source =
      "--- /a\nA\n```js\ncode\n\n--- /b\nBBB\n\n---\nLoose\n\n--- /c\n~~~\n\n---\nC";
    expect(targets(source)).toEqual(["/a", "/b", null, "/c"]);
    expect(texts(source).slice(1)).toEqual([
      "BBB\n\n",
      "Loose\n\n",
      "~~~\n\n---\nC",
    ]);
  });

  it("needs a matching closing fence and treats an unclosed fence as open", () => {
    expect(notePages("````\n```\n\n---\n````\n\n---\nB")).toHaveLength(2);
    expect(notePages("~~~\n```\n\n---\n")).toHaveLength(1);
    expect(notePages("```\n\n---\nB")).toHaveLength(1);
    expect(notePages("`a` ``` b ```\n\n---\nB")).toHaveLength(2);
  });

  it("starts an empty last page for a separator at the very end", () => {
    expect(notePages("A\n\n--- /end")).toMatchObject([
      { from: 0, to: 3, target: null },
      { from: 11, to: 11, target: "/end" },
    ]);
    expect(notePages("A\n\n---\n")).toMatchObject([
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
    expect(normalizeTarget("/Home/Me/Src/App/")).toBe("/home/me/src/app");
    expect(normalizeTarget("C:\\Work\\App.ts")).toBe("c:/work/app.ts");
    expect(normalizeTarget(".\\Src\\App\\")).toBe("./src/app");
    expect(normalizeTarget("/")).toBe("");
    expect(normalizeTarget("Café.md")).toBe("café.md");
  });

  const matches = (bound: string, target: string) =>
    pageForTarget(notePages(`--- ${bound}\nText`), target) === 0;

  it("matches URLs exactly, without hash or trailing slash, never below a bound prefix", () => {
    const bound = "https://example.com/docs";
    expect(matches(bound, "https://EXAMPLE.com/docs/#x")).toBe(true);
    expect(matches(bound, "https://example.com/docs?q=1")).toBe(true);
    expect(matches(bound, "https://example.com/docs/api")).toBe(false);
    expect(matches(bound, "https://example.com/docsx")).toBe(false);
    expect(matches(bound, "http://example.com/docs")).toBe(false);
    expect(matches(bound, "https://example.com/Docs")).toBe(false);
    expect(matches(bound, "docs")).toBe(false);
    expect(matches("https://example.com", "https://example.com/docs")).toBe(
      false,
    );
  });

  it("requires the bound query when one is written", () => {
    const bound = "https://example.com/docs?id=1";
    expect(matches(bound, "https://example.com/docs?id=1#a")).toBe(true);
    expect(matches(bound, "https://example.com/docs")).toBe(false);
    expect(matches(bound, "https://example.com/docs?id=2")).toBe(false);
    expect(matches(bound, "https://example.com/docs/a?id=1")).toBe(false);
  });

  it("matches full paths case-insensitively and never files under a bound folder", () => {
    expect(matches("/home/me/src/app/", "/HOME/me/src/app")).toBe(true);
    expect(matches("C:/Work/App.ts", "c:\\work\\app.ts")).toBe(true);
    expect(matches("/home/me/src/app", "/home/me/src/app/editor.ts")).toBe(
      false,
    );
    expect(matches("/home/me/src/app", "/home/me/src/application.ts")).toBe(
      false,
    );
    expect(matches("/home/me/app.ts", "home/me/app.ts")).toBe(false);
    expect(matches("./src/app.ts", "src/app.ts")).toBe(false);
    expect(matches("src/app.ts", "SRC/app.ts")).toBe(true);
    expect(matches("/", "/src/app")).toBe(false);
    expect(matches("/src/app", "https://example.com/src/app")).toBe(false);
  });

  it("returns the first page bound to exactly the target", () => {
    const pages = notePages(
      "A\n\n--- https://example.com\nB\n\n--- https://example.com/docs\nC\n\n--- https://example.com/docs/\nD\n\n---\nE",
    );
    expect(pageForTarget(pages, "https://example.com/docs")).toBe(2);
    expect(pageForTarget(pages, "https://example.com/")).toBe(1);
    expect(pageForTarget(pages, "https://example.com/docs/api")).toBe(-1);
    expect(pageForTarget(pages, "https://example.com/blog")).toBe(-1);
    expect(pageForTarget(notePages("A"), "https://example.com")).toBe(-1);
  });

  it("reports each page's own separator line and content start", () => {
    const source = "---\na: 1\n---\n\n--- one\nA\n\n--- two";
    expect(notePages(source)).toEqual([
      { from: 0, to: 25, target: "one", separator: 14, content: 22 },
      { from: 32, to: 32, target: "two", separator: 25, content: 32 },
    ]);
  });

  it("returns the text that appends a page for a target", () => {
    const cases: [string, string][] = [
      ["", "--- /home/me/a.ts\n"],
      ["One", "\n\n--- /home/me/a.ts\n"],
      ["One\n", "\n--- /home/me/a.ts\n"],
      ["One\n\n", "--- /home/me/a.ts\n"],
      ["One\n  ", "\n--- /home/me/a.ts\n"],
      ["---\na: 1\n---\n", "\n--- /home/me/a.ts\n"],
      ["One\r\nTwo", "\r\n\r\n--- /home/me/a.ts\r\n"],
      // An open fence is left as written: a bound separator ends it.
      ["One\n\n~~~~js\ncode", "\n\n--- /home/me/a.ts\n"],
      ["One\n\n```js\ncode\n", "\n--- /home/me/a.ts\n"],
      ["x\r\n```\r\n", "\r\n--- /home/me/a.ts\r\n"],
    ];
    for (const [text, appended] of cases) {
      expect(appendPageText(text, " /home/me/a.ts\n")).toBe(appended);
      const pages = notePages(text + appended);
      const page = pages[pageForTarget(pages, "/home/me/a.ts")]!;
      expect([page.content, page.to]).toEqual([
        text.length + appended.length,
        text.length + appended.length,
      ]);
    }
    expect(appendPageText("One", "")).toBe("");
    expect(appendPageText("One", "/")).toBe("");
  });

  it("refuses a target that would not be read back as a page", () => {
    for (const target of ["a\u2028b", "a\u2029b", "\u2028", "a\u2028"]) {
      const appended = appendPageText("One", target);
      const name = target.trim();
      if (!appended) continue;
      // Whatever is returned must be found again, or typing would repeat it.
      expect(appended).toBe(`\n\n--- ${name}\n`);
      const pages = notePages(`One${appended}`);
      expect(pageForTarget(pages, target)).toBe(pages.length - 1);
    }
    expect(appendPageText("One", "a\u2028b")).toBe("");
    expect(appendPageText("", "a\u2029b")).toBe("");
    expect(appendPageText("One", "a\u0085b \t")).toBe("\n\n--- a\u0085b\n");
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
      matches("https://user:pw@example.com/x", "https://example.com/x"),
    ).toBe(true);
  });
});
