import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";
import { makeSecurityImportExtension } from "../src/core/security-import-extension.js";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

it("shows paste feedback and emits the edit after a converted widget remounts", async () => {
  let resolveRead: (value: string) => void = () => {};
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
  );
  const changed = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: JSON.stringify([
        {
          service: "Fixture",
          account: "fixture-account",
          secret: "",
          password: "",
        },
      ]),
      extensions: [
        aicMarkdownLanguage(),
        makeSecurityImportExtension({ onSave: () => true }),
        makeSecurityBlockExtension({ document, onReadClipboard: read }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed(update.state.doc.toString());
        }),
      ],
    }),
  });
  views.push(view);
  host
    .querySelector<HTMLButtonElement>(
      '[aria-label="Convert and save security blocks"]',
    )!
    .click();
  await Promise.resolve();
  changed.mockClear();
  const original = host.querySelector(".cm-aic-security")!;
  // The same descriptor remount occurs when CodeMirror evicts a mobile viewport.
  view.setState(view.state);
  expect(original.isConnected).toBe(false);
  const paste = host.querySelector<HTMLButtonElement>(
    '[aria-label="Paste Password"]',
  )!;
  expect(paste).not.toBeNull();
  paste.click();
  expect(read).toHaveBeenCalledOnce();
  expect(paste.closest(".cm-aic-security-row")!.textContent).toContain(
    "Pasting…",
  );
  resolveRead("fixture-pasted-value");
  for (let index = 0; index < 6; index++) await Promise.resolve();
  expect(view.state.doc.toString()).toContain("fixture-pasted-value");
  expect(changed).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledWith(view.state.doc.toString());
  expect(host.querySelector('[aria-label="Paste Password"]')).toBeNull();
  expect(
    host
      .querySelector('[aria-label="Copy Password value"]')!
      .getAttribute("data-aic-icon"),
  ).toBe("lock");
});
