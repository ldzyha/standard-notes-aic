import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";

const views: EditorView[] = [];
const number = "4242 4242 4242 1234"; // Synthetic card number only.
const cvv = "019";

function fixture(field: string, readOnly = false) {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(() => true);
  const onReadClipboard = vi.fn(async () => number);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: `\`\`\`aic\n${field}\n\`\`\`\n\nAfter`,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy, onReadClipboard };
}

function control(host: HTMLElement, name: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`,
  );
  expect(found, name).not.toBeNull();
  return found!;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("compact card preview", () => {
  it("renders only the last four number digits and a masked CVV while copying each full part", () => {
    const { host, onCopy } = fixture(
      `person@example.invalid_: ${number} | 09/28 | ${cvv}`,
    );
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="card"]',
    );
    expect(card).not.toBeNull();
    const parts = card!.querySelectorAll(
      ".cm-aic-security-card-parts > .cm-aic-security-row",
    );
    expect(parts).toHaveLength(3);
    expect(card!.textContent).toContain("•••• 1234");
    expect(card!.textContent).toContain("09/28");
    expect(card!.textContent).toContain("•••");
    expect(card!.innerHTML).not.toContain(number);
    expect(card!.innerHTML).not.toContain("4242");
    expect(card!.innerHTML).not.toContain(cvv);
    expect(
      card!.querySelectorAll(
        ".cm-aic-security-card-parts .cm-aic-security-label",
      ),
    ).toHaveLength(0);
    control(host, "Copy person@example.invalid label").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "person@example.invalid",
      "person@example.invalid label",
    );
    control(host, "Copy person@example.invalid number value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      number,
      "person@example.invalid Number",
    );
    control(host, "Copy person@example.invalid expiry value").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "09/28",
      "person@example.invalid Expiry",
    );
    control(host, "Copy person@example.invalid cvv value").click();
    expect(onCopy).toHaveBeenLastCalledWith(cvv, "person@example.invalid CVV");
  });

  it("omits an empty label header and retains independently named paste controls", async () => {
    const { host, view, onReadClipboard } = fixture('_: "" | "" | ""');
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="card"]',
    )!;
    expect(card.querySelector(".cm-aic-security-section-header")).toBeNull();
    expect(card.textContent).not.toContain("Field");
    expect(
      card.querySelectorAll(
        ".cm-aic-security-card-parts > .cm-aic-security-row",
      ),
    ).toHaveLength(3);
    control(host, "Paste Field number").click();
    await vi.waitFor(() => expect(onReadClipboard).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain(number));
    expect(host.innerHTML).not.toContain(number);
    expect(host.textContent).toContain("•••• 1234");
    expect(control(host, "Paste Field expiry")).toBeTruthy();
    expect(control(host, "Paste Field cvv")).toBeTruthy();
  });

  it("keeps named copy buttons focusable in read-only preview", () => {
    const { host, onCopy } = fixture(`_: ${number} | 09/28 | ${cvv}`, true);
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="card"]',
    )!;
    expect(card.querySelector(".cm-aic-security-section-header")).toBeNull();
    expect(host.querySelector('[aria-label^="Paste Field"]')).toBeNull();
    const numberButton = control(host, "Copy Field number value");
    expect(numberButton.tabIndex).toBe(0);
    numberButton.click();
    expect(onCopy).toHaveBeenLastCalledWith(number, "Field Number");
  });
});
