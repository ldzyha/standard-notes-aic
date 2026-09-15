import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("clears transient feedback and ignores an older acknowledgement on the same target", async () => {
  const { view, copy } = fixture("Account | visible-value");
  const target = view.dom.querySelector<HTMLButtonElement>(
    ".cm-aic-security-value",
  )!;
  let finishOld!: (value: boolean) => void;
  copy.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishOld = resolve;
      }),
  );
  target.click();
  target.click();
  await vi.waitFor(() =>
    expect(
      view.dom.querySelector(".cm-aic-security-field-status:not(:empty)")
        ?.textContent,
    ).toBe("Copied"),
  );
  finishOld(false);
  await Promise.resolve();
  expect(
    view.dom.querySelector(".cm-aic-security-field-status:not(:empty)")
      ?.textContent,
  ).toBe("Copied");
  vi.useFakeTimers();
  target.click();
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1601);
  expect(
    view.dom.querySelector(".cm-aic-security-field-status:not(:empty)"),
  ).toBeNull();
  expect(target.textContent).toBe("visible-value");
});

it("filters labels and text parts but never card digits or secret parts", () => {
  const { view } = fixture(
    "Card _| 4242 4242 4242 1234 | 09/28 *| 019\nUsername | alice",
  );
  const search = view.dom.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )!;
  const filter = (query: string) => {
    search.value = query;
    search.dispatchEvent(new Event("input", { bubbles: true }));
  };
  filter("alice");
  expect(
    view.dom.querySelector<HTMLElement>('[data-aic-card-kind="fields"]')!
      .hidden,
  ).toBe(true);
  filter("4242");
  expect(
    view.dom.querySelectorAll(".cm-aic-security-section:not([hidden])"),
  ).toHaveLength(0);
  filter("1234");
  expect(
    view.dom.querySelector<HTMLElement>('[data-aic-card-kind="fields"]')!
      .hidden,
  ).toBe(true);
  filter("019");
  expect(
    view.dom.querySelectorAll(".cm-aic-security-section:not([hidden])"),
  ).toHaveLength(0);
  filter("09/28");
  expect(
    view.dom.querySelector<HTMLElement>('[data-aic-card-kind="fields"]')!
      .hidden,
  ).toBe(false);
  filter("");
  expect(
    view.dom.querySelectorAll(
      ".cm-aic-security-section [hidden]:is(.cm-aic-security-card, .cm-aic-security-row)",
    ),
  ).toHaveLength(0);
});
function fixture(body: string, readOnly = false) {
  const copy = vi.fn(async () => true);
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "```aic\n" + body + "\n```",
      extensions: [
        aicMarkdownLanguage(),
        EditorState.readOnly.of(readOnly),
        makeSecurityBlockExtension({ onCopy: copy }),
      ],
    }),
  });
  views.push(view);
  return { view, copy };
}

it("copies an arbitrary username independently from its hidden value without editing", async () => {
  const { view, copy } = fixture("alice@example.test *| SYNTHETIC-SECRET");
  const doc = view.state.doc;
  const label = view.dom.querySelector<HTMLButtonElement>(
    ".cm-aic-security-section-title",
  )!;
  const value = view.dom.querySelector<HTMLButtonElement>(
    ".cm-aic-security-value",
  )!;
  label.click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenLastCalledWith(
      "alice@example.test",
      "alice@example.test label",
    ),
  );
  value.click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenLastCalledWith(
      "SYNTHETIC-SECRET",
      "alice@example.test",
    ),
  );
  expect(view.state.doc).toBe(doc);
  expect(view.dom.innerHTML).not.toContain("SYNTHETIC-SECRET");
});

it("renders unnamed fields without a phantom label and copies the value", async () => {
  const { view, copy } = fixture("*| SYNTHETIC-SECRET\n| visible");
  expect(view.dom.querySelectorAll(".is-unlabelled")).toHaveLength(2);
  expect(view.dom.querySelector(".cm-aic-security-label")).toBeNull();
  view.dom
    .querySelector<HTMLButtonElement>('[aria-label="Copy Row value"]')!
    .click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenCalledWith("SYNTHETIC-SECRET", "Row"),
  );
  expect(view.dom.innerHTML).not.toContain("SYNTHETIC-SECRET");
});

