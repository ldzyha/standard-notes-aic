import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";
import { parseSecurityDocument } from "../src/core/security-model.js";

const views: EditorView[] = [];

function fixture(
  body: string,
  options: {
    readOnly?: boolean;
    onCopy?: (value: string, label: string) => boolean | Promise<boolean>;
  } = {},
) {
  const onCopy = vi.fn(options.onCopy ?? (() => true));
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: `\`\`\`aic\n${body}\n\`\`\``,
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(Boolean(options.readOnly)),
        makeSecurityBlockExtension({ onCopy }),
      ],
    }),
  });
  views.push(view);
  return { view, onCopy };
}

function copySection(view: EditorView, name: string) {
  const copy = view.dom.querySelector<HTMLButtonElement>(
    `button[aria-label="Copy section ${name}"]`,
  );
  expect(copy, name).not.toBeNull();
  copy!.click();
  return copy!;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("Security section copy", () => {
  it("copies every named section independently as a valid canonical aic block", async () => {
    const { view, onCopy } = fixture(
      [
        "# Accounts",
        "## Work",
        'Login | "alice@example.test"',
        'Password *| "SYNTHETIC|WORK-SECRET"',
        "---",
        "## Personal",
        "Login | personal@example.test",
        "Password *| SYNTHETIC-PERSONAL-SECRET",
        "---",
        "## Empty",
      ].join("\n"),
    );
    const filter = view.dom.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    filter.value = "Login";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      view.dom.querySelectorAll('button[aria-label^="Copy section "]'),
    ).toHaveLength(3);
    copySection(view, "Work");
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith(
        [
          "```aic",
          "## Work",
          "Login | alice@example.test",
          'Password *| "SYNTHETIC|WORK-SECRET"',
          "```",
        ].join("\n"),
        "Work section",
      ),
    );
    copySection(view, "Personal");
    filter.value = "";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    copySection(view, "Empty");
    await vi.waitFor(() => expect(onCopy).toHaveBeenCalledTimes(3));
    const work = onCopy.mock.calls[0]![0]!;
    const personal = onCopy.mock.calls[1]![0]!;
    const empty = onCopy.mock.calls[2]![0]!;
    expect(parseSecurityDocument(work)).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "Work",
            fields: [
              {
                label: "Login",
                parts: [{ kind: "text", value: "alice@example.test" }],
              },
              {
                label: "Password",
                parts: [{ kind: "secret", value: "SYNTHETIC|WORK-SECRET" }],
              },
            ],
          },
        ],
      },
    });
    expect(personal).toBe(
      [
        "```aic",
        "## Personal",
        "Login | personal@example.test",
        "Password *| SYNTHETIC-PERSONAL-SECRET",
        "```",
      ].join("\n"),
    );
    expect(parseSecurityDocument(personal).ok).toBe(true);
    expect(empty).toBe("```aic\n## Empty\n```");
    expect(parseSecurityDocument(empty)).toEqual({
      ok: true,
      model: { sections: [{ label: "Empty", fields: [] }] },
    });
    expect(work).not.toContain("Accounts");
    expect(work).not.toContain("Personal");
    expect(personal).not.toContain("Work");
    expect(view.dom.innerHTML).not.toContain("SYNTHETIC|WORK-SECRET");
    expect(view.dom.innerHTML).not.toContain("SYNTHETIC-PERSONAL-SECRET");
  });

  it("keeps unnamed and read-only sections independently copyable", async () => {
    const { view, onCopy } = fixture("*| SYNTHETIC-SECRET", {
      readOnly: true,
    });
    const copy = copySection(view, "1");
    expect(copy.closest(".aic-card__section-actions")).not.toBeNull();
    expect(view.dom.querySelector(".cm-aic-security-section-title")).toBeNull();
    await vi.waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith(
        "```aic\n*| SYNTHETIC-SECRET\n```",
        "section 1",
      ),
    );
    expect(view.state.doc.toString()).toContain("SYNTHETIC-SECRET");

    const empty = fixture("", { readOnly: true });
    expect(
      empty.view.dom.querySelector('button[aria-label^="Copy section "]'),
    ).toBeNull();
    expect(
      empty.view.dom.querySelector(".cm-aic-security-section-header:empty"),
    ).not.toBeNull();
  });

  it("reports failure and retires detached section copy work", async () => {
    let finish!: (copied: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const { view, onCopy } = fixture("## Work\nPassword *| SYNTHETIC", {
      onCopy: () => pending,
    });
    const oldCopy = copySection(view, "Work");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "Replacement" },
    });
    finish(false);
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("Copy failed");
    oldCopy.click();
    expect(onCopy).toHaveBeenCalledOnce();

    const failed = fixture("## Failed\nAccount | value", {
      onCopy: async () => false,
    });
    copySection(failed.view, "Failed");
    await vi.waitFor(() =>
      expect(failed.view.dom.textContent).toContain("Copy failed"),
    );
  });
});
