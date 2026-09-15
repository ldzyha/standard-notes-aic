import { describe, expect, it } from "vitest";
import { markdownPlainPreview } from "../src/preview";

describe("Markdown links in plain note previews", () => {
  it.each([
    "[Label](https://example.test/a(b)?token=synthetic)",
    "[Label](https://example.test/a?next=(b)&state=synthetic)",
    "[Label](https://example.test/a(b(c))?token=synthetic)",
    String.raw`[Label](https://example.test/a\(b\)?token=synthetic)`,
    '[Label](<https://example.test/a(b)?token=synthetic> "Synthetic title")',
  ])("does not expose destination suffixes from %s", (source) => {
    expect(markdownPlainPreview(source)).toBe("Label");
  });

  it("requires the opening bracket and paired inline destination markers", () => {
    for (const source of [
      "Label](https://example.test/a(b)?token=synthetic)",
      "[Label]https://example.test/a(b)?token=synthetic)",
      "[Label](https://example.test/a(b)?token=synthetic",
      "[Label] (https://example.test/a(b)?token=synthetic)",
    ])
      expect(markdownPlainPreview(source)).toBe(source);
    expect(
      markdownPlainPreview(
        String.raw`\[Label](https://example.test/a(b)?token=synthetic)`,
      ),
    ).toBe("[Label](https://example.test/a(b)?token=synthetic)");
  });

  it("preserves escaped label brackets and independently handles adjacent links and images", () => {
    expect(
      markdownPlainPreview(
        String.raw`[A\] B](https://example.test/a(b)) and [Other](https://other.test/c(d))`,
      ),
    ).toBe("A] B and Other");
    expect(
      markdownPlainPreview(
        "[![Alt](https://example.test/image(a).png)](https://example.test/page(b))",
      ),
    ).toBe("Alt");
    expect(
      markdownPlainPreview("![Alt](https://example.test/image(a).png)"),
    ).toBe("Alt");
    expect(markdownPlainPreview("[Empty destination]()")).toBe(
      "Empty destination",
    );
  });

  it("retains raw URLs and angle autolinks as visible content", () => {
    const url = "https://example.test/a(b)?q=synthetic";
    expect(markdownPlainPreview(`Source: ${url}`)).toBe(`Source: ${url}`);
    expect(markdownPlainPreview(`Source: <${url}>`)).toBe(`Source: ${url}`);
  });
});
