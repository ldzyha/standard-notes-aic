import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { blockDiagnostic } from "../src/core/block-diagnostic.js";
import {
  securityTemplate,
  parseSecurityBlock,
  serializeSecurityBlock,
  SECURITY_LIMITS,
} from "../src/core/security-model.js";
import { SECURITY_FIELD_OPTIONS } from "../src/core/field-syntax.js";
import { securityCardMove } from "../src/core/security-card-order.js";
import {
  makeSecurityBlockExtension,
  makePropertiesBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";

const views: EditorView[] = [];
const merged =
  "# Document\n\n```aic\n# First card\n## Main\nPassword *| PRIVATE_SENTINEL\n# Second card\n## Other\nEmail | synthetic@example.invalid\n```\n\nEnd";
function fixture(doc: string, readOnly = false) {
  const host = document.body.appendChild(document.createElement("div"));
  const access = new Compartment();
  const onCopy = vi.fn(() => true);
  const onChange = vi.fn();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        access.of(EditorState.readOnly.of(readOnly)),
        makeSecurityBlockExtension({ document, onCopy }),
        makePropertiesBlockExtension({ document, onCopy }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange();
        }),
      ],
    }),
  });
  views.push(view);
  return { host, view, access, onCopy, onChange };
}
function errorButton(host: ParentNode) {
  const control = host.querySelector<HTMLButtonElement>(
    ".cm-aic-security-error button",
  );
  expect(control).not.toBeNull();
  return control!;
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("safe block source locations", () => {
  it("shows only near-capacity limits and disables exhausted section additions", () => {
    const body = Array.from(
      { length: SECURITY_LIMITS.maxSections },
      () => "Email | account@example.invalid",
    ).join("\n---\n");
    const { host, view } = fixture("```aic\n" + body + "\n```\nEnd");
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(
      host.querySelector(".cm-aic-security-capacity")?.textContent,
    ).toContain("Sections 16/16");
    expect(
      host.querySelector(".cm-aic-security-capacity")?.textContent,
    ).not.toContain("65,536");
    expect(
      host.querySelector(".cm-aic-security-capacity")?.textContent,
    ).not.toContain("16,384");
    expect(host.querySelector(".cm-aic-security-field-count")).toBeNull();
    const add = host.querySelector<HTMLButtonElement>(
      '[aria-label="Add section after section 1"]',
    )!;
    expect(add.disabled).toBe(true);
    add.click();
    expect(
      parseSecurityBlock(
        securityBlocks(view.state)[0]!.body,
        SECURITY_FIELD_OPTIONS,
      ).ok,
    ).toBe(true);
    expect(host.querySelector('[aria-label="New security block"]')).toBeNull();
    expect(
      host.querySelector(".cm-aic-security-capacity-advice")?.textContent,
    ).toContain("banks, web, social networks");
  });

  it("disables the field menu itself at 64 fields without blocking a new section", () => {
    const body = Array.from(
      { length: 64 },
      (_, index) => `Field ${index} | value`,
    ).join("\n");
    const { host, view } = fixture("```aic\n" + body + "\n```\nEnd");
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Add row to section"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Add row after Field 0"]',
      )!.disabled,
    ).toBe(true);
    const add = host.querySelector<HTMLButtonElement>(
      '[aria-label="Add section after section 1"]',
    )!;
    expect(add.disabled).toBe(false);
    add.click();
    const block = securityBlocks(view.state)[0]!;
    const parsed = parseSecurityBlock(block.body, block);
    expect(parsed.ok && parsed.model.sections).toHaveLength(2);
    expect(block.body).toContain("\n---\n");
    expect(block.body).not.toContain("##");
  });

  it("disables additions when encoded text fills the block before numeric counts do", () => {
    const fields = Array.from({ length: 4 }, (_, index) => ({
      label: `Field ${index}`,
      parts: [{ kind: "secret" as const, value: "" }],
    }));
    const model = { sections: [{ label: "", fields }] };
    let remaining =
      SECURITY_LIMITS.maxBodyLength -
      serializeSecurityBlock(model, SECURITY_FIELD_OPTIONS).length;
    for (const field of fields) {
      const length = Math.min(
        SECURITY_LIMITS.maxValueLength - 3,
        remaining - 1,
      );
      field.parts[0]!.value = "x".repeat(length);
      remaining -= length + 1; // serializer inserts a space for each nonempty value
    }
    const body = serializeSecurityBlock(model, SECURITY_FIELD_OPTIONS);
    expect(body.length).toBe(SECURITY_LIMITS.maxBodyLength);
    const { host } = fixture("```aic\n" + body + "```\nEnd");
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Add section after section 1"]',
      )!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Add row to section"]',
      )!.disabled,
    ).toBe(true);
    expect(host.querySelector('[aria-label="New security block"]')).toBeNull();
  });

  it("keeps untitled sections reorderable and moves whole canonical blocks exactly", () => {
    const first =
      "```aic\nEmail | first@example.invalid\n---\nEmail | second@example.invalid\n```";
    const second = "```aic\n## Named\nPassword *| SYNTHETIC_VALUE\n```";
    const { host, view } = fixture(first + "\n\n" + second + "\nEnd");
    expect(host.querySelector('[aria-label="Reorder group 1"]')).not.toBeNull();
    const blocks = securityBlocks(view.state);
    const move = securityCardMove(view.state, blocks[0]!, blocks[1]!);
    expect(move).not.toBeNull();
    view.dispatch(move!);
    expect(view.state.doc.toString().indexOf(first)).toBeGreaterThan(
      view.state.doc.toString().indexOf(second),
    );
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
  });

  it("moves one valid field between separate blocks without breaking either preview", () => {
    const first = "```aic\n## First\nEmail | example@invalid.test\n```";
    const moved = "Password *| SYNTHETIC_MOVED_VALUE\n";
    const doc = first + "\n\n```aic\n## Second\n" + moved + "```\nEnd";
    const { host, view } = fixture(doc);
    const firstBlock = securityBlocks(view.state)[0]!;
    const from = doc.indexOf(moved);
    view.dispatch({
      changes: [
        { from: firstBlock.bodyTo, insert: moved },
        { from, to: from + moved.length, insert: "" },
      ],
    });
    const blocks = securityBlocks(view.state);
    expect(blocks).toHaveLength(2);
    expect(
      blocks.every((block) => parseSecurityBlock(block.body, block).ok),
    ).toBe(true);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(host.innerHTML).not.toContain("SYNTHETIC_MOVED_VALUE");
  });

  it("explains why any added field breaks a block already at the field limit", () => {
    const body =
      "## First\n" +
      Array.from({ length: 64 }, (_, index) => `Field ${index} | value\n`).join(
        "",
      );
    const moved = "Password *| SYNTHETIC_MOVED_VALUE\n";
    const doc =
      "```aic\n" + body + "```\n\n```aic\n## Second\n" + moved + "```\nEnd";
    const { host, view } = fixture(doc);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    const firstBlock = securityBlocks(view.state)[0]!;
    const from = doc.indexOf(moved);
    view.dispatch({
      changes: [
        { from: firstBlock.bodyTo, insert: moved },
        { from, to: from + moved.length, insert: "" },
      ],
    });
    const cards = host.querySelectorAll(".cm-aic-security");
    expect(cards).toHaveLength(2);
    const error = cards[0]!.querySelector(".cm-aic-security-error")!;
    expect(error.textContent).toContain("64 fields");
    expect(error.textContent).toContain("Line 67");
    expect(cards[1]!.querySelector(".cm-aic-security-error")).toBeNull();
    expect(error.textContent).not.toContain("SYNTHETIC_MOVED_VALUE");
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(
      view.state.doc.toString().indexOf(moved),
    );
  });

  it("explains the section limit when otherwise valid blocks are merged", () => {
    const body = Array.from(
      { length: 17 },
      (_, index) =>
        `${index ? "---\n" : ""}## Section ${index}\nField | value\n`,
    ).join("");
    const { host, view } = fixture("```aic\n" + body + "```\nEnd");
    expect(host.querySelector(".cm-aic-security-error")!.textContent).toContain(
      "16 sections",
    );
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(
      view.state.doc.toString().lastIndexOf("---"),
    );
  });
  it("renders a fresh generated template without a repair error", () => {
    const { host, view } = fixture(securityTemplate());
    const block = securityBlocks(view.state)[0]!;
    expect(parseSecurityBlock(block.body, block).ok).toBe(true);
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
  });

  it.each(["```", "````", "~~~"])(
    "adds an in-place section inside an unclosed %s fence without exposing secrets",
    (fence) => {
      const source = `${fence}aic\n##\nPassword *| PRIVATE_SENTINEL`;
      const { host, view } = fixture(source);
      expect(host.querySelector(".cm-aic-security-error")).toBeNull();
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add section after section 1"]',
        )!
        .click();
      const blocks = securityBlocks(view.state);
      expect(blocks).toHaveLength(1);
      const parsed = parseSecurityBlock(blocks[0]!.body);
      expect(parsed.ok && parsed.model.sections).toHaveLength(2);
      expect(
        blocks.every((block) => parseSecurityBlock(block.body, block).ok),
      ).toBe(true);
      expect(view.state.doc.toString()).toContain(
        "Password *| PRIVATE_SENTINEL\n---",
      );
      expect(view.state.doc.toString().startsWith(fence + "aic")).toBe(true);
      expect(host.querySelector(".cm-aic-security-error")).toBeNull();
      expect(host.innerHTML).not.toContain("PRIVATE_SENTINEL");
    },
  );

  it("keeps a fresh block independent from a preceding malformed merged block", () => {
    const { host, view } = fixture(merged + "\n\n" + securityTemplate());
    expect(securityBlocks(view.state)).toHaveLength(2);
    const cards = host.querySelectorAll(".cm-aic-security");
    expect(cards[0]!.querySelector(".cm-aic-security-error")).not.toBeNull();
    expect(cards[1]!.querySelector(".cm-aic-security-error")).toBeNull();
  });
  it("counts CRLF and UTF-16 columns and clamps offsets without retaining source", () => {
    const source = "hidden\r\n😀x\nlast";
    expect(blockDiagnostic(source, "fixed", "Fixed advice", 10, 11)).toEqual({
      code: "fixed",
      message: "Fixed advice",
      from: 10,
      to: 11,
      line: 2,
      column: 3,
    });
    expect(
      blockDiagnostic(source, "fixed", "Fixed advice", -9, Infinity).from,
    ).toBe(0);
    expect(blockDiagnostic(source, "fixed", "Fixed advice", 999).from).toBe(
      source.length,
    );
    expect(
      JSON.stringify(blockDiagnostic(source, "fixed", "Fixed advice", 8)),
    ).not.toContain("hidden");
  });

  it("locates merged card titles without exposing fields and navigates without changing or saving", () => {
    const { host, view, onChange, onCopy } = fixture(merged);
    const error = host.querySelector(".cm-aic-security-error")!;
    expect(error.textContent).toContain("Line 7, column 1");
    expect(error.textContent).toContain("---");
    expect(host.querySelector(".cm-aic-security")!.innerHTML).not.toContain(
      "PRIVATE_SENTINEL",
    );
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(
      merged.indexOf("# Second card"),
    );
    expect(view.hasFocus).toBe(true);
    expect(view.state.doc.toString()).toBe(merged);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("makes the existing header Edit action go to the same error", () => {
    const { host, view } = fixture(merged);
    host
      .querySelector<HTMLButtonElement>('[aria-label="Edit security block"]')!
      .click();
    expect(view.state.selection.main.head).toBe(
      merged.indexOf("# Second card"),
    );
  });

  it("updates absolute line numbers without remounting a retained invalid preview", () => {
    const { host, view } = fixture(merged);
    const original = host.querySelector(".cm-aic-security-error")!;
    view.dispatch({ changes: { from: 0, insert: "Intro\n" } });
    expect(original.isConnected).toBe(true);
    expect(original.textContent).toContain("Line 8, column 1");
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(
      view.state.doc.toString().indexOf("# Second card"),
    );
  });

  it("ignores detached controls after the block is repaired", () => {
    const { host, view } = fixture(merged);
    const old = errorButton(host);
    const from = merged.indexOf("# Second card");
    view.dispatch({
      changes: {
        from,
        to: from + "# Second card\n## Other".length,
        insert: "---\n## Other",
      },
    });
    expect(host.querySelector(".cm-aic-security-error")).toBeNull();
    const before = view.state.selection.main.head;
    old.click();
    expect(view.state.selection.main.head).toBe(before);
  });

  it("shows locations but no editing action in read-only mode", () => {
    const { host, view } = fixture(merged, true);
    expect(host.querySelector(".cm-aic-security-error")!.textContent).toContain(
      "Line 7",
    );
    expect(host.querySelector(".cm-aic-security-error button")).toBeNull();
    expect(view.state.doc.toString()).toBe(merged);
  });

  it("points unsupported fence versions at the opening line", () => {
    const doc =
      "Title\n\n```aic v9\n##\nPassword *| PRIVATE_SENTINEL\n```\nEnd";
    const { host, view } = fixture(doc);
    expect(host.querySelector(".cm-aic-security-error")!.textContent).toContain(
      "Line 3, column 1",
    );
    expect(host.querySelector(".cm-aic-security")!.innerHTML).not.toContain(
      "PRIVATE_SENTINEL",
    );
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(doc.indexOf("```"));
  });

  it("offers fixed legacy repair without parsing duplicate YAML keys", () => {
    const doc =
      "---\nPassword*: PRIVATE_FIRST\nPassword*: PRIVATE_SECOND\n---\nBody";
    const { host, view } = fixture(doc);
    const error = host.querySelector(".cm-aic-security-error")!;
    expect(error.textContent).toContain("Line 2");
    expect(error.textContent).toContain("no longer supported");
    expect(host.querySelector(".cm-aic-properties")!.innerHTML).not.toContain(
      "PRIVATE_",
    );
    errorButton(host).click();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
      2,
    );
  });

  it("identifies an invalid typed card number and jumps to its authored range", () => {
    const doc =
      "Text\n\n```aic\n##\nCard _| 4242 | arbitrary date *| 999\n```\nEnd";
    const { host, view } = fixture(doc);
    const error = host.querySelector(".cm-aic-security-error")!;
    expect(error.textContent).toContain("Line 5");
    expect(error.textContent).toContain("12–19");
    expect(error.textContent).not.toContain("4242");
    errorButton(host).click();
    expect(view.state.selection.main.head).toBe(doc.indexOf("4242"));
  });

  it("gives an invalid TOTP field an exact source action while keeping the seed out of preview", () => {
    const doc =
      "Text\n\n```aic\n##\nAccount | example\nTOTP #| PRIVATE_INVALID_TOTP\n```\nEnd";
    const { host, view } = fixture(doc);
    expect(host.querySelector(".cm-aic-security-error")!.textContent).toContain(
      "Line 6",
    );
    expect(host.querySelector(".cm-aic-security-error")!.textContent).toContain(
      "Base32",
    );
    expect(host.querySelector(".cm-aic-security")!.innerHTML).not.toContain(
      "PRIVATE_INVALID_TOTP",
    );
    errorButton(host).click();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
      6,
    );
  });
});
