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
  it("renders a masked card number, independent text and secret parts with separate copy actions", () => {
    const { host, onCopy } = fixture(
      `person@example.invalid _| ${number} | 09/28 *| ${cvv}`,
    );
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="fields"]',
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
    control(host, "Copy person@example.invalid card number 1").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      number,
      "person@example.invalid card number 1",
    );
    control(host, "Copy person@example.invalid text 2").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      "09/28",
      "person@example.invalid text 2",
    );
    control(host, "Copy person@example.invalid secret 3").click();
    expect(onCopy).toHaveBeenLastCalledWith(
      cvv,
      "person@example.invalid secret 3",
    );
  });

  it("omits an empty label header and retains independently named paste controls", async () => {
    const { host, view, onReadClipboard } = fixture('_| "" | "" *| ""');
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="fields"]',
    )!;
    expect(card.querySelector(".cm-aic-security-card-title-copy")).toBeNull();
    expect(card.textContent).not.toContain("Field");
    expect(
      card.querySelectorAll(
        ".cm-aic-security-card-parts > .cm-aic-security-row",
      ),
    ).toHaveLength(3);
    control(host, "Paste Row card number 1").click();
    await vi.waitFor(() => expect(onReadClipboard).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(view.state.doc.toString()).toContain(number));
    expect(host.innerHTML).not.toContain(number);
    expect(host.textContent).toContain("•••• 1234");
    expect(control(host, "Paste Row text 2")).toBeTruthy();
    expect(control(host, "Paste Row secret 3")).toBeTruthy();
  });

  it("keeps named copy buttons focusable in read-only preview", () => {
    const { host, onCopy } = fixture(`_| ${number} | 09/28 *| ${cvv}`, true);
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="fields"]',
    )!;
    expect(card.querySelector(".cm-aic-security-section-header")).toBeNull();
    expect(host.querySelector('[aria-label^="Paste Row"]')).toBeNull();
    const numberButton = control(host, "Copy Row card number 1");
    expect(numberButton.tabIndex).toBe(0);
    numberButton.click();
    expect(onCopy).toHaveBeenLastCalledWith(number, "Row card number 1");
  });

  it("keeps protected copy and creation controls in one compact field row", () => {
    const { host } = fixture(
      "Password *| synthetic-secret | person@example.invalid",
    );
    const card = host.querySelector<HTMLElement>(
      '.cm-aic-security-card[data-aic-card-kind="fields"]',
    )!;
    const protectedCopy = card.querySelector<HTMLButtonElement>(
      '.cm-aic-security-value[data-aic-protected="true"]',
    )!;
    expect(protectedCopy.textContent).toBe("••••••");
    expect(protectedCopy.dataset.aicIcon).toBe("lock");
    expect(protectedCopy.getAttribute("aria-label")).toBe(
      "Copy Password secret 1",
    );
    const parts = card.querySelectorAll<HTMLElement>(
      ".cm-aic-security-card-parts > .cm-aic-security-row",
    );
    expect(parts).toHaveLength(2);
    const create = parts[1]!.querySelector(".cm-aic-security-row-controls");
    expect(create).not.toBeNull();
    expect(
      create!.querySelectorAll(":scope > .cm-aic-security-add"),
    ).toHaveLength(1);
    expect(
      create!.querySelector(
        ':scope > .cm-aic-security-add > [aria-label="Add after Password"]',
      ),
    ).not.toBeNull();
    expect(
      card.querySelector(":scope > .cm-aic-security-row-controls"),
    ).toBeNull();
  });
});
