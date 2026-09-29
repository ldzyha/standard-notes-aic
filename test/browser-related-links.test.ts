import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { relatedPageLink } from "../src/browser/related-links";
const page = {
  url: "https://example.org/article?q=1#section",
  title: "An [article]",
};
const add = (text: string, source = page) => {
  const change = relatedPageLink(text, source, "https://notes.example/my-note");
  return change
    ? EditorState.create({ doc: text })
        .update({ changes: change })
        .newDoc.toString()
    : text;
};
describe("pinned note related links", () => {
  it("adds an escaped link once and keeps exact query/fragment identity", () => {
    const text = add("My research");
    expect(text).toContain(
      "## Related links\n\n- [An \\[article\\]](<https://example.org/article?q=1#section>)",
    );
    expect(add(text)).toBe(text);
    expect(add(text, { ...page, url: page.url + "2" })).toContain("#section2>");
  });
  it("extends the real section without changing following sections or fenced examples", () => {
    const text =
      "```md\n## Related links\n```\n\n## Related links\n\n- Existing\n\n## Conclusion\n\nDone";
    const result = add(text);
    expect(result.indexOf("- Existing")).toBeLessThan(result.indexOf("- [An"));
    expect(result.indexOf("- [An")).toBeLessThan(
      result.indexOf("## Conclusion"),
    );
    expect(result.endsWith("## Conclusion\n\nDone")).toBe(true);
  });
  it("recognizes existing ordinary Markdown links", () => {
    const text = `[Already cited](${page.url})`;
    expect(add(text)).toBe(text);
  });

  it("keeps related links outside an unfinished code fence", () => {
    const text = "Research\n\n```js\nconst value = 1";
    const result = add(text);
    expect(result.indexOf("## Related links")).toBeLessThan(
      result.indexOf("```js"),
    );
    expect(result.endsWith("```js\nconst value = 1")).toBe(true);
    expect(add(result)).toBe(result);
  });

  it("excludes self-links and unsafe URLs", () => {
    expect(relatedPageLink("Text", page, page.url)).toBeNull();
    for (const url of [
      "javascript:alert(1)",
      "chrome://settings",
      "https://user:pass@example.org",
      "broken",
    ])
      expect(add("Text", { ...page, url })).toBe("Text");
  });
});