it("positions copy feedback over the pressed target, outside normal row layout", async () => {
  const { view } = fixture("Account | visible-value");
  const row = view.dom.querySelector<HTMLElement>(".cm-aic-security-row")!;
  const target = row.querySelector<HTMLButtonElement>(
    ".cm-aic-security-value",
  )!;
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    left: 20,
    top: 10,
  } as DOMRect);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    left: 110,
    top: 15,
    width: 160,
    height: 32,
  } as DOMRect);
  target.click();
  await vi.waitFor(() =>
    expect(
      row.querySelector(".cm-aic-security-field-status:not(:empty)")
        ?.textContent,
    ).toBe("Copied"),
  );
  const status = row.querySelector<HTMLElement>(
    ".cm-aic-security-field-status:not(:empty)",
  )!;
  expect(status.parentElement).toBe(row);
  expect(status.style.left).toBe("90px");
  expect(status.style.top).toBe("5px");
  expect(status.style.width).toBe("160px");
  expect(status.style.minHeight).toBe("32px");
});

it("copies a composite field's optional label independently of every value part", async () => {
  const { view, copy } = fixture(
    "username *| SYNTHETIC-SECRET | Work\n*| SECOND-SECRET | Home",
  );
  const headers = view.dom.querySelectorAll<HTMLButtonElement>(
    ".cm-aic-security-card-title-copy button",
  );
  expect(headers).toHaveLength(1);
  headers[0]!.click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenCalledWith("username", "username label"),
  );
  expect(view.dom.innerHTML).not.toContain("SYNTHETIC-SECRET");
  expect(view.dom.innerHTML).not.toContain("SECOND-SECRET");
});

it("disables contextual Section actions at the limit without blocking row insertion", () => {
  const { view } = fixture(
    Array.from({ length: 16 }, () => "Password *| value").join("\n---\n"),
  );
  const section = view.dom.querySelector<HTMLButtonElement>(
    '[aria-label="Add section after section 1"]',
  )!;
  expect(section.disabled).toBe(true);
  expect(section.title).toContain("16 sections");
  expect(
    view.dom.querySelector<HTMLButtonElement>(
      '[aria-label="Add row after Password"]',
    )!.disabled,
  ).toBe(false);
  expect(view.dom.textContent).toContain("When you reach a limit");
});

it("keeps read-only typed previews masked and label/value copying independent", async () => {
  const { view, copy } = fixture(
    "Account *| SYNTHETIC-READONLY-SECRET | visible note",
    true,
  );
  const original = view.state.doc;
  expect(
    view.dom.querySelector('[aria-label="Add field to Account"]'),
  ).toBeNull();
  expect(
    view.dom.querySelector('[aria-label="Add row after Account"]'),
  ).toBeNull();
  expect(
    view.dom.querySelector('[aria-label="Edit security block"]'),
  ).toBeNull();
  view.dom
    .querySelector<HTMLButtonElement>('[aria-label="Copy Account label"]')!
    .click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenLastCalledWith("Account", "Account label"),
  );
  view.dom
    .querySelector<HTMLButtonElement>('[aria-label="Copy Account secret 1"]')!
    .click();
  await vi.waitFor(() =>
    expect(copy).toHaveBeenLastCalledWith(
      "SYNTHETIC-READONLY-SECRET",
      "Account secret 1",
    ),
  );
  expect(view.state.doc).toBe(original);
  expect(view.dom.innerHTML).not.toContain("SYNTHETIC-READONLY-SECRET");
});

it("disables the Field trigger at capacity with an accessible visible reason", () => {
  const { view } = fixture(
    "Row " + Array.from({ length: 64 }, () => "*| value").join(" "),
  );
  const add = view.dom.querySelector<HTMLButtonElement>(
    '[aria-label="Add field to Row"]',
  )!;
  expect(add.disabled).toBe(true);
  expect(
    document.getElementById(add.getAttribute("aria-describedby")!)?.textContent,
  ).toContain("64 fields");
  expect(add.title).toContain("Add a row instead");
});

it("quarantines historical or versioned fences without interpreting or showing secrets", () => {
  for (const fence of [
    "aic-security",
    "aic-security v3",
    "aic v3",
    "aic invalid",
  ]) {
    const { view } = fixture("Password*: SYNTHETIC-SECRET");
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: `\`\`\`${fence}\nPassword*: SYNTHETIC-SECRET\n\`\`\``,
      },
    });
    expect(view.dom.innerHTML).not.toContain("SYNTHETIC-SECRET");
    expect(view.dom.textContent).toContain(
      "Use the opening fence aic without a version suffix",
    );
  }
});
