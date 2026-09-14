import { describe, expect, it } from "vitest";
import { buildDomainTree, type BrowserNote } from "../src/browser/library";
import {
  navigationLabels,
  projectDomain,
  shortPath,
} from "../src/browser/navigation";

function note(url: string, title: string): BrowserNote {
  return {
    id: url,
    url,
    title,
    markdown: "",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  };
}

describe("compact browser navigation", () => {
  it("promotes one note directly below its domain", () => {
    const item = note(
      "https://docs.example/wiki/spaces/EPC/pages/9954820132/long-slug",
      "Our page",
    );
    expect(projectDomain(buildDomainTree([item])[0]!)).toEqual([
      { kind: "note", note: item },
    ]);
  });

  it("retains only paths that group notes and labels nested paths relatively", () => {
    const first = note(
      "https://docs.example/wiki/spaces/EPC/pages/1/a",
      "Alpha",
    );
    const second = note(
      "https://docs.example/wiki/spaces/EPC/pages/2/b",
      "Beta",
    );
    const third = note(
      "https://docs.example/wiki/spaces/OTHER/pages/3/c",
      "Gamma",
    );
    const domain = buildDomainTree([first, second, third])[0]!;
    expect(projectDomain(domain)).toEqual([
      {
        kind: "group",
        label: "wiki/spaces",
        items: [
          {
            kind: "group",
            label: "EPC/pages",
            items: [
              { kind: "note", note: first },
              { kind: "note", note: second },
            ],
          },
          { kind: "note", note: third },
        ],
      },
    ]);
  });

  it("does not invent a shared path for separate singleton branches", () => {
    const first = note("https://docs.example/one/deep/a", "A");
    const second = note("https://docs.example/two/deep/b", "B");
    expect(projectDomain(buildDomainTree([first, second])[0]!)).toEqual([
      { kind: "note", note: first },
      { kind: "note", note: second },
    ]);
  });

  it("uses a short path for untitled pages and disambiguates duplicate titles", () => {
    const pages = [
      note("https://docs.example/a/page", "Same"),
      note("https://docs.example/b/page", "Same"),
      note("https://docs.example/c/page?view=one", "Same"),
      note("https://docs.example/c/page?view=two", "Same"),
    ];
    const labels = navigationLabels(pages);
    expect(labels.get(pages[0]!.url)).toBe("Same (a/page)");
    expect(labels.get(pages[1]!.url)).toBe("Same (b/page)");
    expect(labels.get(pages[2]!.url)).toBe("Same (c/page?view=one)");
    expect(labels.get(pages[3]!.url)).toBe("Same (c/page?view=two)");
    expect(shortPath("https://docs.example/wiki/Some%20page")).toBe(
      "Some page",
    );
    expect(shortPath("https://docs.example/")).toBe("/");
  });
});
