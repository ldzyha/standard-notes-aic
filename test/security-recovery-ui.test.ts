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
  type SecurityField,
} from "../src/core/security-model.js";

const first = "fixture-one-time-code";
const second = "fixture-used-code";
const views: EditorView[] = [];

function markdown(fields: readonly SecurityField[]) {
  return (
    "```aic\n" +
    serializeSecurityBlock({
      title: "Codes",
      sections: [{ label: "", fields }],
    }) +
    "```"
  );
}

const initial = markdown([
  {
    label: "Recovery",
    parts: [
      { value: first, kind: "one-time" },
      { value: second, kind: "used" },
      { value: "public-note", kind: "text" },
    ],
  },
]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture(
  text = initial,
  options: {
    readOnly?: boolean;
    onCopy?: (value: string, label: string) => boolean | Promise<boolean>;
    onReadClipboard?: () => Promise<string>;
    onPreviewChange?: (before: string, after: string) => Promise<boolean>;
    canPreviewChange?: () => boolean;
  } = {},
) {
  const parent = document.body.appendChild(document.createElement("div"));
  const onCopy = vi.fn(options.onCopy ?? (async () => true));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.readOnly.of(options.readOnly ?? false),
        makeSecurityBlockExtension({
          document,
          onCopy,
          onReadClipboard: options.onReadClipboard,
          onPreviewChange: options.onPreviewChange,
          canPreviewChange: options.canPreviewChange,
        }),
      ],
    }),
  });
  views.push(view);
  return { parent, view, onCopy };
}

function control(parent: ParentNode, label: string) {
  const found = parent.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(found, label).not.toBeNull();
  return found!;
}

