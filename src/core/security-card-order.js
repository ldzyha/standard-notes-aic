import { syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import { ViewPlugin } from "@codemirror/view";
import { saveAction } from "./save-boundary.js";
import { wirePreviewReorder } from "./preview-reorder.js";

function standalone(state, block) {
  let node = syntaxTree(state).resolveInner(block.from, 1);
  while (node && node.name !== "FencedCode") node = node.parent;
  if (node?.parent?.name !== "Document") return false;
  const first = state.doc.lineAt(block.from);
  const last = state.doc.lineAt(block.to);
  const opening = /^ {0,3}(`{3,}|~{3,})aic[ \t]*$/u.exec(first.text);
  return Boolean(
    opening &&
    last.from > first.from &&
    new RegExp(
      "^ {0,3}" + opening[1][0] + "{" + opening[1].length + ",}[ \\t]*$",
    ).test(last.text),
  );
}

/** Preserve every other source byte; nested or unfinished fences never move. */
export function securityCardMove(state, source, target) {
  if (
    source.from === target.from ||
    !standalone(state, source) ||
    !standalone(state, target)
  )
    return null;
  const down = source.from < target.from;
  const boundary = down ? target.to : target.from;
  const text = state.sliceDoc(source.from, source.to);
  const changes = state.changes([
    { from: source.from, to: source.to, insert: "" },
    { from: boundary, insert: down ? "\n\n" + text : text + "\n\n" },
  ]);
  return {
    changes,
    selection: { anchor: changes.mapPos(boundary, -1) + (down ? 2 : 0) },
  };
}

/** One manager per editor; widgets only register their DOM and current source. */
export function securityCardOrdering() {
  const mounts = new WeakMap();
  return {
    register(element, handle, getBlock) {
      element.dataset.aicCardDraggable = "true";
      mounts.set(element, { element, handle, getBlock });
      return () => mounts.delete(element);
    },
    extension: ViewPlugin.define((view) => {
      let snapshot = null;
      const items = () =>
        [...view.dom.querySelectorAll("[data-aic-card-draggable]")]
          .filter((element) => element.closest(".cm-editor") === view.dom)
          .map((element) => mounts.get(element))
          .filter(Boolean);
      const canMove = (from, to) => {
        const entries = items();
        const source = entries[from]?.getBlock();
        const target = entries[to]?.getBlock();
        return (
          !view.state.readOnly &&
          from !== to &&
          source &&
          target &&
          standalone(view.state, source) &&
          standalone(view.state, target)
        );
      };
      const dispose = wirePreviewReorder({
        root: view.dom,
        items,
        canMove,
        onStart: () => {
          if (view.state.readOnly) return false;
          snapshot = view.state.doc;
          return true;
        },
        onMove: (from, to) => {
          if (view.state.doc !== snapshot || !canMove(from, to)) return;
          const entries = items();
          const move = securityCardMove(
            view.state,
            entries[from].getBlock(),
            entries[to].getBlock(),
          );
          if (move)
            view.dispatch({
              ...move,
              annotations: [saveAction.of(true), isolateHistory.of("full")],
              userEvent: "input",
            });
        },
      });
      return { destroy: dispose };
    }),
  };
}
