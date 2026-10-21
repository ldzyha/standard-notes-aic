import { describe, expect, it, vi } from "vitest";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CALLOUT_CORE_VERSION,
  calloutKind,
  makeCalloutExtension,
} from "../src/core/callout-decorations.js";
import { aicMarkdownLanguage } from "../src/language";
import { markdownDecorations } from "../src/markdown-decorations";

const source = [
  "> Info",
  "!> Caution",
  "!>> Failed",
  "```text",
  "!> literal",
  "```",
  ">>> Details",
  "body",
  "<<<",
].join("\n");

function mount(parsed: boolean) {
  const state = EditorState.create({
    doc: source,
    extensions: [
      aicMarkdownLanguage(),
      markdownDecorations,
      makeCalloutExtension(),
    ],
  });
  // The parser works in time slices and may be unfinished on a loaded machine.
  if (parsed)
    expect(ensureSyntaxTree(state, state.doc.length, 5000)).not.toBeNull();
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state });
  return { view, dispose: () => (view.destroy(), parent.remove()) };
}

function expectOnlyAuthoredCallouts(view: EditorView) {
  expect(view.dom.querySelectorAll(".cm-md-callout-line")).toHaveLength(2);
  expect(view.dom.querySelectorAll(".cm-md-callout-warning")).toHaveLength(1);
  expect(view.dom.querySelectorAll(".cm-md-callout-error")).toHaveLength(1);
  expect(view.dom.querySelectorAll(".cm-md-callout-marker")).toHaveLength(2);
  expect(view.dom.querySelectorAll(".cm-md-callout-text")).toHaveLength(2);
}

describe("information, warning and error quotes", () => {
  it("recognizes warning/error markers without taking over details or ordinary text", () => {
    expect(CALLOUT_CORE_VERSION).toBe("1.0.0");
    expect(calloutKind("!> Caution")).toBe("warning");
    expect(calloutKind("!>> Failed")).toBe("error");
    expect(calloutKind("  !>> Failed")).toBe("error");
    expect(calloutKind("> Info")).toBeNull();
    expect(calloutKind(">>> Details")).toBeNull();
    expect(calloutKind("!>not-a-marker")).toBeNull();
  });

  it("styles only authored callout lines outside code fences", () => {
    const { view, dispose } = mount(true);
    try {
      expect(view.state.doc.toString()).toBe(source);
      expectOnlyAuthoredCallouts(view);
    } finally {
      dispose();
    }
  });

  it("redraws when a slow parse finishes after the first paint", async () => {
    // Make the initial parse budget expire at once, as it does under CPU load:
    // the fence is not yet known and its literal line looks like a callout.
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 1000));
    let mounted: ReturnType<typeof mount>;
    try {
      mounted = mount(false);
    } finally {
      vi.restoreAllMocks();
    }
    try {
      expect(syntaxTreeAvailable(mounted.view.state)).toBe(false);
      await vi.waitFor(() => expectOnlyAuthoredCallouts(mounted.view), {
        timeout: 5000,
      });
    } finally {
      mounted.dispose();
    }
  });
});
