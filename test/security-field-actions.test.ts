import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";

const source = [
  "```aic-security",
  "## Main",
  "Password*:",
  "Email: alice@example.com",
  "TOTP*:",
  "```",
].join("\n");
const views: EditorView[] = [];

function fixture(
  text = source,
  options: {
    readOnly?: boolean;
    onReadClipboard?: () => Promise<string>;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const onCopy = vi.fn(async () => true);
  const view = new EditorView({
    parent: host,
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
        }),
      ],
    }),
  });
  views.push(view);
  const control = (label: string) => {
    const button = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button, label).not.toBeNull();
    return button!;
  };
  return { host, view, onCopy, control };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("security field actions", () => {
  it("copies only the value from either focusable target and confirms locally", async () => {
    const { host, onCopy, control } = fixture();
    control("Copy Email").click();
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith("alice@example.com", "Email"),
    );
    expect(
      host.querySelector(".cm-aic-security-field-status")?.textContent,
    ).toBe("");
    const row = control("Copy Email").closest(".cm-aic-security-row")!;
    expect(
      row.querySelector(".cm-aic-security-field-status")?.textContent,
    ).toBe("Copied");
    expect(row.textContent).not.toContain("Password*:");
    control("Copy Email value").click();
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledTimes(2));
    expect(control("Copy Email").tabIndex).toBe(0);
    expect(control("Copy Email value").tabIndex).toBe(0);
    expect(
      host.querySelector('[aria-label="Copy Password value"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="Copy Password"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Copy Password code"]')).toBeNull();
  });

  it("pastes one masked source edit, remains preview, and can undo once", async () => {
    const read = vi.fn(async () => "new-secret-value");
    const { host, view, control } = fixture(source, { onReadClipboard: read });
    control("Paste Password").click();
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toContain(
        "Password*: new-secret-value",
      ),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(host.textContent).not.toContain("new-secret-value");
    expect(view.state.selection.main.from).not.toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("confirms replacement before reading, rejects empty reads, and prevents stale writes", async () => {
    const pending = deferred<string>();
    const read = vi.fn(() => pending.promise);
    const filled = source.replace("Password*:", "Password*: original-secret");
    const { host, view, control } = fixture(filled, { onReadClipboard: read });
    control("Paste Password").click();
    expect(read).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Replace existing value?");
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ]
      .find((button) => button.textContent === "Replace")!
      .click();
    expect(read).toHaveBeenCalledTimes(1);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nOther" },
    });
    pending.resolve("stale-secret");
    await Promise.resolve();
    expect(view.state.doc.toString()).not.toContain("stale-secret");
    expect(host.textContent).not.toContain("original-secret");
    expect(host.textContent).not.toContain("stale-secret");
  });

  it("rejects an empty clipboard without erasing the existing value", async () => {
    const filled = source.replace("Password*:", "Password*: original-secret");
    const { host, view, control } = fixture(filled, {
      onReadClipboard: async () => "",
    });
    control("Paste Password").click();
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ]
      .find((button) => button.textContent === "Replace")!
      .click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Clipboard is empty"),
    );
    expect(view.state.doc.toString()).toBe(filled);
  });

  it("drops a pending clipboard result when Edit switches to source", async () => {
    const pending = deferred<string>();
    const { host, view, control } = fixture(source + "\n\nOutside", {
      onReadClipboard: () => pending.promise,
    });
    vi.useFakeTimers();
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    control("Paste Password").click();
    const deadline = scheduled.mock.results.find(
      (_result, index) => scheduled.mock.calls[index]?.[1] === 3000,
    )?.value;
    expect(deadline).toBeDefined();
    control("Edit security block").click();
    expect(cleared).toHaveBeenCalledWith(deadline);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    pending.resolve("late-secret");
    await Promise.resolve();
    expect(view.state.doc.toString()).not.toContain("late-secret");
    expect(host.textContent).not.toContain("late-secret");
  });

  it("accepts an identical replacement as a no-op without dirtying the note", async () => {
    const filled = source.replace("Password*:", "Password*: original-secret");
    const { host, view, control } = fixture(filled, {
      onReadClipboard: async () => "original-secret",
    });
    const originalDoc = view.state.doc;
    control("Paste Password").click();
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ]
      .find((button) => button.textContent === "Replace")!
      .click();
    await vi.waitFor(() =>
      expect(host.querySelector(".cm-aic-security-panel")).toBeNull(),
    );
    expect(view.state.doc).toBe(originalDoc);
    expect(host.textContent).not.toContain("original-secret");
  });

  it("distinguishes invalid options from unavailable secure randomness without edits", () => {
    const { host, view, control } = fixture();
    control("Generate Password").click();
    const length = host.querySelector<HTMLInputElement>(
      '[aria-label="Password length"]',
    )!;
    const generate = [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ].find((button) => button.textContent === "Generate")!;
    length.value = "7";
    generate.click();
    expect(host.textContent).toContain(
      "Choose 8–128 characters and at least one group",
    );
    length.value = "24";
    vi.stubGlobal("crypto", undefined);
    generate.click();
    expect(host.textContent).toContain(
      "Secure password generation is unavailable",
    );
    expect(view.state.doc.toString()).toBe(source);
  });

  it("times out a hung read into paste-only capture and ignores late success", async () => {
    const pending = deferred<string>();
    const { host, view, control } = fixture(source, {
      onReadClipboard: () => pending.promise,
    });
    vi.useFakeTimers();
    control("Paste Password").click();
    expect(host.textContent).toContain("Reading clipboard");
    await vi.advanceTimersByTimeAsync(3000);
    const capture = host.querySelector<HTMLInputElement>(
      ".cm-aic-security-paste-capture",
    );
    expect(capture?.type).toBe("password");
    expect(host.textContent).toContain("Clipboard read timed out");
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve("late-secret");
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(source);
    expect(host.textContent).not.toContain("late-secret");
    expect(capture?.value).toBe("");
  });

  it("Cancel clears the read deadline and ignores late rejection", async () => {
    const pending = deferred<string>();
    const { host, view, control } = fixture(source, {
      onReadClipboard: () => pending.promise,
    });
    vi.useFakeTimers();
    control("Paste Password").click();
    expect(vi.getTimerCount()).toBe(1);
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ]
      .find((button) => button.textContent === "Cancel")!
      .click();
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    pending.reject(new Error("late clipboard error"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(view.state.doc.toString()).toBe(source);
    expect(host.querySelector(".cm-aic-security-paste-capture")).toBeNull();
  });

  it("widget destruction clears a pending read deadline immediately", async () => {
    const pending = deferred<string>();
    const { host, view, control } = fixture(source, {
      onReadClipboard: () => pending.promise,
    });
    vi.useFakeTimers();
    control("Paste Password").click();
    expect(vi.getTimerCount()).toBe(1);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "Replaced note" },
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    pending.resolve("late-secret");
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("Replaced note");
  });

  it("rejects overlong clipboard values through model serialization", async () => {
    const { host, view, control } = fixture(source, {
      onReadClipboard: async () => "x".repeat(16 * 1024 + 1),
    });
    control("Paste Password").click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Value could not be pasted"),
    );
    expect(view.state.doc.toString()).toBe(source);
    expect(host.textContent).not.toContain("x".repeat(100));
  });

  it("uses paste-only capture after denied API access, blocking typed input", async () => {
    const { host, view, control } = fixture(source, {
      onReadClipboard: async () => {
        throw new Error("denied");
      },
    });
    control("Paste Password").click();
    const input = await vi.waitFor(() => {
      const found = host.querySelector<HTMLInputElement>(
        ".cm-aic-security-paste-capture",
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(input.type).toBe("password");
    const typed = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
    });
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(true);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "captured-secret" },
    });
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(view.state.doc.toString()).toContain("Password*: captured-secret");
    expect(host.textContent).not.toContain("captured-secret");
  });

  it("shows generation only on empty hidden passwords and retires panels", () => {
    const { host, view, control } = fixture(source + "\n\nOutside");
    expect(control("Generate Password")).not.toBeNull();
    expect(host.querySelector('[aria-label="Generate TOTP"]')).toBeNull();
    control("Generate Password").click();
    expect(host.textContent).toContain("Generate");
    control("Edit security block").click();
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    expect(host.querySelector(".cm-aic-security")).toBeNull();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
  });

  it("generates directly into a masked empty field and cannot regenerate a filled field", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });
    const { host, view, control } = fixture();
    control("Generate Password").click();
    const length = host.querySelector<HTMLInputElement>(
      '[aria-label="Password length"]',
    )!;
    length.value = "8";
    for (const label of ["Lowercase", "Numbers", "Symbols"]) {
      const checkbox = [
        ...host.querySelectorAll<HTMLInputElement>(
          '.cm-aic-security-panel input[type="checkbox"]',
        ),
      ].find((input) => input.parentElement?.textContent === label)!;
      checkbox.click();
    }
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".cm-aic-security-panel-button",
      ),
    ]
      .find((button) => button.textContent === "Generate")!
      .click();
    expect(view.state.doc.toString()).toContain("Password*: AAAAAAAA");
    expect(host.textContent).not.toContain("AAAAAAAA");
    expect(host.querySelector('[aria-label="Generate Password"]')).toBeNull();
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
  });

  it("omits paste and generation in read-only mode", () => {
    const { host } = fixture(source, { readOnly: true });
    expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
    expect(host.querySelector('[aria-label="Generate Password"]')).toBeNull();
    expect(host.querySelector('[aria-label="Copy Password"]')).not.toBeNull();
  });
});
