import { describe, expect, it } from "vitest";
import { markdownPlainPreview, NOTE_PREVIEW_LIMIT } from "../src/preview";

describe("Markdown note preview", () => {
  it("does not publish secret Properties from closed, unfinished or truncated headers", () => {
    expect(
      markdownPlainPreview(
        '---\n"Password*": private-value\n---\n\nPublic note',
      ),
    ).toBe("Public note");
    expect(
      markdownPlainPreview("---\ncredentials*:\n  password: private-value"),
    ).toBe("");
    expect(
      markdownPlainPreview('---\n"Password* [WebDAV]": private-value'),
    ).toBe("");
    expect(
      markdownPlainPreview('---\n"Password | Legacy*": private-value'),
    ).toBe("");
    expect(
      markdownPlainPreview('---\n"Pass:word* [WebDAV]": private-value'),
    ).toBe("");
    expect(
      markdownPlainPreview("---\nCard: number | *synthetic-cvv* | [09/28]"),
    ).toBe("");
    expect(markdownPlainPreview("---\nTOTP#: synthetic-seed | phone")).toBe("");
    expect(
      markdownPlainPreview("---\nCard_: 4111111111111111 | 09/28 | 123"),
    ).toBe("");
    expect(
      markdownPlainPreview(
        "---\nPassword*: private-value\nnotes: " +
          "x".repeat(50_000) +
          "\n---\nBody",
      ),
    ).toBe("");
  });
  it("never publishes security values from quoted or listed fences", () => {
    for (const [open, prefix] of [
      ["> ```aic-security", "> "],
      ["- ```aic-security", "  "],
    ]) {
      expect(
        markdownPlainPreview(
          [
            "Before",
            open,
            prefix + "## Main",
            prefix + "Password*: private-value",
            prefix + "```",
            "After",
          ].join("\n"),
        ),
      ).toBe("Before After");
    }
  });
  it("keeps meaningful content and removes Markdown syntax noise", () => {
    const source = `---
status: active
tags: aic, notes
---

# Project map

- [ ] Review the **conversion** flow
- [x] Keep [plain Markdown](https://example.com)

| Feature | State |
| --- | --- |
| Mermaid | ready |

\`\`\`mermaid
flowchart LR
  Notes --> AIC
\`\`\`
`;
    expect(markdownPlainPreview(source)).toBe(
      "Project map Review the conversion flow Keep plain Markdown Feature · State Mermaid · ready flowchart LR Notes --> AIC",
    );
  });

  it("does not discard content after an unclosed frontmatter marker", () => {
    expect(markdownPlainPreview("---\nvisible thought")).toBe(
      "visible thought",
    );
  });

  it("keeps the useful value of an automatic link", () => {
    expect(markdownPlainPreview("Source: <https://example.com/aic>")).toBe(
      "Source: https://example.com/aic",
    );
  });

  it("bounds long previews without splitting Unicode characters", () => {
    const preview = markdownPlainPreview("🧭".repeat(NOTE_PREVIEW_LIMIT + 20));
    expect([...preview]).toHaveLength(NOTE_PREVIEW_LIMIT);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns no syntax noise for an empty or frontmatter-only note", () => {
    expect(markdownPlainPreview("")).toBe("");
    expect(markdownPlainPreview("---\nstatus: draft\n---\n")).toBe("");
  });
});
