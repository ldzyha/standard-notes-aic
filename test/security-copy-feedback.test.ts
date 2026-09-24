import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";
import { showIconFeedback } from "../src/core/structured-preview.js";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
});

function fixture(copy: () => boolean | Promise<boolean> = () => true) {
  const onCopy = vi.fn(copy);
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "```aic\n## Work\nPassword *| SYNTHETIC-SECRET\nEmail | person@example.test\nRecovery 1| SYNTHETIC-ACTIVE 0| SYNTHETIC-USED\n```\n\nAfter",
      extensions: [
        aicMarkdownLanguage(),
        makeSecurityBlockExtension({ onCopy }),
      ],
    }),
  });
  views.push(view);
  const control = (name: string) => {
    const button = view.dom.querySelector<HTMLButtonElement>(
      `button[aria-label="${name}"]`,
    );
    expect(button, name).not.toBeNull();
    return button!;
  };
  const status = () =>
    view.dom.querySelector<HTMLElement>(
      ".cm-aic-security-field-status:not(:empty)",
    );
  return { view, onCopy, control, status };
}

async function settle() {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
}

describe("icon-only security copy feedback", () => {
  it("shows a temporary check on the password lock with a live announcement and stable action name", async () => {
    const { view, onCopy, control, status } = fixture();
    const lock = control("Copy Password value");
    const title = lock.title;
    vi.useFakeTimers();
    lock.click();
    await settle();
    expect(onCopy).toHaveBeenCalledWith("SYNTHETIC-SECRET", "Password");
    expect(lock.dataset.aicIcon).toBe("check");
    expect(lock.textContent).toBe("");
    expect(lock.getAttribute("aria-label")).toBe("Copy Password value");
    expect(lock.title).toBe("Copied");
    expect(status()!.textContent).toBe("Copied");
    expect(status()!.getAttribute("role")).toBe("status");
    expect(status()!.classList.contains("aic-field__status--icon")).toBe(true);
    expect(view.dom.innerHTML).not.toContain("SYNTHETIC-SECRET");
    await vi.advanceTimersByTimeAsync(1601);
    expect(lock.dataset.aicIcon).toBe("lock");
    expect(lock.title).toBe(title);
    expect(lock.dataset.aicCopyResult).toBeUndefined();
    expect(status()).toBeNull();
  });

  it("uses the same feedback for section and whole-block copy icons", async () => {
    const { control } = fixture();
    vi.useFakeTimers();
    for (const label of ["Copy section Work", "Copy security block"]) {
      const copy = control(label);
      copy.click();
      await settle();
      expect(copy.dataset.aicIcon).toBe("check");
      expect(copy.textContent).toBe("");
      expect(copy.getAttribute("aria-label")).toBe(label);
      expect(
        copy.parentElement!.querySelector(".aic-field__status--icon")!
          .textContent,
      ).toBe("Copied");
      await vi.advanceTimersByTimeAsync(1601);
      expect(copy.dataset.aicIcon).toBe("copy");
    }
  });

  it("shows a failure icon and accessible explanation without squeezing text into the button", async () => {
    const { view, control, status } = fixture(() => false);
    const original = view.state.doc;
    const lock = control("Copy Password value");
    vi.useFakeTimers();
    lock.click();
    await settle();
    expect(lock.dataset.aicIcon).toBe("close");
    expect(lock.dataset.aicCopyResult).toBe("error");
    expect(lock.textContent).toBe("");
    expect(lock.title).toBe("Copy failed");
    expect(status()!.textContent).toBe("Copy failed");
    expect(status()!.classList.contains("aic-field__status--icon")).toBe(true);
    expect(view.state.doc).toBe(original);
    await vi.advanceTimersByTimeAsync(2501);
    expect(lock.dataset.aicIcon).toBe("lock");
    expect(status()).toBeNull();
  });

  it("retains visible cut failure feedback when reusing the block's status", async () => {
    const { view, onCopy, control, status } = fixture();
    const original = view.state.doc;
    const copy = control("Copy security block");
    copy.click();
    await settle();
    expect(copy.dataset.aicIcon).toBe("check");
    onCopy.mockReturnValueOnce(false);
    control("Cut security block").click();
    await settle();
    expect(copy.dataset.aicIcon).toBe("copy");
    expect(status()!.textContent).toBe("Copy failed");
    expect(status()!.classList.contains("aic-field__status--icon")).toBe(false);
    expect(view.state.doc).toBe(original);
  });

  it("keeps the newest copy acknowledgement and retires pending feedback with its widget", async () => {
    let finishOld!: (copied: boolean) => void;
    const { view, onCopy, control, status } = fixture();
    const lock = control("Copy Password value");
    onCopy.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishOld = resolve;
        }),
    );
    lock.click();
    lock.click();
    await settle();
    expect(lock.dataset.aicIcon).toBe("check");
    finishOld(false);
    await settle();
    expect(lock.dataset.aicIcon).toBe("check");
    expect(status()!.textContent).toBe("Copied");

    let finishDetached!: (copied: boolean) => void;
    onCopy.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishDetached = resolve;
        }),
    );
    lock.click();
    expect(lock.dataset.aicIcon).toBe("lock");
    control("Edit security block").click();
    finishDetached(true);
    await settle();
    expect(lock.isConnected).toBe(false);
    expect(lock.dataset.aicIcon).toBe("lock");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(control("Copy Password value").dataset.aicIcon).toBe("lock");
    expect(status()).toBeNull();
  });

  it("preserves text feedback and recovery-code distinctions", async () => {
    const { control, status } = fixture(() => false);
    const email = control("Copy Email value");
    email.click();
    await settle();
    expect(email.textContent).toBe("person@example.test");
    expect(email.dataset.aicIcon).toBeUndefined();
    expect(status()!.textContent).toBe("Copy failed");
    expect(status()!.classList.contains("aic-field__status--icon")).toBe(false);
    const active = control("Copy Recovery one-time 1 and mark it used");
    const used = control("Reactivate Recovery used 2 without copying");
    expect(active.textContent).toBe("••••••");
    expect(used.textContent).toBe("••••••");
    active.click();
    await settle();
    expect(active.dataset.aicIcon).toBe("lock");
    expect(active.textContent).toBe("••••••");
    expect(
      active
        .closest(".cm-aic-security-row")!
        .querySelector(".aic-field__status--icon"),
    ).toBeNull();
  });
});

it("keeps shared icon feedback timed by default and supports a lifecycle-owned reset", async () => {
  vi.useFakeTimers();
  const button = document.body.appendChild(document.createElement("button"));
  showIconFeedback(button);
  expect(button.dataset.aicIcon).toBe("check");
  await vi.advanceTimersByTimeAsync(1200);
  expect(button.dataset.aicIcon).toBe("copy");
  expect(button.getAttribute("aria-label")).toBe("Copy");
  const restore = showIconFeedback(button, {
    duration: null,
    restoreIcon: "lock",
    restoreLabel: "Copy password",
  });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(button.dataset.aicIcon).toBe("check");
  restore();
  expect(button.dataset.aicIcon).toBe("lock");
  expect(button.getAttribute("aria-label")).toBe("Copy password");
});
