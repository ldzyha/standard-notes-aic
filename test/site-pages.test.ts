// @ts-expect-error Node helpers are outside the browser-focused type declarations.
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
// @ts-expect-error Node helpers are outside the browser-focused type declarations.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Build-only JavaScript modules are outside browser type declarations.
import { buildPublicPages } from "../scripts/site-pages.mjs";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(english: string, ukrainian = "# Українська сторінка") {
  const root = await mkdtemp(join(tmpdir(), "aic-public-pages-"));
  fixtures.push(root);
  await mkdir(join(root, "pwa"));
  await mkdir(join(root, "browser"));
  for (const page of ["terms", "releases", "how-to"]) {
    await writeFile(join(root, `pwa/${page}.md`), english);
    await writeFile(join(root, `pwa/${page}.uk.md`), ukrainian);
  }
  return root;
}

function documentFor(pages: Map<string, string>, path: string): Document {
  return new DOMParser().parseFromString(pages.get(path)!, "text/html");
}

describe("public documentation build", () => {
  it("emits six static routes, canonical .com metadata and semantic navigation", async () => {
    const root = await fixture(
      "# Terms and privacy\n\n[Open app](/) · [Releases](/releases)",
    );
    const pages = await buildPublicPages(root);
    expect([...pages.keys()]).toEqual([
      "site.css",
      "terms/index.html",
      "terms/uk/index.html",
      "releases/index.html",
      "releases/uk/index.html",
      "how-to/index.html",
      "how-to/uk/index.html",
    ]);
    for (const [filename, route, locale, alternate] of [
      ["terms/index.html", "/terms", "en", "/terms/uk/"],
      ["terms/uk/index.html", "/terms/uk/", "uk", "/terms"],
      ["releases/index.html", "/releases", "en", "/releases/uk/"],
      ["releases/uk/index.html", "/releases/uk/", "uk", "/releases"],
      ["how-to/index.html", "/how-to", "en", "/how-to/uk/"],
      ["how-to/uk/index.html", "/how-to/uk/", "uk", "/how-to"],
    ]) {
      const doc = documentFor(pages, filename!);
      expect(doc.documentElement.lang).toBe(locale);
      expect(
        doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      ).toBe(`https://aic.dzyha.com${route}`);
      expect(
        doc.querySelector('link[rel="alternate"]')?.getAttribute("href"),
      ).toBe(`https://aic.dzyha.com${alternate}`);
      expect(
        doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href"),
      ).toBe("/site.css");
      expect(
        doc.querySelector("nav a[aria-current=page]")?.getAttribute("href"),
      ).toBe(route);
      expect(doc.querySelector("main h1")?.textContent).not.toBe("");
      expect(doc.querySelector("script,iframe,object,embed,form")).toBeNull();
      for (const anchor of Array.from(doc.querySelectorAll("nav a")))
        expect(anchor.getAttribute("href")).toMatch(/^\//u);
    }
  });

  it("renders GFM structure, ordered starts, nested emphasis, references and safe code", async () => {
    const source = [
      "# Installation",
      "",
      "## Download & verify",
      "",
      "3. Get **the [archive][zip]**.",
      "4. Check *its checksum*.",
      "",
      "- [x] ~~Finished~~",
      "- Next",
      "",
      "> Keep a backup.",
      "",
      "---",
      "",
      "Run `code --install-extension ./aic-notes.vsix`.",
      "",
      "```sh",
      "printf '<script>bad()</script>'",
      "```",
      "",
      "| Package | Version |",
      "| --- | --- |",
      "| AIC Notes | 55.1.0 |",
      "",
      "[zip]: https://github.com/ldzyha/aic-notes/releases",
      "",
      "## Download & verify",
    ].join("\n");
    const pages = await buildPublicPages(await fixture(source));
    const doc = documentFor(pages, "releases/index.html");
    expect(doc.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(doc.querySelectorAll("ol li")).toHaveLength(2);
    expect(doc.querySelector("strong a")?.getAttribute("href")).toBe(
      "https://github.com/ldzyha/aic-notes/releases",
    );
    expect(doc.querySelector("em")?.textContent).toBe("its checksum");
    expect(doc.querySelector("del")?.textContent).toBe("Finished");
    expect(doc.querySelector('[aria-label="Complete"]')).not.toBeNull();
    expect(doc.querySelector("blockquote")?.textContent).toContain(
      "Keep a backup.",
    );
    expect(doc.querySelector("hr")).not.toBeNull();
    expect(doc.querySelector("pre code")?.textContent).toBe(
      "printf '<script>bad()</script>'",
    );
    expect(doc.querySelectorAll("table th")).toHaveLength(2);
    expect(doc.querySelector("table tbody")?.textContent).toContain("55.1.0");
    expect(
      Array.from(doc.querySelectorAll("h2")).map((heading) => heading.id),
    ).toEqual(["download-verify", "download-verify-1"]);
  });

  it("escapes raw HTML and attributes, rejects active protocols and suppresses images", async () => {
    const source = [
      '# Title <img src=x onerror="bad()">',
      "",
      '<script>alert("bad")</script>',
      "",
      "[Bad](javascript:alert%281%29) [Data](data:text/html,x) [FTP](ftp://example.com/x)",
      "",
      "[Protocol relative](//evil.example/x) [Credential](https://person:secret@example.com/x)",
      "",
      "[Valid](https://example.com/?a=1&b=%22quote%22) [Mail](mailto:leonid@dzyha.com)",
      "",
      "![Remote image](https://evil.example/pixel.png)",
      "",
      '<iframe src="https://evil.example"></iframe>',
    ].join("\n");
    const pages = await buildPublicPages(await fixture(source));
    const html = pages.get("terms/index.html")!;
    const doc = documentFor(pages, "terms/index.html");
    expect(
      doc.querySelector("script,img,iframe,[onerror],[onclick]"),
    ).toBeNull();
    expect(doc.querySelector("main")?.textContent).toContain(
      '<script>alert("bad")</script>',
    );
    expect(doc.querySelector("main")?.textContent).toContain("Remote image");
    expect(html).toContain("&lt;img");
    const hrefs = Array.from(doc.querySelectorAll("main a")).map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "https://example.com/?a=1&b=%22quote%22",
      "mailto:leonid@dzyha.com",
    ]);
  });

  it("injects matching-language policies and histories while resolving their source links", async () => {
    const root = await fixture(
      "# Public page\n\n<!-- AIC_BROWSER_PRIVACY -->\n\n<!-- AIC_CHANGELOG -->",
      "# Публічна сторінка\n\n<!-- AIC_BROWSER_PRIVACY -->\n\n<!-- AIC_CHANGELOG -->",
    );
    await writeFile(
      join(root, "browser/PRIVACY.md"),
      "# Browser policy\n\nEnglish permissions and Limited Use.\n\n[Policy](PRIVACY.md) [Українська](PRIVACY.uk.md) [Review](VERIFICATION.md)",
    );
    await writeFile(
      join(root, "browser/PRIVACY.uk.md"),
      "# Політика браузера\n\nУкраїнські дозволи та Limited Use.\n\n[English](PRIVACY.md)",
    );
    await writeFile(
      join(root, "CHANGELOG.md"),
      "# Changelog\n\n## 47.1.0\n\nSource release. [Українська](CHANGELOG.uk.md) [Install](RELEASE_INSTALL.md) [Details](browser/README.md#read)",
    );
    await writeFile(
      join(root, "CHANGELOG.uk.md"),
      "# Історія змін\n\n## 47.1.0\n\nВипуск джерела. [English](CHANGELOG.md)",
    );
    const pages = await buildPublicPages(root);
    const en = documentFor(pages, "terms/index.html");
    const uk = documentFor(pages, "terms/uk/index.html");
    expect(en.querySelector("main")?.textContent).toContain(
      "English permissions and Limited Use.",
    );
    expect(en.querySelector("main")?.textContent).toContain("Source release.");
    expect(uk.querySelector("main")?.textContent).toContain(
      "Українські дозволи та Limited Use.",
    );
    expect(uk.querySelector("main")?.textContent).toContain("Випуск джерела.");
    expect(uk.querySelector("main")?.textContent).not.toContain(
      "English permissions",
    );
    expect(en.querySelectorAll("h1")).toHaveLength(1);
    expect(
      Array.from(en.querySelectorAll("main a")).map((anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toEqual([
      "/terms",
      "/terms/uk/",
      "https://github.com/ldzyha/standard-notes-aic/blob/main/browser/VERIFICATION.md",
      "/releases/uk/",
      "/releases",
      "https://github.com/ldzyha/standard-notes-aic/blob/main/browser/README.md#read",
    ]);
    expect(pages.get("terms/index.html")).not.toContain("AIC_BROWSER_PRIVACY");
    expect(pages.get("terms/index.html")).not.toContain("AIC_CHANGELOG");
  });

  it("builds the maintained pages with policy guarantees and full source history", async () => {
    const pages = await buildPublicPages(".");
    const terms = documentFor(pages, "terms/index.html");
    const releases = documentFor(pages, "releases/index.html");
    const howTo = documentFor(pages, "how-to/index.html");
    const howToUk = documentFor(pages, "how-to/uk/index.html");
    const originalPolicy = await readFile("browser/PRIVACY.md", "utf8");
    expect(originalPolicy).toContain("Limited Use");
    expect(terms.querySelector("main")?.textContent).toContain("Limited Use");
    expect(terms.querySelector("main")?.textContent).toContain("clipboardRead");
    expect(releases.querySelectorAll("ol li").length).toBeGreaterThan(3);
    expect(releases.querySelector("main")?.textContent).toContain("47.1.0");
    expect(releases.querySelector("main")?.textContent).toContain(
      "Full release history",
    );
    expect(
      howTo.querySelector("main a[href='https://ddk.dzyha.com/prompt.html']"),
    ).not.toBeNull();
    expect(howTo.querySelector("main")?.textContent).toContain(
      "first sufficient document",
    );
    expect(howTo.querySelector("main")?.textContent).toContain(
      "DDK JSON is a separate",
    );
    expect(howTo.querySelector("main")?.textContent).toContain(
      "At a field separator",
    );
    expect(
      howToUk.querySelector("main a[href='https://ddk.dzyha.com/prompt.html']"),
    ).not.toBeNull();
    expect(howToUk.querySelector("main")?.textContent).toContain(
      "перший достатній документ",
    );
    for (const [filename, html] of pages) {
      if (!filename.endsWith(".html")) continue;
      const doc = new DOMParser().parseFromString(html, "text/html");
      expect(doc.querySelector("script,img,iframe")).toBeNull();
      expect(html).not.toContain("aic.dzyha.fit");
      for (const anchor of Array.from(doc.querySelectorAll("a[href]")))
        expect(anchor.getAttribute("href")).toMatch(
          /^(?:\/|#|https?:|mailto:)/u,
        );
    }
  });
});
