import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aicMarkdownLanguage } from "../src/language";
import {
  makeSecurityBlockExtension,
  securityBlocks,
} from "../src/core/security-block.js";
import {
  makeSecurityImportExtension,
  securityImportSaved,
} from "../src/core/security-import-extension.js";

const source = "```aic-security\n## Main\nAccount: fixture-account\n```";
const views: EditorView[] = [];
function fixture(
  text = source,
  onSave?: () => boolean,
  onReadClipboard?: () => Promise<string>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const onCopy = vi.fn(() => true);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        aicMarkdownLanguage(),
        makeSecurityBlockExtension({ document, onCopy, onReadClipboard }),
        makeSecurityImportExtension({ onSave }),
      ],
    }),
  });
  views.push(view);
  return { host, view, onCopy };
}
function button(host: HTMLElement, label: string) {
  const element = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(element).not.toBeNull();
  return element!;
}
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe("security preview after import", () => {
  it("shows two imported accounts in one Security block with separate sections", () => {
    const { host, view, onCopy } = fixture(
      JSON.stringify([
        { service: "First", account: "first-account", secret: "" },
        { service: "Second", account: "second-account", secret: "" },
      ]),
    );
    expect(
      host.querySelector(".cm-aic-security-import-count")?.textContent,
    ).toBe("2 accounts · 1 block");
    button(host, "Convert to security blocks").click();
    expect(securityBlocks(view.state)).toHaveLength(1);
    expect(view.state.doc.toString().match(/^---$/gmu)).toHaveLength(1);
    const accounts = host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Copy Account"]',
    );
    expect(accounts).toHaveLength(2);
    accounts[1]!.click();
    expect(onCopy).toHaveBeenCalledWith("second-account", "Account");
  });

  it("explains capacity splitting without classifying or exposing accounts", () => {
    const entries = Array.from({ length: 17 }, (_, index) => ({
      service: `fixture-service-${index}`,
      account: `fixture-account-${index}`,
      secret: `fixture-secret-${index}`,
    }));
    const { host, view } = fixture(JSON.stringify(entries));
    const bar = host.querySelector(".cm-aic-security-import-bar")!;
    expect(bar.textContent).toContain("17 accounts · 2 blocks");
    expect(bar.textContent).toContain("Split into multiple blocks");
    expect(bar.textContent).toContain(
      "services, banks, web, or social networks",
    );
    expect(bar.outerHTML).not.toContain("fixture-secret");
    expect(bar.outerHTML).not.toContain("fixture-account");
    button(host, "Convert to security blocks").click();
    expect(securityBlocks(view.state)).toHaveLength(2);
  });

  it("copies after conversion, metadata insertion and save acknowledgement", async () => {
    const { host, view, onCopy } = fixture(
      JSON.stringify([
        { service: "Fixture", account: "fixture-account", secret: "" },
      ]),
      () => true,
    );
    button(host, "Convert and save security blocks").click();
    view.dispatch({ changes: { from: 0, insert: "# Metadata\n\n" } });
    view.dispatch({ effects: securityImportSaved.of(null) });
    await Promise.resolve();
    button(host, "Copy Account").click();
    expect(onCopy).toHaveBeenCalledWith("fixture-account", "Account");
  });

  it("copies when the same decoration widget mounts again after destruction", () => {
    const { host, view, onCopy } = fixture();
    const original = host.querySelector<HTMLElement>(".cm-aic-security")!;
    // CodeMirror destroys the DOM and draws the retained state's decorations
    // again. Viewport eviction/remount uses the same WidgetType lifecycle.
    view.setState(view.state);
    expect(original.isConnected).toBe(false);
    button(host, "Copy Account").click();
    expect(onCopy).toHaveBeenCalledWith("fixture-account", "Account");
  });

  it("does not revive detached controls when the decoration mounts again", () => {
    const { host, view } = fixture();
    const detached = button(host, "Add Email");
    view.setState(view.state);
    detached.click();
    expect(view.state.doc.toString()).toBe(source);
    button(host, "Add Email").click();
    expect(view.state.doc.toString()).toContain("Email:");
  });

  it("discards a clipboard read from the destroyed DOM when the same state mounts again", async () => {
    let resolveRead: (value: string) => void = () => {};
    const onReadClipboard = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const text = "```aic-security\n## Main\nAccount:\n```";
    const { host, view } = fixture(text, undefined, onReadClipboard);
    button(host, "Paste Account").click();
    expect(onReadClipboard).toHaveBeenCalledOnce();
    view.setState(view.state);
    resolveRead("late-fixture-value");
    await Promise.resolve();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(text);
    expect(host.querySelector(".cm-aic-security-panel")).toBeNull();
    expect(button(host, "Paste Account").disabled).toBe(false);
  });

  it("disposes each mounted TOTP timer including after equal descriptor reuse", () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const codeTimers = () =>
      interval.mock.calls.flatMap((args, index) =>
        args[1] === 1000 ? [interval.mock.results[index]!.value] : [],
      );
    const { view } = fixture(
      "```aic-security\n## Main\nTOTP*: JBSWY3DPEHPK3PXP\n```\n\nAfter",
    );
    expect(codeTimers()).toHaveLength(1);
    const original = codeTimers()[0];
    view.dispatch({ changes: { from: 0, insert: "Prefix\n\n" } });
    view.setState(view.state);
    expect(clear).toHaveBeenCalledWith(original);
    expect(codeTimers().length).toBeGreaterThanOrEqual(2);
    views.splice(views.indexOf(view), 1);
    view.destroy();
    for (const timer of codeTimers()) expect(clear).toHaveBeenCalledWith(timer);
  });

  it("keeps duplicate block action targets current across repeated position shifts", () => {
    const { host, view } = fixture(source + "\n\n" + source + "\n\nAfter");
    view.dispatch({ changes: { from: 0, insert: "First prefix\n\n" } });
    view.dispatch({ changes: { from: 0, insert: "Second prefix\n\n" } });
    button(host, "Add Email").click();
    const blocks = securityBlocks(view.state);
    expect(blocks[0]!.body).toContain("Email:");
    expect(blocks[1]!.body).not.toContain("Email:");
  });
});
