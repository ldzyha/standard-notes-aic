import { Compartment, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makeSecurityBlockExtension,
  makePropertiesBlockExtension,
  propertiesBlocks,
  securityBlocks,
} from "../src/core/security-block.js";
import { parseSecurityBlock } from "../src/core/security-model.js";
import { parsePropertiesBody } from "../src/core/properties-model.js";
import { createSourceModeController } from "../src/core/source-mode.js";
import { isSaveAction } from "../src/core/save-boundary.js";

const views: EditorView[] = [];
const security = (lines: string) => "```aic\n" + lines + "\n```\n\nEnd";
function fixture(doc: string) {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(() => true);
  const onReadClipboard = vi.fn(async () => "000");
  const access = new Compartment();
  const mode = createSourceModeController();
  const saves: boolean[] = [];
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        access.of(EditorState.readOnly.of(false)),
        mode.extension([
          makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
          makePropertiesBlockExtension({ document, onCopy, onReadClipboard }),
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) saves.push(isSaveAction(u));
        }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy, onReadClipboard, access, mode, saves };
}
function button(host: ParentNode, label: string) {
  const result = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(result, label).not.toBeNull();
  return result!;
}
function field(view: EditorView) {
  const block = securityBlocks(view.state)[0]!;
  const result = parseSecurityBlock(block.body, block);
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  return result.model.sections[0]!.fields[0]!;
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("explicit pipe-format preview", () => {
  it("activates marked Properties, copies parts, fills once and preserves the marker on save/reopen", async () => {
    const doc =
      "---\n# aic-fields: v2\nfile: card.note.md\nCard_: '4242 4242 4242 4242 | 09/28 | '\nCorporate#: 'JBSWY3DPEHPK3PXP | Work'\n---\nBody";
    const { host, view, onCopy, saves } = fixture(doc);
    expect(host.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(host.textContent).not.toContain("aic-fields");
    expect(host.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
    expect(host.querySelector(".cm-aic-security-code")).not.toBeNull();
    button(host, "Copy Card number value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "4242 4242 4242 4242",
      "Card Number",
    );
    button(host, "Paste Card cvv").click();
    await vi.waitFor(() =>
      expect(host.querySelector('[aria-label="Paste Card cvv"]')).toBeNull(),
    );
    const saved = view.state.doc.toString();
    expect(saved).toContain("---\n# aic-fields: v2\nfile: card.note.md");
    expect(saved).toContain("09/28 | 000");
    expect(saves).toEqual([true]);
    const reopened = fixture(saved);
    expect(reopened.host.innerHTML).not.toContain("000");
    button(reopened.host, "Copy Card cvv value").click();
    expect(reopened.onCopy).toHaveBeenLastCalledWith("000", "Card CVV");
    expect(button(reopened.host, "Add Card")).toBeTruthy();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("does not activate or rewrite unmarked Properties", () => {
    const doc =
      "---\nPassword*: 'left | middle | right'\nCard_: ordinary\n---\nBody";
    const { host, view, onCopy } = fixture(doc);
    expect(host.textContent).not.toContain("middle");
    button(host, "Copy Password").click();
    expect(onCopy).toHaveBeenLastCalledWith("Password", "Password label");
    button(host, "Copy Password value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "left | middle | right",
      "Password",
    );
    expect(host.querySelector('[aria-label="Add Card"]')).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("keeps a Properties directive outside first-field and group reorder ranges", () => {
    const doc =
      "---\n# aic-fields: v2\nFirst*: 'a | public'\nSecond: b\n---\nBody";
    const { host, view, saves } = fixture(doc);
    button(host, "Reorder First").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toBe(
      "---\n# aic-fields: v2\nSecond: b\nFirst*: 'a | public'\n---\nBody",
    );
    const block = propertiesBlocks(view.state)[0]!;
    expect(block.fieldSyntax).toBe("pipes");
    const parsed = parsePropertiesBody(block.body);
    expect(parsed.ok && parsed.model.sections[1]!.fields[1]!.description).toBe(
      "public",
    );
    expect(saves).toEqual([true]);
  });

  it("fails closed for unknown Properties versions and ignores directives inside a value", () => {
    const unknown = fixture(
      "---\n# aic-fields: v3\nCard_: future-private\n---\nBody",
    );
    expect(unknown.host.querySelector(".cm-aic-security-error")).not.toBeNull();
    expect(unknown.host.innerHTML).not.toContain("future-private");
    const inside = fixture(
      "---\nMemo: |\n  # aic-fields: v2\nPassword*: 'left | right'\n---\nBody",
    );
    expect(propertiesBlocks(inside.view.state)[0]!.fieldSyntax).toBeUndefined();
    button(inside.host, "Copy Password").click();
    expect(inside.onCopy).toHaveBeenLastCalledWith(
      "Password",
      "Password label",
    );
    button(inside.host, "Copy Password value").click();
    expect(inside.onCopy).toHaveBeenLastCalledWith("left | right", "Password");
  });

  it("quarantines historical Security fences without exposing their values", () => {
    const { host } = fixture(
      "```aic-security\n##\nPassword*: left | middle | right\nLegacy_: ordinary\n```\n\nEnd",
    );
    expect(host.querySelector(".cm-aic-security-error")).not.toBeNull();
    expect(host.textContent).not.toContain("middle");
    expect(host.querySelector('[aria-label="Copy Password"]')).toBeNull();
  });

  it("uses the card marker, masks CVV and copies all three parts independently", () => {
    const doc = security("Business_: 4242 4242 4242 4242 | 09/28 | 019");
    const { host, view, onCopy, saves } = fixture(doc);
    expect(host.innerHTML).not.toContain("019");
    expect(host.textContent).toContain("09/28");
    expect(host.querySelector('[aria-label^="Paste Business"]')).toBeNull();
    button(host, "Copy Business number value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "4242 4242 4242 4242",
      "Business Number",
    );
    button(host, "Copy Business expiry value").click();
    expect(onCopy).toHaveBeenLastCalledWith("09/28", "Business Expiry");
    button(host, "Copy Business cvv value").click();
    expect(onCopy).toHaveBeenLastCalledWith("019", "Business CVV");
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = "019";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      host
        .querySelector<HTMLElement>(".cm-aic-security-card")
        ?.closest<HTMLElement>(".cm-aic-security-section")?.hidden,
    ).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    expect(saves).toEqual([]);
  });

  it("fails closed for invalid CVV or an extra pipe part", () => {
    for (const value of [
      "4242 4242 4242 4242 | 09/28 | invalid-private",
      "4242 4242 4242 4242 | 09/28 | 019 | invalid-private",
    ]) {
      const { host } = fixture(security("Business_: " + value));
      expect(host.querySelector(".cm-aic-security-error")).not.toBeNull();
      expect(host.innerHTML).not.toContain("invalid-private");
      expect(host.querySelector('[aria-label^="Copy Business"]')).toBeNull();
    }
  });

  it("does not expose an unsupported fence suffix", () => {
    const { host } = fixture(
      security("Business_: future-private-value").replace(
        "```aic",
        "```aic v9",
      ),
    );
    expect(host.querySelector(".cm-aic-security-error")).not.toBeNull();
    expect(host.innerHTML).not.toContain("future-private-value");
  });

  it("pastes each empty card component once, with one save intent and undo", async () => {
    const { host, view, onReadClipboard, saves } = fixture(
      security('Business_: "4242 4242 4242 4242" | "09/28" | ""'),
    );
    expect(
      host.querySelector('[aria-label="Paste Business number"]'),
    ).toBeNull();
    const stale = button(host, "Paste Business cvv");
    stale.click();
    await vi.waitFor(() => expect(field(view).additionalSecret).toBe("000"));
    expect(host.innerHTML).not.toContain("000");
    expect(host.querySelector('[aria-label="Paste Business cvv"]')).toBeNull();
    stale.click();
    expect(onReadClipboard).toHaveBeenCalledTimes(1);
    expect(saves).toEqual([true]);
    expect(undo(view)).toBe(true);
    expect(field(view).additionalSecret).toBe("");
  });

  it("discards pending card clipboard data after switching to source", async () => {
    const doc = security("Business_:");
    const { host, view, mode, onReadClipboard } = fixture(doc);
    let resolve!: (value: string) => void;
    onReadClipboard.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    button(host, "Paste Business cvv").click();
    mode.toggle(view);
    resolve("019");
    await new Promise((done) => setTimeout(done, 5));
    expect(view.state.doc.toString()).toBe(doc);
    mode.toggle(view);
    expect(button(host, "Paste Business cvv")).toBeTruthy();
  });

  it("copies public descriptions separately while never showing the additional secret", () => {
    const { host, onCopy } = fixture(
      security(
        "Account: person@example.test | Work | synthetic-private\nPass*: hidden\\|pipe | WebDAV",
      ),
    );
    expect(host.innerHTML).not.toContain("synthetic-private");
    expect(host.innerHTML).not.toContain("hidden|pipe");
    button(host, "Copy Account description value").click();
    expect(onCopy).toHaveBeenLastCalledWith("Work", "Account Description");
    button(host, "Copy Account additional secret value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "synthetic-private",
      "Account Additional secret",
    );
    button(host, "Copy Pass value").click();
    expect(onCopy).toHaveBeenLastCalledWith("hidden|pipe", "Pass Value");
    expect(
      host.querySelector('[aria-label="Delete empty Account field"]'),
    ).toBeNull();
  });

  it("identifies TOTP by # even when the label is not TOTP", () => {
    const { host } = fixture(security("Corporate#: JBSWY3DPEHPK3PXP | Work"));
    expect(host.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
    expect(host.querySelector(".cm-aic-security-code")).not.toBeNull();
    expect(button(host, "Copy Corporate code")).toBeTruthy();
  });

  it("does not infer a TOTP type from a plain hidden field", () => {
    const { host, onCopy } = fixture(security("TOTP*: synthetic-secret"));
    expect(host.querySelector(".cm-aic-security-code")).toBeNull();
    button(host, "Copy TOTP").click();
    expect(onCopy).toHaveBeenCalledWith("TOTP", "TOTP label");
    button(host, "Copy TOTP value").click();
    expect(onCopy).toHaveBeenCalledWith("synthetic-secret", "TOTP");
  });
});
