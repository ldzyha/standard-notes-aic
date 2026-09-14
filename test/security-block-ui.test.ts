import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { codeFences } from "../src/core/code-fence-extension.js";
import {
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import {
  parseSecurityBlock,
  securityTemplate,
} from "../src/core/security-model.js";
import { DOCUMENTATION_SNIPPETS } from "../src/core/slash-snippets.js";
import { markdownPlainPreview } from "../src/preview";

const secret = "private-password-should-not-appear";
const source = [
  "```aic",
  "## Main",
  "Service: Example",
  "Email: user@example.com",
  "URL: https://example.com/login",
  "Password*: " + secret,
  "```",
].join("\n");
const views: EditorView[] = [];

function fixture(text = source, readOnly = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const onCopy = vi.fn((value: string, label: string) =>
    Boolean(value && label),
  );
  const onOpen = vi.fn();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ document, onCopy, onOpen }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy, onOpen };
}

function control(host: HTMLElement, name: string) {
  const found = host.querySelector<HTMLButtonElement>(
    'button[aria-label="' + name + '"]',
  );
  expect(found, name).not.toBeNull();
  return found!;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared security block", () => {
  it("uses the optional first section title in the card header without a duplicate row", () => {
    const named = fixture(source.replace("## Main", "## Work account"));
    expect(
      named.host.querySelector(".cm-md-preview-header strong")?.textContent,
    ).toBe("Work account");
    expect(
      named.host.querySelector(".cm-aic-security-section-title"),
    ).toBeNull();
    const unnamed = fixture(source.replace("## Main", "##"));
    expect(
      unnamed.host.querySelector(".cm-md-preview-header strong")?.textContent,
    ).toBe("Security");
    expect(
      unnamed.host.querySelector(".cm-aic-security-section-title"),
    ).toBeNull();
  });
  it("uses the common slash snippet", () => {
    expect(
      DOCUMENTATION_SNIPPETS.find((item) => item.command === "security")
        ?.template,
    ).toBe(securityTemplate());
  });

  it("redacts preview and metadata while leaving other code fences alone", () => {
    const { host, view } = fixture();
    expect(securityBlocks(view.state)).toHaveLength(1);
    expect(codeFences(view.state)).toHaveLength(0);
    expect(host.textContent).not.toContain(secret);
    expect(host.textContent).toContain("••••••••");
    expect(markdownPlainPreview("Before\n" + source + "\nAfter")).toBe(
      "Before After",
    );
  });

  it("copies explicit values and opens only the safe URL", () => {
    const { host, onCopy, onOpen } = fixture();
    expect(onCopy).not.toHaveBeenCalled();
    control(host, "Copy security block").click();
    expect(onCopy).toHaveBeenCalledWith(source, "security block");
    control(host, "Copy Password").click();
    expect(onCopy).toHaveBeenCalledWith("Password", "Password label");
    control(host, "Copy Password value").click();
    expect(onCopy).toHaveBeenCalledWith(secret, "Password");
    control(host, "Open URL").click();
    expect(onOpen).toHaveBeenCalledWith("https://example.com/login");
  });

  it("edits as raw Markdown and restores preview on leaving the source", () => {
    const { host, view } = fixture(source + "\n\nAfter");
    control(host, "Edit security block").click();
    expect(host.querySelector(".cm-aic-security-form")).toBeNull();
    expect(host.querySelector(".cm-aic-security")).toBeNull();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(host.textContent).not.toContain(secret);
  });

  it("adds a section and a new independent block without implicit saving", () => {
    const first = fixture();
    control(first.host, "Add security section").click();
    expect(first.view.state.doc.toString()).toContain("\n---\n");
    const parsed = parseSecurityBlock(
      securityBlocks(first.view.state)[0]!.body,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.model.sections).toHaveLength(2);
    const second = fixture();
    control(second.host, "New security block").click();
    expect(securityBlocks(second.view.state)).toHaveLength(2);
    expect(second.host.querySelector(".cm-aic-security-error")).toBeNull();
  });

  it("adds an explicitly hidden field while retaining masked preview", () => {
    const { host, view } = fixture();
    control(host, "Add Password").click();
    expect(view.state.doc.toString()).toContain("Password*:");
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(host.textContent).not.toContain(secret);
  });

  it("adds only to the requested section when labels repeat and retains preview", () => {
    const { host, view } = fixture(
      [
        "```aic",
        "## Main",
        "Password*: first",
        "---",
        "## Second",
        "Password*: second",
        "```",
      ].join("\n"),
    );
    control(host, "Add Password").click();
    const parsed = parseSecurityBlock(securityBlocks(view.state)[0]!.body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.model.sections[0]!.fields).toHaveLength(2);
      expect(parsed.model.sections[1]!.fields).toHaveLength(1);
    }
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
  });

  it("repairs malformed blocks through Edit without exposing their contents", () => {
    const invalid = "```aic\nprivate never-render-this\n```";
    const { host, view } = fixture(invalid);
    expect(host.textContent).not.toContain("never-render-this");
    expect(host.textContent).toContain("Line 2, column 1");
    expect(host.textContent).toContain("Write each field as Label: value.");
    control(host, "Edit security block").click();
    expect(view.state.doc.toString()).toBe(invalid);
    expect(host.querySelector(".cm-aic-security")).toBeNull();
  });

  it("omits modifying controls in read-only mode", () => {
    const { host } = fixture(source, true);
    expect(host.querySelector('[aria-label="Edit security block"]')).toBeNull();
    expect(host.querySelector('[aria-label="New security block"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Copy security block"]'),
    ).not.toBeNull();
  });

  it("keeps an unstarred TOTP field visible like every other unstarred field", () => {
    const value = "VISIBLE-KEY";
    const { host } = fixture(
      ["```aic", "## Main", "TOTP: " + value, "```"].join("\n"),
    );
    expect(host.textContent).toContain(value);
    expect(host.querySelector(".cm-aic-security-code")).toBeNull();
  });

  it("retires the one-time-code refresh timer when the block is replaced", () => {
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { view } = fixture(
      ["```aic", "## Main", "TOTP#: JBSWY3DPEHPK3PXP", "```"].join("\n"),
    );
    const before = clear.mock.calls.length;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "No code" },
    });
    expect(clear.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps multiple mounted cards and their masked DOM stable on an unrelated keystroke", () => {
    const blocks = Array.from({ length: 24 }, (_, index) =>
      [
        "```aic",
        `## Account ${index + 1}`,
        `Password*: private-${index + 1}`,
        "```",
      ].join("\n"),
    ).join("\n\n");
    const { host, view } = fixture(`${blocks}\n\nTail`);
    expect(securityBlocks(view.state)).toHaveLength(24);
    const cards = [...host.querySelectorAll(".cm-aic-security")];
    expect(cards.length).toBeGreaterThan(0);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "!" },
    });
    expect([...host.querySelectorAll(".cm-aic-security")]).toEqual(cards);
    expect(host.innerHTML).not.toContain("private-24");
  });

  it("generates and copies TOTP without showing its seed", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        importKey: vi.fn(async () => ({})),
        sign: vi.fn(async () => new Uint8Array(20).buffer),
      },
    });
    const seed = "JBSWY3DPEHPK3PXP";
    const configured = [
      "```aic",
      "## Main",
      "Two-factor#: " + seed,
      "```",
    ].join("\n");
    const { host, onCopy } = fixture(configured);
    await vi.waitFor(() =>
      expect(host.querySelector(".cm-aic-security-code")?.textContent).toMatch(
        /^\d{6}$/u,
      ),
    );
    expect(host.textContent).not.toContain(seed);
    control(host, "Copy Two-factor code value").click();
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{6}$/u),
        "Two-factor code",
      ),
    );
  });

  it("bounds slow TOTP refresh work and does not update a retired widget", async () => {
    vi.useFakeTimers();
    let rejectSigning: ((error: Error) => void) | undefined;
    const sign = vi.fn(
      () =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          rejectSigning = reject;
        }),
    );
    vi.stubGlobal("crypto", {
      subtle: { importKey: vi.fn(async () => ({})), sign },
    });
    const { host, view } = fixture(
      "```aic\n## Main\nTOTP#: JBSWY3DPEHPK3PXP\n```\n\nAfter",
    );
    const output = host.querySelector(".cm-aic-security-code")!;
    await vi.advanceTimersByTimeAsync(3100);
    expect(sign).toHaveBeenCalledTimes(1);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "Replaced" },
    });
    rejectSigning!(new Error("Retired operation"));
    await vi.advanceTimersByTimeAsync(1100);
    expect(output.textContent).toBe("••••••");
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
