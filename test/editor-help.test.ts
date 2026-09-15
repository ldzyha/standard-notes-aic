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
      expect(guide.textContent).not.toContain("↑ Markdown");
      expect(guide.querySelector("script")).toBeNull();
    },
  );

  it("adds bounded browser transfer and current-passphrase guidance", () => {
    const guide = createEditorHelp(document, { host: "browser" });
    expect(guide.textContent).toContain("current browser-vault passphrase");
    expect(guide.textContent).not.toContain("central-store");
    expect(guide.textContent).toContain("current selection");
    expect(guide.textContent).toContain("↑ Markdown");
    expect(guide.textContent).toContain("↓ Markdown");
    const example = guide.querySelector("pre code")!.textContent!;
    expect(parseSecurityDocument(`${example}\n`).ok).toBe(true);
    expect(guide.textContent).toContain("plaintext Markdown");
  });

  it("rejects unknown hosts instead of inventing host behavior", () => {
    expect(() =>
      createEditorHelp(document, { host: "cloud" as "browser" }),
    ).toThrow(TypeError);
  });
});
