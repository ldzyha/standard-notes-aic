import { history, redo, undo } from "@codemirror/commands";
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSecurityImportExtension } from "../src/core/security-import-extension.js";
import { convertAuthenticatorJson } from "../src/core/security-import.js";
import { makeSecurityBlockExtension } from "../src/core/security-block.js";
import { aicMarkdownLanguage } from "../src/language";

const fakeSecret = "fixture-secret-not-real";
const json = JSON.stringify([
  { service: "Example", account: "fixture-account", secret: fakeSecret },
]);
const tick = String.fromCharCode(96);
const securityFence = tick.repeat(3) + "aic-security";
const views: EditorView[] = [];

function fixture(
  source = json,
  selection?: { anchor: number; head: number },
  onSave?: () => boolean | Promise<boolean>,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const readonly = new Compartment();
  const importer = new Compartment();
  const onUpdate = vi.fn();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: source,
      selection,
      extensions: [
        aicMarkdownLanguage(),
        history(),
        EditorState.allowMultipleSelections.of(true),
        readonly.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of(onUpdate),
        importer.of(makeSecurityImportExtension({ onSave })),
        makeSecurityBlockExtension({ document }),
      ],
    }),
  });
  views.push(view);
  return { host, view, readonly, importer, onUpdate };
}

function action(host: HTMLElement) {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label="Convert to security blocks"]',
  );
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("contextual authenticator import", () => {
  it("saves explicitly after conversion, waits for acknowledgement and retries without reconversion", async () => {
    let resolve: (saved: boolean) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const { host, view, onUpdate } = fixture(json, undefined, onSave);
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Convert and save security blocks"]',
    )!;
    button.click();
    expect(view.state.doc.toString()).toContain(securityFence);
    expect(onSave).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Saving note…",
    );
    button.click();
    expect(onSave).toHaveBeenCalledOnce();
    // A host may stamp metadata during save. That must not erase its status.
    view.dispatch({ changes: { from: 0, insert: "# Imported\n\n" } });
    resolve(false);
    await Promise.resolve();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "not saved",
    );
    const converted = view.state.doc.toString();
    const changes = onUpdate.mock.calls.filter(
      ([update]) => update.docChanged,
    ).length;
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Retry save"]')!
      .click();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(view.state.doc.toString()).toBe(converted);
    expect(
      onUpdate.mock.calls.filter(([update]) => update.docChanged),
    ).toHaveLength(changes);
    resolve(true);
    await Promise.resolve();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Note saved",
    );
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nLater edit" },
    });
    expect(
      host.querySelector('.cm-aic-security-import-bar [role="status"]'),
    ).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("keeps save failures value-free and disables retries when locked", async () => {
    const onSave = vi.fn(() => {
      throw new Error(fakeSecret);
    });
    const { host, view, readonly } = fixture(json, undefined, onSave);
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Convert and save security blocks"]',
      )!
      .click();
    const bar = host.querySelector(".cm-aic-security-import-bar")!;
    expect(bar.textContent).toContain("not saved");
    expect(bar.outerHTML).not.toContain(fakeSecret);
    const retry = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry save"]',
    )!;
    view.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(true)),
    });
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Retry save"]')!
        .disabled,
    ).toBe(true);
    retry.click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("ignores late save acknowledgements after switching sessions or removing the extension", async () => {
    for (const remove of [false, true]) {
      let resolve: (saved: boolean) => void = () => {};
      const { host, view, importer } = fixture(
        json,
        undefined,
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      );
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Convert and save security blocks"]',
        )!
        .click();
      if (remove) view.dispatch({ effects: importer.reconfigure([]) });
      else
        view.setState(
          EditorState.create({
            doc: "Another note",
            extensions: [makeSecurityImportExtension()],
          }),
        );
      resolve(true);
      await Promise.resolve();
      expect(host.querySelector(".cm-aic-security-import-bar")).toBeNull();
      if (!remove) expect(view.state.doc.toString()).toBe("Another note");
    }
  });

  it("shows only a count, never values, and does not convert until clicked", () => {
    const { host, view, onUpdate } = fixture();
    const bar = host.querySelector(".cm-aic-security-import-bar")!;
    expect(bar.textContent).toContain("1 block");
    expect(bar.outerHTML).not.toContain(fakeSecret);
    expect(bar.outerHTML).not.toContain("fixture-account");
    expect(view.state.doc.toString()).toBe(json);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(action(host)).not.toBeNull();
  });

  it("displays a count for multiple entries without retaining their values in the bar", () => {
    const source = JSON.stringify([
      { service: "One", account: "first-fixture", secret: fakeSecret },
      { service: "Two", account: "second-fixture", secret: "second-fake" },
    ]);
    const { host, view } = fixture(source);
    const bar = host.querySelector(".cm-aic-security-import-bar")!;
    expect(bar.textContent).toContain("2 blocks");
    expect(bar.outerHTML).not.toContain("first-fixture");
    expect(bar.outerHTML).not.toContain("second-fake");
    action(host)!.click();
    expect(view.state.doc.toString().split(securityFence)).toHaveLength(3);
    expect(host.querySelectorAll(".cm-aic-security")).toHaveLength(2);
  });

  it("replaces only the selected array amid Markdown with one undo step", () => {
    const source = "Before text\n\n" + json + "\n\nAfter text";
    const from = source.indexOf(json);
    const { host, view } = fixture(source, {
      anchor: from,
      head: from + json.length,
    });
    const converted = convertAuthenticatorJson(json);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    action(host)!.click();
    expect(view.state.doc.toString()).toBe(
      "Before text\n\n" + converted.markdown + "\n\nAfter text",
    );
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.from).toBe(
      ("Before text\n\n" + converted.markdown).length,
    );
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toContain(converted.markdown);
  });

  it("adds safe block boundaries when an array is selected inline", () => {
    const source = "Lead " + json + " tail";
    const from = source.indexOf(json);
    const { host, view } = fixture(source, {
      anchor: from,
      head: from + json.length,
    });
    action(host)!.click();
    expect(view.state.doc.toString()).toContain("Lead \n\n" + securityFence);
    expect(view.state.doc.toString()).toContain(tick.repeat(3) + "\n\n tail");
    expect(host.querySelector(".cm-aic-security")).not.toBeNull();
  });

  it("supports a full JSON fence and expands an exact selected JSON body", () => {
    const fence = "~~~~json\n" + json + "\n~~~~";
    const whole = fixture(fence);
    expect(action(whole.host)).not.toBeNull();
    action(whole.host)!.click();
    expect(whole.view.state.doc.toString()).toContain(securityFence);

    const source = "Before\n\n" + fence + "\n\nAfter";
    const from = source.indexOf(json);
    const selected = fixture(source, {
      anchor: from,
      head: from + json.length,
    });
    action(selected.host)!.click();
    expect(selected.view.state.doc.toString()).not.toContain("~~~~json");
    expect(selected.view.state.doc.toString()).toContain(
      "Before\n\n" + securityFence,
    );
    expect(selected.view.state.doc.toString()).toContain(
      tick.repeat(3) + "\n\nAfter",
    );

    const longFence = tick.repeat(4) + "JSON\n" + json + "\n" + tick.repeat(4);
    const long = fixture(longFence);
    action(long.host)!.click();
    expect(long.view.state.doc.toString()).toContain(securityFence);
  });

  it("rejects selection within a non-JSON or outer fence and code-like blocks", () => {
    for (const source of [
      "~~~text\n" + json + "\n~~~",
      "~~~~text\n" +
        tick.repeat(3) +
        "json\n" +
        json +
        "\n" +
        tick.repeat(3) +
        "\n~~~~",
      "<!--\n" + json + "\n-->",
      "    " + json,
      "---\n" + json + "\n---",
    ]) {
      const from = source.indexOf(json);
      const { host } = fixture(source, {
        anchor: from,
        head: from + json.length,
      });
      expect(action(host), source).toBeNull();
    }
  });

  it("shows fixed repair guidance for recognizable invalid JSON, not arbitrary JSON", () => {
    const invalid =
      '[{"service":"Example","account":"fixture","secret":"' +
      fakeSecret +
      '",}]';
    const first = fixture(invalid);
    const bar = first.host.querySelector(".cm-aic-security-import-bar")!;
    expect(bar.textContent).toContain("could not be converted");
    expect(bar.outerHTML).not.toContain(fakeSecret);
    expect(action(first.host)).toBeNull();
    expect(
      fixture('[{"value":"ordinary"}]').host.querySelector(
        ".cm-aic-security-import-bar",
      ),
    ).toBeNull();
    expect(
      fixture(
        '[{"meta":{"service":"x","account":"y","secret":"z"}}]',
      ).host.querySelector(".cm-aic-security-import-bar"),
    ).toBeNull();
  });

  it("cannot convert from stale, read-only, or multi-selection controls", () => {
    const first = fixture();
    const stale = action(first.host)!;
    first.view.dispatch({
      changes: { from: 0, to: json.length, insert: "New note" },
    });
    stale.click();
    expect(first.view.state.doc.toString()).toBe("New note");

    const second = fixture();
    const readonlyButton = action(second.host)!;
    second.view.dispatch({
      effects: second.readonly.reconfigure(EditorState.readOnly.of(true)),
    });
    readonlyButton.click();
    expect(second.view.state.doc.toString()).toBe(json);

    const third = fixture();
    const multiButton = action(third.host)!;
    third.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(json.length),
      ]),
    });
    multiButton.click();
    expect(third.view.state.doc.toString()).toBe(json);
  });

  it("keeps its live action across unrelated effects and cleans up on disposal", () => {
    const { host, view } = fixture();
    const live = action(host)!;
    const unrelated = StateEffect.define<number>();
    view.dispatch({ effects: unrelated.of(1) });
    expect(action(host)).toBe(live);
    view.dispatch({ selection: { anchor: json.length } });
    expect(action(host)).toBe(live);
    live.click();
    expect(view.state.doc.toString()).toContain(securityFence);
    view.destroy();
    expect(host.querySelector(".cm-aic-security-import-bar")).toBeNull();
  });

  it("retains no callable action after selection change or extension removal", () => {
    const { host, view, importer } = fixture();
    const old = action(host)!;
    view.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(action(host)).toBeNull();
    old.click();
    expect(view.state.doc.toString()).toBe(json);
    view.dispatch({ selection: { anchor: 0 } });
    const replacement = action(host)!;
    view.dispatch({ effects: importer.reconfigure([]) });
    replacement.click();
    expect(view.state.doc.toString()).toBe(json);
    expect(action(host)).toBeNull();
  });
});