function stored(view: EditorView) {
  const block = securityBlocks(view.state)[0]!;
  const parsed = parseSecurityBlock(block.body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Synthetic aic block was invalid");
  return parsed.model.sections[0]!.fields;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("one-time typed parts", () => {
  it("renders independent masked cells without legacy recovery checkboxes", () => {
    const { parent } = fixture();
    const parts = parent.querySelectorAll("[data-aic-field-part]");
    expect(parts).toHaveLength(3);
    expect(
      [...parts].map((part) => part.getAttribute("data-aic-part-kind")),
    ).toEqual(["one-time", "used", "text"]);
    expect(parent.innerHTML).not.toContain(first);
    expect(parent.innerHTML).not.toContain(second);
    expect(parent.textContent).toContain("public-note");
    expect(parent.querySelector(".cm-aic-security-recovery")).toBeNull();
    expect(parent.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("copies an active value then marks only that part used, with Undo", async () => {
    const { parent, view, onCopy } = fixture();
    control(parent, "Copy Recovery one-time 1 and mark it used").click();
    await vi.waitFor(() =>
      expect(stored(view)[0]!.parts[0]!.kind).toBe("used"),
    );
    expect(onCopy).toHaveBeenCalledWith(first, "Recovery one-time 1");
    expect(stored(view)[0]!.parts.map((part) => part.kind)).toEqual([
      "used",
      "used",
      "text",
    ]);
    expect(undo(view)).toBe(true);
    expect(stored(view)[0]!.parts[0]!.kind).toBe("one-time");
  });

  it("does not consume an active value when clipboard writing fails", async () => {
    const { parent, view } = fixture(initial, {
      onCopy: async () => false,
    });
    control(parent, "Copy Recovery one-time 1 and mark it used").click();
    await vi.waitFor(() => expect(parent.textContent).toContain("Copy failed"));
    expect(stored(view)[0]!.parts[0]!.kind).toBe("one-time");
  });

  it("reactivates a used value without copying and supports Undo", async () => {
    const { parent, view, onCopy } = fixture();
    control(parent, "Reactivate Recovery used 2 without copying").click();
    await vi.waitFor(() =>
      expect(stored(view)[0]!.parts[1]!.kind).toBe("one-time"),
    );
    expect(onCopy).not.toHaveBeenCalled();
    expect(undo(view)).toBe(true);
    expect(stored(view)[0]!.parts[1]!.kind).toBe("used");
  });

  it("deletes only a used part, preserves siblings, and deletes the row when last", async () => {
    const { parent, view } = fixture();
    control(parent, "Delete Recovery used 2").click();
    await vi.waitFor(() => expect(stored(view)[0]!.parts).toHaveLength(2));
    expect(stored(view)[0]!.parts).toEqual([
      { value: first, kind: "one-time" },
      { value: "public-note", kind: "text" },
    ]);
    expect(undo(view)).toBe(true);
    expect(stored(view)[0]!.parts).toHaveLength(3);

    const single = markdown([
      { label: "Only", parts: [{ value: second, kind: "used" }] },
    ]);
    const other = fixture(single);
    control(other.parent, "Delete Only used 1").click();
    await vi.waitFor(() => expect(stored(other.view)).toHaveLength(0));
    expect(undo(other.view)).toBe(true);
    expect(stored(other.view)).toHaveLength(1);
  });

  it("ignores a successful late copy after the exact part changed", async () => {
    const pending = deferred<boolean>();
    const { parent, view } = fixture(initial, {
      onCopy: () => pending.promise,
    });
    const original = view.state.doc.toString();
    control(parent, "Copy Recovery one-time 1 and mark it used").click();
    view.dispatch({
      changes: {
        from: original.indexOf(first),
        to: original.indexOf(first) + first.length,
        insert: "edited-one-time-code",
      },
    });
    pending.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(view.state.doc.toString()).toContain("1| edited-one-time-code");
    expect(stored(view)[0]!.parts[0]!.kind).toBe("one-time");
  });

  it("disables stateful controls in a read-only preview without a delegate", () => {
    const { parent, onCopy } = fixture(initial, { readOnly: true });
    const active = control(parent, "Copy Recovery one-time 1 and mark it used");
    const used = control(parent, "Reactivate Recovery used 2 without copying");
    const remove = control(parent, "Delete Recovery used 2");
    expect(active.disabled).toBe(true);
    expect(used.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    active.click();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("delegates a full-document read-only transition and honors host availability", async () => {
    const changes: [string, string][] = [];
    const onPreviewChange = vi.fn(async (before: string, after: string) => {
      changes.push([before, after]);
      return true;
    });
    const { parent, onCopy } = fixture(initial, {
      readOnly: true,
      onPreviewChange,
      canPreviewChange: () => true,
    });
    control(parent, "Copy Recovery one-time 1 and mark it used").click();
    await vi.waitFor(() => expect(onPreviewChange).toHaveBeenCalledOnce());
    expect(onCopy).toHaveBeenCalledOnce();
    expect(changes[0]![0]).toBe(initial);
    expect(changes[0]![1]).toContain("Recovery 0| " + first);

    const unavailable = fixture(initial, {
      readOnly: true,
      onPreviewChange,
      canPreviewChange: () => false,
    });
    expect(
      control(unavailable.parent, "Copy Recovery one-time 1 and mark it used")
        .disabled,
    ).toBe(true);
  });

  it("reports copied but unsaved when a read-only host rejects the transition", async () => {
    const { parent, onCopy } = fixture(initial, {
      readOnly: true,
      onPreviewChange: async () => false,
    });
    control(parent, "Copy Recovery one-time 1 and mark it used").click();
    await vi.waitFor(() =>
      expect(parent.textContent).toContain("Copied; state not saved"),
    );
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("splits a multiline paste into independent active one-time parts", async () => {
    const empty = markdown([
      { label: "Batch", parts: [{ value: "", kind: "one-time" }] },
    ]);
    const { parent, view } = fixture(empty, {
      onReadClipboard: async () => "code-a\ncode-b\ncode-a",
    });
    control(parent, "Paste Batch one-time 1").click();
    await vi.waitFor(() => expect(stored(view)[0]!.parts).toHaveLength(3));
    expect(stored(view)[0]!.parts).toEqual([
      { value: "code-a", kind: "one-time" },
      { value: "code-b", kind: "one-time" },
      { value: "code-a", kind: "one-time" },
    ]);
  });
});
