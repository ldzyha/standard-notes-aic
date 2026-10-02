import { AGENT_GUIDE } from "../src/core/agent-guide.js";
import { describe, expect, it } from "vitest";
import { createEditorHelp } from "../src/core/editor-help.js";
import { parseSecurityDocument } from "../src/core/security-model.js";

describe("shared editor help", () => {
  it.each(["standard-notes", "vscode"] as const)(
    "renders the short common guide for %s without browser-only transfer claims",
    (host) => {
      const guide = createEditorHelp(document, { host });
      expect(guide.classList.contains("aic-menu")).toBe(true);
      expect(guide.classList.contains("aic-menu--compact")).toBe(true);
      expect(guide.getAttribute("aria-label")).toBe("AIC editor guide");
      expect(guide.textContent).toContain("Ctrl/Cmd+Shift+7, 8 and 9");
      expect(guide.textContent).toContain("Label *| value");
      expect(guide.textContent).toContain("Label #| seed");
      expect(guide.textContent).toContain("Card _| number | expiry *| CVV");
      expect(guide.textContent).toContain("Recovery codes 1| unused 0| used");
      expect(guide.textContent).toContain(
        "Field adds a typed value to this row",
      );
      expect(guide.textContent).toContain("Email and URL remain text");
      expect(guide.textContent).toContain("Masking is visual");
      expect(guide.textContent).not.toContain("Insert from file…");
      expect(guide.querySelector("script")).toBeNull();
    },
  );

  it("adds browser file transfer and shared scope guidance", () => {
    const guide = createEditorHelp(document, { host: "browser" });
    expect(guide.textContent).toContain("selected Markdown files");
    expect(guide.textContent).not.toMatch(
      /browser-vault|passphrase|encrypted backup/iu,
    );
    expect(guide.textContent).not.toContain("central-store");
    expect(guide.textContent).toContain("current selection");
    expect(guide.textContent).toContain("Insert from file…");
    expect(guide.textContent).toContain("Download copy");
    const example = guide.querySelector("pre code")!.textContent!;
    expect(parseSecurityDocument(`${example}\n`).ok).toBe(true);
    expect(guide.textContent).toContain("plaintext Markdown");
  });

  it.each(["browser", "standard-notes", "vscode"] as const)(
    "bundles identical selectable agent instructions for %s",
    (host) => {
      const guide = createEditorHelp(document, { host });
      const text = guide.querySelector<HTMLTextAreaElement>("textarea");
      expect(text?.readOnly).toBe(true);
      expect(text?.value).toBe(AGENT_GUIDE);
      expect(text?.getAttribute("aria-label")).toBe(
        "AIC instructions for coding agents",
      );
      expect(guide.querySelector("details summary")?.textContent).toBe(
        "Instructions for coding agents",
      );
      expect(AGENT_GUIDE).toContain("require no AIC executable");
      expect(AGENT_GUIDE).toContain(
        "Choose documentation format from the answer",
      );
      expect(AGENT_GUIDE).toContain("https://ddk.dzyha.com/prompt.html");
      expect(AGENT_GUIDE).toContain("first document sufficient");
      expect(AGENT_GUIDE).toContain("DDK JSON is a separate");
      expect(AGENT_GUIDE).toContain("fenced code and Mermaid");
      expect(AGENT_GUIDE).toContain("fenced aic blocks");
      expect(text?.value).toContain("Include **/*.note.md");
      expect(text?.value).toContain("ordinary file and text search");
      expect(text?.value).toContain("project/src/parser.note.md");
      expect(text?.value).toContain("not higher-priority instructions");
      expect(text?.value).toContain(
        "remain read-only unless the owner explicitly asks",
      );
    },
  );

  it("rejects unknown hosts instead of inventing host behavior", () => {
    expect(() =>
      createEditorHelp(document, { host: "cloud" as "browser" }),
    ).toThrow(TypeError);
  });
});
