import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import {
  parseSecurityBlock,
  serializeSecurityBlock,
} from "../src/core/security-model.js";
import {
  parseRecoveryCodes,
  serializeRecoveryCodes,
} from "../src/core/security-recovery.js";

const first = "fixture-recovery-code-one";
const second = "fixture-recovery-code-two";
const views: EditorView[] = [];
function source(value: string, label = "Recovery codes", hide = true) {
  return (
    "```aic\n" +
    serializeSecurityBlock({
      sections: [{ label: "Main", fields: [{ label, value, hide }] }],
    }) +
    "```"
  );
}
const initial = serializeRecoveryCodes([
  { value: first, used: false },
  { value: second, used: true },
]);
function fixture(text = source(initial), readOnly = false, clipboard = "") {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onCopy = vi.fn(async (value: string, label: string) =>
    Boolean(value && label),
  );
  const onReadClipboard = vi.fn(async () => clipboard);
  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
      ],
    });
  const view = new EditorView({ parent, state: createState(text) });
  views.push(view);
  return { parent, view, onCopy, onReadClipboard, createState };
}
function control<T extends HTMLElement = HTMLButtonElement>(
  parent: HTMLElement,
  label: string,
) {
  const found = parent.querySelector<T>(`[aria-label="${label}"]`);
  expect(found, label).not.toBeNull();
  return found!;
}
function stored(view: EditorView) {
  const block = securityBlocks(view.state)[0]!;
  const parsed = parseSecurityBlock(block.body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Synthetic block was invalid");
  return parsed.model.sections[0]!.fields;
}
function codes(view: EditorView) {
  const result = parseRecoveryCodes(stored(view)[0]!.value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic recovery codes were invalid");
  return result.codes;
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("recovery code preview", () => {
  it("masks codes and copies an exact value without implicitly marking it used", async () => {
    const { parent, view, onCopy } = fixture();
    expect(parent.innerHTML).not.toContain(first);
    expect(parent.innerHTML).not.toContain(second);
    expect(control(parent, "Copy recovery code 1 value").textContent).toContain(
      "••",
    );
    control(parent, "Copy recovery code 1 value").click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy.mock.calls[0]?.[0]).toBe(first);
    expect(codes(view)[0]!.used).toBe(false);
    expect(
      control<HTMLInputElement>(parent, "Mark recovery code 1 as used").checked,
    ).toBe(false);
    expect(
      control<HTMLInputElement>(parent, "Mark recovery code 2 as unused")
        .checked,
    ).toBe(true);
    expect(
      parent.querySelector('[aria-label="Paste Recovery codes"]'),
    ).toBeNull();
    expect(
      parent.querySelector('[aria-label="Delete empty Recovery codes field"]'),
    ).toBeNull();
  });

  it("toggles only the requested duplicate entry and supports reversal and Undo", () => {
    const duplicate = serializeRecoveryCodes([
      { value: first, used: false },
      { value: first, used: false },
    ]);
    const { parent, view } = fixture(source(duplicate));
    control<HTMLInputElement>(parent, "Mark recovery code 2 as used").click();
    expect(codes(view)).toEqual([
      { value: first, used: false },
      { value: first, used: true },
    ]);
    expect(undo(view)).toBe(true);
    expect(codes(view)).toEqual([
      { value: first, used: false },
      { value: first, used: false },
    ]);
    control<HTMLInputElement>(parent, "Mark recovery code 2 as used").click();
    control<HTMLInputElement>(parent, "Mark recovery code 2 as unused").click();
    expect(codes(view)).toEqual([
      { value: first, used: false },
      { value: first, used: false },
    ]);
  });

  it("disables used controls in read-only notes while keeping copy available", async () => {
    const { parent, view, onCopy } = fixture(
      source(initial, "Backup codes"),
      true,
    );
    const checkbox = control<HTMLInputElement>(
      parent,
      "Mark recovery code 1 as used",
    );
    expect(checkbox.disabled).toBe(true);
    checkbox.click();
    expect(codes(view)[0]!.used).toBe(false);
    control(parent, "Copy recovery code 1 value").click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(onCopy.mock.calls[0]?.[0]).toBe(first);
    expect(
      parent.querySelector('[aria-label="Add Recovery codes"]'),
    ).toBeNull();
  });

  it("does not apply a detached checkbox to a different note with identical text", () => {
    const { parent, view, createState } = fixture();
    const checkbox = control<HTMLInputElement>(
      parent,
      "Mark recovery code 1 as used",
    );
    const original = view.state.doc.toString();
    view.setState(createState(original));
    expect(checkbox.isConnected).toBe(false);
    checkbox.click();
    expect(view.state.doc.toString()).toBe(original);
    expect(codes(view)[0]!.used).toBe(false);
  });

  it("pastes a literal batch into an empty field, including checklist prefixes and duplicates", async () => {
    const batch =
      "- [x] literal-fixture\r\n  fixture with spaces  \nrepeat\nrepeat";
    const { parent, view, onReadClipboard } = fixture(source(""), false, batch);
    control(parent, "Paste Recovery codes").click();
    await vi.waitFor(() => expect(stored(view)[0]!.value).not.toBe(""));
    expect(onReadClipboard).toHaveBeenCalledOnce();
    expect(codes(view)).toEqual([
      { value: "- [x] literal-fixture", used: false },
      { value: "  fixture with spaces  ", used: false },
      { value: "repeat", used: false },
      { value: "repeat", used: false },
    ]);
    expect(parent.innerHTML).not.toContain("literal-fixture");
    expect(parent.innerHTML).not.toContain("fixture with spaces");
    expect(
      parent.querySelector('[aria-label="Paste Recovery codes"]'),
    ).toBeNull();
    expect(
      parent.querySelector('[aria-label="Delete empty Recovery codes field"]'),
    ).toBeNull();
    expect(parent.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
  });

  it("adds an explicitly hidden empty recovery-code field", () => {
    const { parent, view } = fixture(
      source("fixture-account", "Account", false),
    );
    control(parent, "Add Recovery codes").click();
    expect(stored(view)[1]).toEqual({
      label: "Recovery codes",
      value: "",
      hide: true,
    });
    expect(control(parent, "Paste Recovery codes")).toBeTruthy();
  });

  it("keeps a visible field with the same label in the ordinary field renderer", () => {
    const { parent } = fixture(
      source("fixture-visible", "Recovery codes", false),
    );
    expect(parent.querySelector('input[type="checkbox"]')).toBeNull();
    expect(control(parent, "Copy Recovery codes value").textContent).toBe(
      "fixture-visible",
    );
  });
});
