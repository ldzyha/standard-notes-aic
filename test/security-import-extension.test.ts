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

function fixture(source = json, selection?: { anchor: number; head: number }) {
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
        importer.of(makeSecurityImportExtension()),
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
