import { describe, expect, it, vi } from "vitest";
import {
  CODE_FENCE_PREVIEW_CORE_VERSION,
  createCodeFencePreview,
} from "../src/core/code-fence-preview.js";
import {
  CODE_FENCE_EXTENSION_CORE_VERSION,
  codeFences,
} from "../src/core/code-fence-extension.js";
import { PREVIEW_RANGES_CORE_VERSION } from "../src/core/preview-ranges.js";
import { EditorState } from "@codemirror/state";
import { aicMarkdownLanguage } from "../src/language";

describe("shared code-fence preview core", () => {
  it("owns CodeMirror fence discovery and excludes Mermaid from code cards", () => {
    const state = EditorState.create({
      doc: "```ts\nconst value = 1\n```\n\n```mermaid\nA-->B\n```",
      extensions: [aicMarkdownLanguage()],
    });
    expect(CODE_FENCE_EXTENSION_CORE_VERSION).toBe("1.1.0");
    expect(PREVIEW_RANGES_CORE_VERSION).toBe("1.0.0");
    expect(codeFences(state)).toMatchObject([
      { language: "ts", source: "const value = 1" },
    ]);
  });

  it("creates a source-bound, text-safe preview with icon-only actions", async () => {
    const onCopy = vi.fn().mockResolvedValue(true);
    const onEdit = vi.fn();
    const preview = createCodeFencePreview(document, {
      source: '<script>alert("safe text")</script>',
      language: "html",
      from: 7,
      to: 51,
      onCopy,
      onEdit,
    });
    expect(CODE_FENCE_PREVIEW_CORE_VERSION).toBe("1.0.0");
    expect(preview.dataset.aicSourceFrom).toBe("7");
    expect(preview.dataset.aicSourceTo).toBe("51");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("code")?.textContent).toContain("alert");
    const buttons = [...preview.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy code",
      "Edit code source",
    ]);
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
    buttons[0]!.click();
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith(
        '<script>alert("safe text")</script>',
      ),
    );
    buttons[1]!.click();
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
