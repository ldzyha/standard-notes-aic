import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import { parseSecurityBlock } from "../src/core/security-model.js";
import { isSaveAction } from "../src/core/save-boundary.js";

const views: EditorView[] = [];
const security = (body: string) => "```aic\n" + body + "\n```";

function fixture(
  body: string,
  options: { clipboard?: readonly string[]; readOnly?: boolean } = {},
) {
  const host = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn<(value: string, label: string) => Promise<boolean>>(
    async () => true,
  );
  const clipboard = [...(options.clipboard ?? [])];
  const onReadClipboard = vi.fn(async () => clipboard.shift() ?? "");
  const saves: boolean[] = [];
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: security(body),
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.readOnly.of(options.readOnly ?? false),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) saves.push(isSaveAction(update));
        }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy, onReadClipboard, saves };
}

function control(host: ParentNode, label: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

function model(view: EditorView) {
  const block = securityBlocks(view.state)[0]!;
  const parsed = parseSecurityBlock(block.body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Synthetic aic block was invalid");
  return parsed.model;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("typed pipe preview", () => {
  it("renders and copies card, text and secret parts independently", async () => {
    const { host, onCopy } = fixture(
      "Card _| 4242 4242 4242 4242 | 09/28 *| 123",
    );
    expect(host.innerHTML).not.toContain("4242 4242 4242 4242");
    expect(host.innerHTML).not.toContain(">123<");
    expect(host.textContent).toContain("•••• 4242");
    expect(host.textContent).toContain("09/28");
    control(host, "Copy Card card number 1").click();
    control(host, "Copy Card text 2").click();
    control(host, "Copy Card secret 3").click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledTimes(3));
    expect(onCopy.mock.calls.map(([value, label]) => [value, label])).toEqual([
      ["4242 4242 4242 4242", "Card card number 1"],
      ["09/28", "Card text 2"],
      ["123", "Card secret 3"],
    ]);
  });

  it("uses explicit markers only; labels never select a renderer", () => {
    const { host } = fixture(
      "Card | ordinary\nOther _| 4111111111111111\nTOTP *| not-a-code",
    );
    expect(host.textContent).toContain("ordinary");
    expect(host.textContent).toContain("•••• 1111");
    expect(host.querySelector(".cm-aic-security-code")).toBeNull();
    expect(control(host, "Copy Card value").textContent).toContain("ordinary");
  });

  it("pastes into each empty typed cell once with save boundaries and Undo", async () => {
    const body = "Business _| | |";
    const { host, view, onReadClipboard, saves } = fixture(body, {
      clipboard: ["4111111111111111", "12/30", "999"],
    });
    control(host, "Paste Business card number 1").click();
    await vi.waitFor(() =>
      expect(model(view).sections[0]!.fields[0]!.parts[0]!.value).toBe(
        "4111111111111111",
      ),
    );
    control(host, "Paste Business text 2").click();
    await vi.waitFor(() =>
      expect(model(view).sections[0]!.fields[0]!.parts[1]!.value).toBe("12/30"),
    );
    control(host, "Paste Business text 3").click();
    await vi.waitFor(() =>
      expect(model(view).sections[0]!.fields[0]!.parts[2]!.value).toBe("999"),
    );
    expect(onReadClipboard).toHaveBeenCalledTimes(3);
    expect(saves).toEqual([true, true, true]);
    expect(undo(view)).toBe(true);
    expect(undo(view)).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(security(body));
  });

  it("renders TOTP only for #| and never exposes its seed", async () => {
    const { host, onCopy } = fixture(
      "Corporate #| JBSWY3DPEHPK3PXP\nNamed TOTP *| JBSWY3DPEHPK3PXP",
    );
    await vi.waitFor(() =>
      expect(host.querySelector(".cm-aic-security-code")?.textContent).toMatch(
        /^\d{6}$/u,
      ),
    );
    expect(host.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
    control(host, "Copy Corporate code").click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy.mock.calls[0]![0]).toMatch(/^\d{6}$/u);
    expect(control(host, "Copy Named TOTP value")).toBeTruthy();
  });

  it("adds every explicit field type to the current row", () => {
    const { host, view } = fixture("Login | account");
    const additions = [
      ["Secret", "secret"],
      ["TOTP", "totp"],
      ["Card number", "card"],
      ["One-time", "one-time"],
      ["Used", "used"],
      ["Text", "text"],
    ] as const;
    for (const [text, kind] of additions) {
      control(host, "Add after Login").click();
      control(host, `Add ${text.toLowerCase()} field to Login`).click();
      expect(model(view).sections[0]!.fields[0]!.parts.at(-1)?.kind).toBe(kind);
    }
    expect(model(view).sections[0]!.fields).toHaveLength(1);
  });

  it("inserts canonical row templates immediately below the current row", () => {
    const { host, view } = fixture("First | a\nSecond | b");
    control(host, "Add after First").click();
    control(host, "Add blank row after First").click();
    const rows = model(view).sections[0]!.fields;
    expect(rows.map((row) => row.label)).toEqual(["First", "", "Second"]);
    expect(rows[1]!.parts.map((part) => part.kind)).toEqual(["text"]);
  });

  it("uses the section footer to append a row and bootstrap an empty section", () => {
    const { host, view } = fixture("## Empty");
    control(host, "Add row to Empty").click();
    control(host, "Add card row to Empty").click();
    expect(model(view).sections[0]!.fields[0]).toEqual({
      label: "Card",
      parts: [
        { value: "", kind: "card" },
        { value: "", kind: "text" },
        { value: "", kind: "secret" },
      ],
    });
    expect(
      host.querySelector(".cm-aic-security-section > .cm-aic-security-add"),
    ).toBeNull();
    expect(control(host, "Add after Card")).toBeTruthy();
  });

  it("inserts a section immediately after its owning section", () => {
    const { host, view } = fixture("## First\nA | a\n---\n## Last\nB | b");
    control(host, "Add after A").click();
    control(host, "Add section after First").click();
    expect(model(view).sections.map((section) => section.label)).toEqual([
      "First",
      "",
      "Last",
    ]);
  });

  it("filters labels and visible text without indexing confidential parts", () => {
    const { host } = fixture(
      "Public | searchable\nPrivate *| hidden-search-term\nCard _| 4111111111111111",
    );
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Filter fields and groups"]',
    )!;
    input.value = "searchable";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      host.querySelector('[aria-label="Copy Public label"]')?.closest("section")
        ?.hidden,
    ).toBe(false);
    input.value = "hidden-search-term";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.textContent).toContain("No matching fields or groups");
    input.value = "1111";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.textContent).toContain("No matching fields or groups");
  });

  it("keeps all typed cells non-editable in a read-only preview", () => {
    const { host } = fixture("Row | visible *| hidden #| JBSWY3DPEHPK3PXP", {
      readOnly: true,
    });
    expect(host.querySelector('[aria-label="Add after Row"]')).toBeNull();
    expect(host.querySelector('[aria-label^="Paste "]')).toBeNull();
    expect(host.querySelector('[aria-label^="Generate "]')).toBeNull();
    expect(host.querySelector('[aria-label^="Reorder "]')).toBeNull();
  });

  it("keeps compact valid source previewable when canonical form fills the block", () => {
    const compactRows = Array.from(
      { length: 64 },
      () => "R*|" + "x".repeat(1018),
    ).join("\n");
    const { host, view } = fixture(compactRows);
    expect(model(view).sections[0]!.fields).toHaveLength(64);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    control(host, "Add after R").click();
    expect(control(host, "Add text field to R").disabled).toBe(true);
    expect(view.state.doc.toString()).toBe(security(compactRows));
  });
});
