import { describe, expect, it } from "vitest";
import { markdownPlainPreview, NOTE_PREVIEW_LIMIT } from "../src/preview";

describe("Markdown note preview", () => {
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
