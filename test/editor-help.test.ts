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
      expect(guide.textContent).toContain(
        "/aic — insert an AIC block for fields, secrets and codes",
      );
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
      const guide4 = text?.value ?? "";
      expect(guide4).toContain("one note at its root");
      expect(guide4).toContain("<project folder name>.note.md");
      expect(guide4).toContain("--- <project-relative path>");
      expect(guide4).toContain("general notes");
      expect(guide4).toContain("aic context resolve --path <file>");
      expect(guide4).toContain("read the project note directly");
      expect(guide4).toContain("not higher-priority instructions");
      expect(guide4).toContain("Never create the project note");
      expect(guide4).toContain("read-only unless the owner");
      expect(guide4).toContain("Do not create new ones");
      for (const obsolete of [
        "Include **/*.note.md",
        "project/src/parser.note.md",
        ".note.note.md",
        "replace its last extension",
        "Do not create missing",
      ])
        expect(guide4).not.toContain(obsolete);
    },
  );

  it("rejects unknown hosts instead of inventing host behavior", () => {
    expect(() =>
      createEditorHelp(document, { host: "cloud" as "browser" }),
    ).toThrow(TypeError);
  });
});
