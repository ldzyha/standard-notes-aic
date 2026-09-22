import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CALLOUT_CORE_VERSION,
  calloutKind,
  makeCalloutExtension,
} from "../src/core/callout-decorations.js";
import { aicMarkdownLanguage } from "../src/language";
import { markdownDecorations } from "../src/markdown-decorations";

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
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          aicMarkdownLanguage(),
          markdownDecorations,
          makeCalloutExtension(),
        ],
      }),
    });
    try {
      expect(view.state.doc.toString()).toBe(source);
      expect(view.dom.querySelectorAll(".cm-md-callout-line")).toHaveLength(2);
      expect(view.dom.querySelectorAll(".cm-md-callout-warning")).toHaveLength(
        1,
      );
      expect(view.dom.querySelectorAll(".cm-md-callout-error")).toHaveLength(1);
      expect(view.dom.querySelectorAll(".cm-md-callout-marker")).toHaveLength(
        2,
      );
      expect(view.dom.querySelectorAll(".cm-md-callout-text")).toHaveLength(2);
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
