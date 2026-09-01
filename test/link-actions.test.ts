import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { writeLinkToClipboard } from "../src/link-actions";

afterEach(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("link actions", () => {
  it("keeps Copy and Edit visible without reserving an empty hover gap", async () => {
    const styles = await readFile("src/styles.css", "utf8");
    const icons = await readFile("src/core/icons.css", "utf8");
    expect(styles).toMatch(
      /\.cm-aic-link-actions\s*\{[^}]*display:\s*inline-flex/u,
    );
    expect(styles).not.toMatch(/\.cm-aic-link-actions[^}]*opacity:\s*0/u);
    expect(icons).toMatch(/data:image\/svg\+xml/u);
    expect(icons).toMatch(/-webkit-mask:\s*var\(--aic-icon\)/u);
    expect(icons).toMatch(/mask:\s*var\(--aic-icon\)/u);
  });

  it("copies the exact URL through the Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      writeLinkToClipboard("https://example.com/a?b=1#c", document),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/a?b=1#c");
  });

  it("falls back to a temporary DOM selection in restricted clients", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(
      writeLinkToClipboard("../local/file.md", document),
    ).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
