import { describe, expect, it } from "vitest";
import type { BrowserNote } from "../src/browser/library";
import { savedPageAncestors } from "../src/browser/page-ancestors";

function note(url: string, title = url): BrowserNote {
  return {
    id: url,
    url,
    title,
    markdown: `private:${title}`,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  };
}

describe("saved page ancestor links", () => {
  it("returns metadata-only saved ancestors from the origin root to the nearest path", () => {
    const links = savedPageAncestors(
      "https://example.com/docs/api/items/current?view=full#part",
      [
        note("https://example.com/docs/api", "API"),
        note("https://example.com/", "Site"),
        note("https://example.com/docs", "Docs"),
        note("https://example.com/docs/api/items", "Items"),
      ],
    );
    expect(links).toEqual([
      { url: "https://example.com/", title: "Site", depth: 0 },
      { url: "https://example.com/docs", title: "Docs", depth: 1 },
      { url: "https://example.com/docs/api", title: "API", depth: 2 },
      {
        url: "https://example.com/docs/api/items",
        title: "Items",
        depth: 3,
      },
    ]);
    expect(JSON.stringify(links)).not.toContain("private:");
  });

  it("requires an exact origin and a strict path-segment boundary", () => {
    const current = "https://example.com/docs/api/current";
    const links = savedPageAncestors(current, [
      note("https://example.com/docs", "parent"),
      note("https://example.com/doc", "partial segment"),
      note("https://example.com/docs2", "sibling prefix"),
      note("https://example.com/docs/other", "sibling"),
      note("http://example.com/docs", "scheme"),
      note("https://example.com:8443/docs", "port"),
      note("https://sub.example.com/docs", "subdomain"),
    ]);
    expect(links.map((link) => link.title)).toEqual(["parent"]);
  });

  it("does not promote the current path, query variants, or fragments to parents", () => {
    const links = savedPageAncestors("https://example.com/a/b/current?q=1", [
      note("https://example.com/a", "plain parent"),
      note("https://example.com/a?scope=other", "query parent"),
      note("https://example.com/a#section", "fragment parent"),
      note("https://example.com/a/b/current", "same path"),
      note("https://example.com/a/b/current?q=2", "same path query"),
    ]);
    expect(links.map((link) => link.title)).toEqual(["plain parent"]);
  });

  it("equates only a terminal slash and preserves internal empty segments", () => {
    const links = savedPageAncestors("https://example.com/a//b/current", [
      note("https://example.com/a/", "a slash"),
      note("https://example.com/a//b/", "double-slash parent"),
      note("https://example.com/a/b", "collapsed path"),
    ]);
    expect(links.map(({ title, depth }) => ({ title, depth }))).toEqual([
      { title: "a slash", depth: 1 },
      { title: "double-slash parent", depth: 3 },
    ]);
  });

  it("fails closed for malformed candidate URLs while validating the current URL", () => {
    expect(
      savedPageAncestors("https://example.com/a/b", [
        note("not a URL", "invalid"),
        note("https://example.com/a", "valid"),
      ]).map((link) => link.title),
    ).toEqual(["valid"]);
    expect(() => savedPageAncestors("javascript:alert(1)", [])).toThrow();
  });
});
