import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import {
  isSaveAction,
  saveAction,
  wireSaveBoundary,
} from "../src/core/save-boundary.js";

afterEach(() => document.body.replaceChildren());

it("saves only when leaving the surface and removes all listeners on cleanup", () => {
  const root = document.createElement("section");
  const text = document.createElement("textarea");
  const action = document.createElement("button");
  const outside = document.createElement("button");
  root.append(text, action);
  document.body.append(root, outside);
  const save = vi.fn();
  const dispose = wireSaveBoundary(root, save);
  text.focus();
  text.dispatchEvent(new Event("input", { bubbles: true }));
  action.focus();
  expect(save).not.toHaveBeenCalled();
  outside.focus();
  expect(save).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("blur"));
  expect(save).toHaveBeenCalledTimes(1);
  text.focus();
  window.dispatchEvent(new Event("blur"));
  expect(save).toHaveBeenCalledTimes(2);
  dispose();
  dispose();
  outside.focus();
  window.dispatchEvent(new Event("blur"));
  expect(save).toHaveBeenCalledTimes(2);
});

it("only annotations on document-changing actions request immediate save", () => {
  const results: boolean[] = [];
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "test",
      extensions: EditorView.updateListener.of((update) =>
        results.push(isSaveAction(update)),
      ),
    }),
  });
  view.dispatch({
    changes: { from: 4, insert: " typing" },
    userEvent: "input",
  });
  view.dispatch({ annotations: saveAction.of(true) });
  view.dispatch({
    changes: { from: 4, insert: " action" },
    annotations: saveAction.of(true),
  });
  expect(results).toEqual([false, false, true]);
  view.destroy();
});
