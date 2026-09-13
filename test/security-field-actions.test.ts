import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";

const source = [
  "```aic",
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

async function settlePromises() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("security field actions", () => {
  it("copies the label and value independently and confirms locally", async () => {
    const { host, onCopy, control } = fixture();
    control("Copy Email").click();
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith("Email", "Email label"),
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
    expect(onCopy).toHaveBeenLastCalledWith("alice@example.com", "Email");
    expect(control("Copy Email").tabIndex).toBe(0);
    expect(control("Copy Email value").tabIndex).toBe(0);
    expect(
      host.querySelector('[aria-label="Copy Password value"]'),
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="Copy Password"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Copy Password code"]')).toBeNull();
  });

  it("reads immediately, makes one masked undoable edit, and shows no panel", async () => {
    const read = vi.fn(async () => "new-secret-value");
    const { host, view, control } = fixture(source, { onReadClipboard: read });
    control("Paste Password").click();
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    await vi.waitFor(() =>
      expect(view.state.doc.toString()).toContain(
        "Password*: new-secret-value",
      ),
    );
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(host.textContent).not.toContain("new-secret-value");
    expect(view.state.selection.main.from).not.toBeGreaterThan(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("rejects an empty clipboard without changing the empty field", async () => {
    const { host, view, control } = fixture(source, {
      onReadClipboard: async () => "",
    });
    control("Paste Password").click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("Clipboard is empty"),
    );
    expect(view.state.doc.toString()).toBe(source);
    expect(host.querySelector(".cm-aic-security-paste-capture")).toBeNull();
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
    await settlePromises();
    expect(view.state.doc.toString()).not.toContain("late-secret");
    expect(host.textContent).not.toContain("late-secret");
  });

  it("omits Paste and Delete for filled hidden, visible, and whitespace fields", () => {
    const read = vi.fn(async () => "forbidden-value");
    for (const filled of [
      source.replace("Password*:", "Password*: original-secret"),
      source.replace("Password*:", "Password*:  "),
      source,
    ]) {
      const { host, view } = fixture(filled, {
        onReadClipboard: read,
      });
      const targets =
        filled === source ? ["Paste Email"] : ["Paste Password", "Paste Email"];
      for (const label of targets) {
        expect(host.querySelector(`button[aria-label="${label}"]`)).toBeNull();
        expect(
          host.querySelector(
            `button[aria-label="Delete empty ${label.slice(6)} field"]`,
          ),
        ).toBeNull();
      }
      expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
      expect(view.state.doc.toString()).toBe(filled);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("enables Paste after a filled field is cleared in source Edit", () => {
    const filled = source.replace("Password*:", "Password*: original-secret");
    const { host, view, control } = fixture(filled + "\n\nOutside");
    expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
    control("Edit security block").click();
    const from = view.state.doc.toString().indexOf(" original-secret");
    view.dispatch({
      changes: { from, to: from + " original-secret".length, insert: "" },
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(control("Paste Password").disabled).toBe(false);
    expect(control("Delete empty Password field").disabled).toBe(false);
  });

  it("deletes only an empty field and keeps filled values and the empty section", () => {
    const mixed = source;
    const { host, view, control } = fixture(mixed);
    control("Delete empty Password field").click();
    expect(view.state.doc.toString()).not.toContain("Password*:");
    expect(view.state.doc.toString()).toContain("Email: alice@example.com");
    expect(view.state.doc.toString()).toContain("TOTP*:");
    expect(
      host.querySelector('[aria-label="Delete empty Email field"]'),
    ).toBeNull();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(mixed);
    const single = fixture("```aic\n## Keep section\nEmail:\n```\n");
    single.control("Delete empty Email field").click();
    expect(single.view.state.doc.toString()).toBe(
      "```aic\n## Keep section\n```\n",
    );
    expect(single.host.querySelector(".cm-aic-security-error")).toBeNull();
    expect(single.control("Add Email")).not.toBeNull();
  });

  it("cannot delete through a stale control after its field is filled or another note opens", () => {
    const { view, control } = fixture();
    const stale = control("Delete empty Password field");
    const from = source.indexOf("Password*:") + "Password*:".length;
    view.dispatch({ changes: { from, insert: " newly-filled" } });
    stale.click();
    expect(view.state.doc.toString()).toContain("Password*: newly-filled");
    view.setState(EditorState.create({ doc: "Different note" }));
    stale.click();
    expect(view.state.doc.toString()).toBe("Different note");
  });

  it("drops a pending paste when its empty field is removed", async () => {
    const pending = deferred<string>();
    const { view, control } = fixture(source, {
      onReadClipboard: () => pending.promise,
    });
    control("Paste Password").click();
    control("Delete empty Password field").click();
    pending.resolve("stale-paste-value");
    await settlePromises();
    expect(view.state.doc.toString()).not.toContain("Password*:");
    expect(view.state.doc.toString()).not.toContain("stale-paste-value");
    expect(view.state.doc.toString()).toContain("Email: alice@example.com");
  });

  it("never overwrites a field filled while a read is pending", async () => {
    const pending = deferred<string>();
    const read = vi.fn(() => pending.promise);
    const { host, view, control } = fixture(source, { onReadClipboard: read });
    control("Paste Password").click();
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    const from =
      view.state.doc.toString().indexOf("Password*:") + "Password*:".length;
    view.dispatch({ changes: { from, insert: " newly-filled" } });
    pending.resolve("stale-secret");
    await settlePromises();
    expect(view.state.doc.toString()).toContain("Password*: newly-filled");
    expect(view.state.doc.toString()).not.toContain("stale-secret");
    expect(read).toHaveBeenCalledTimes(1);
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
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    expect(host.textContent).toContain("Pasting");
    await vi.advanceTimersByTimeAsync(3000);
    const capture = host.querySelector<HTMLInputElement>(
      ".cm-aic-security-paste-capture",
    );
    expect(capture?.type).toBe("password");
    expect(host.textContent).toContain("Clipboard read timed out");
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve("late-secret");
    await settlePromises();
    expect(view.state.doc.toString()).toBe(source);
    expect(host.textContent).not.toContain("late-secret");
    expect(capture?.value).toBe("");
  });

  it("a second Paste cancels the prior deadline and ignores its late rejection", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { host, view, control } = fixture(source, { onReadClipboard: read });
    vi.useFakeTimers();
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    control("Paste Password").click();
    const deadline = scheduled.mock.results.find(
      (_result, index) => scheduled.mock.calls[index]?.[1] === 3000,
    )?.value;
    expect(deadline).toBeDefined();
    control("Paste Password").click();
    expect(read).toHaveBeenCalledTimes(2);
    expect(cleared).toHaveBeenCalledWith(deadline);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    first.reject(new Error("late clipboard error"));
    await settlePromises();
    expect(view.state.doc.toString()).toBe(source);
    second.resolve("fresh-secret");
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.doc.toString()).toContain("Password*: fresh-secret");
    expect(host.textContent).not.toContain("fresh-secret");
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
    await settlePromises();
    expect(view.state.doc.toString()).toBe("Replaced note");
  });

  it("rejects overlong clipboard values through model serialization", async () => {
    const { host, view, control } = fixture(source, {
      onReadClipboard: async () => "x".repeat(16 * 1024 + 1),
    });
    control("Paste Password").click();
    await vi.waitFor(() => expect(host.textContent).toContain("Paste failed"));
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

  it("omits paste, deletion and generation in read-only mode", () => {
    const { host } = fixture(source, { readOnly: true });
    expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
    expect(host.querySelector('[aria-label="Generate Password"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Delete empty Password field"]'),
    ).toBeNull();
    expect(host.querySelector('[aria-label="Copy Password"]')).not.toBeNull();
  });
});
