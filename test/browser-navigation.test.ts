import { describe, expect, it } from "vitest";
import { buildDomainTree, type BrowserNote } from "../src/browser/library";
import {
  displayPageLocation,
  displayPageTitle,
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

  it("uses safe domain/path context and neutral ordinals for duplicate titles", () => {
    const pages = [
      note("https://docs.example/a/page", "Same"),
      note("https://docs.example/b/page", "Same"),
      note("https://docs.example/c/page?view=one#private", "Same"),
      note("https://docs.example/c/page?view=two#also-private", "Same"),
    ];
    const labels = navigationLabels(pages);
    expect(labels.get(pages[0]!.url)).toBe("Same (docs.example/a/page)");
    expect(labels.get(pages[1]!.url)).toBe("Same (docs.example/b/page)");
    expect(labels.get(pages[2]!.url)).toBe("Same (docs.example/c/page · 1)");
    expect(labels.get(pages[3]!.url)).toBe("Same (docs.example/c/page · 2)");
    expect([...labels.values()].join(" ")).not.toMatch(
      /view=|private|also-private|[?#]/u,
    );
  });

  it("keeps legitimate titles while removing captured URL and auth tails", () => {
    expect(
      displayPageTitle(
        note(
          "https://jira.example/browse/AIC-1?jql=private#comments",
          "Jira issue — https://jira.example/browse/AIC-1?jql=private#comments",
        ),
      ),
    ).toBe("Jira issue");
    expect(
      displayPageTitle(
        note(
          "https://auth.example/oauth/start?login_hint=person%40example.com&continue=%2Fprivate",
          "Sign in — login_hint=person%40example.com&continue=%2Fprivate",
        ),
      ),
    ).toBe("Sign in");
    expect(
      displayPageTitle(
        note(
          "https://docs.example/topic",
          "Docs for https://user:password@other.example/deep/page?token=private#fragment",
        ),
      ),
    ).toBe("Docs for other.example/deep/page");
    expect(
      displayPageTitle(
        note("https://docs.example/questions", "Why? A practical guide #1"),
      ),
    ).toBe("Why? A practical guide #1");
  });

  it("uses safe bounded fallbacks for URL titles, encoded parameters and long paths", () => {
    expect(
      displayPageTitle(
        note(
          "https://user:password@docs.example/wiki/Some%20page?token=private#fragment",
          "https://user:password@docs.example/wiki/Some%20page?token=private#fragment",
        ),
      ),
    ).toBe("Some page");
    expect(shortPath("https://docs.example/wiki/Some%20page")).toBe(
      "Some page",
    );
    expect(shortPath("https://docs.example/")).toBe("/");
    expect(
      shortPath(
        "https://auth.example/login%253Fcontinue%253Dprivate%2526login_hint%253Dperson",
      ),
    ).toBe("login");
    expect(
      displayPageLocation(
        "https://user:password@docs.example/one/two/three?token=private#fragment",
      ),
    ).toBe("docs.example/two/three");

    const long = "x".repeat(180);
    const title = displayPageTitle(
      note(`https://docs.example/one/${long}?secret=value`, long),
    );
    const location = displayPageLocation(
      `https://docs.example/one/${long}?secret=value#fragment`,
    );
    expect(Array.from(title).length).toBeLessThanOrEqual(72);
    expect(Array.from(location).length).toBeLessThanOrEqual(88);
    expect(`${title} ${location}`).not.toMatch(
      /secret|value|fragment|[?#]|user:password/u,
    );
  });

  it("disambiguates equal titles across domains without exposing URL metadata", () => {
    const pages = [
      note("https://one.example/path?account=first", "Dashboard"),
      note("https://two.example/path?account=second", "Dashboard"),
    ];
    expect([...navigationLabels(pages).values()]).toEqual([
      "Dashboard (one.example/path)",
      "Dashboard (two.example/path)",
    ]);
  });

  it("keeps bounded long duplicate labels distinct after truncation", () => {
    const title = "Very long but shared destination title ".repeat(5);
    const common = `https://${"subdomain".repeat(7)}.example/${"common".repeat(12)}`;
    const pages = [
      note(`${common}/same?login_hint=first#private`, title),
      note(`${common}/same?login_hint=second#also-private`, title),
      note(`${common}/${"a".repeat(80)}-first`, title),
      note(`${common}/${"a".repeat(80)}-second`, title),
    ];
    const labels = [...navigationLabels(pages).values()];
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => Array.from(label).length <= 112)).toBe(true);
    expect(labels[0]).toMatch(/ · 1\)$/u);
    expect(labels[1]).toMatch(/ · 2\)$/u);
    expect(labels.join(" ")).not.toMatch(
      /login_hint|private|also-private|[?#]/u,
    );
  });

  it("sanitizes and bounds projected path group labels", () => {
    const encoded = `${"long".repeat(25)}%253Ftoken%253Dprivate`;
    const domain = buildDomainTree([
      {
        ...note(`https://docs.example/${encoded}/branch/one`, "One"),
        id: "group-one",
      },
      {
        ...note(`https://docs.example/${encoded}/branch/two`, "Two"),
        id: "group-two",
      },
    ])[0]!;
    const labels = projectDomain(domain)
      .filter((item) => item.kind === "group")
      .map((item) => item.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => Array.from(label).length <= 64)).toBe(true);
    expect(labels.join(" ")).not.toMatch(/token|private|[?#]/u);
  });
});
