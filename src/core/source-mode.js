import { Compartment, Facet, Prec, StateEffect } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { createIconButton } from "./structured-preview.js";
import { detailsForDocument } from "./details-model.js";

export const SOURCE_MODE_CORE_VERSION = "1.1.0";

/** Preview extensions use this effect to release an explicit source edit. */
export const sourcePreviewExit = StateEffect.define();

/** Each preview extension may report its current source-edit range. */
export const sourcePreviewExitHandlers = Facet.define({
  combine: (handlers) => handlers,
});

function activeSourceRange(state) {
  const head = state.selection.main.head;
  for (const handler of state.facet(sourcePreviewExitHandlers)) {
    const range = handler(state);
    if (
      range &&
      Number.isSafeInteger(range.from) &&
      Number.isSafeInteger(range.to) &&
      range.from <= head &&
      head <= range.to
    )
      return range;
  }
  return null;
}

// Whole-note source mode has no preview fields installed. Locate only the
// block containing the caret, so Escape can restore its preview without
// sending a reader back to the beginning of a long note.
function nearbyPreviewAnchor(state) {
  const head = state.selection.main.head;
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state);
  let structuralEnd = null;
  tree.iterate({
    enter(node) {
      if (
        (node.name === "FencedCode" || node.name === "Table") &&
        node.from <= head &&
        head < node.to
      )
        structuralEnd = Math.max(structuralEnd ?? 0, node.to);
    },
  });
  if (structuralEnd !== null) return structuralEnd;

  const details = detailsForDocument(doc).find(
    (block) => block.from <= head && head < block.end,
  );
  if (details) return details.end;

  // Frontmatter is not a Lezer node; its document-leading delimiter is
  // sufficient to select a safe position immediately after that block.
  if (doc.line(1).text.trim() === "---") {
    for (let number = 2; number <= doc.lines; number++) {
      const current = doc.line(number);
      if (current.text.trim() === "---") {
        if (head < current.to) return current.to;
        break;
      }
    }
  }
  return head;
}

/** Reconfigure preview-only extensions without replacing Markdown or history. */
export function createSourceModeController() {
  const compartment = new Compartment();
  const buttons = new Set();
  let previews = [];
  let mode = "preview";
  let scrollRevision = 0;

  const reflect = () => {
    for (const button of buttons) {
      const source = mode === "source";
      const label = source ? "Show preview" : "Show Markdown source";
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(source));
      button.title = label;
      button.dataset.aicSourceMode = mode;
      button.dataset.aicIcon = source ? "diagram" : "source";
    }
  };

  const toggle = (view, escape = false) => {
    if (!view || compartment.get(view.state) === undefined) return mode;
    if (escape && mode === "source")
      view.dispatch({ selection: { anchor: nearbyPreviewAnchor(view.state) } });
    const scroll = view.scrollDOM;
    const top = scroll.scrollTop;
    const left = scroll.scrollLeft;
    const oldRange = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const fraction = oldRange ? top / oldRange : 0;
    const revision = ++scrollRevision;
    mode = mode === "preview" ? "source" : "preview";
    view.dispatch({
      effects: compartment.reconfigure(mode === "preview" ? previews : []),
    });
    const newRange = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollTop = oldRange ? fraction * newRange : Math.min(top, newRange);
    scroll.scrollLeft = left;
    const immediateTop = scroll.scrollTop;
    // Replacements can alter document height during CodeMirror's next layout
    // pass. Restore the same fraction after that pass, unless the reader has
    // already scrolled or toggled again.
    view.requestMeasure({
      key: compartment,
      read: () => ({
        range: Math.max(0, scroll.scrollHeight - scroll.clientHeight),
        top: scroll.scrollTop,
      }),
      write: ({ range, top: measuredTop }) => {
        if (
          revision !== scrollRevision ||
          Math.abs(measuredTop - immediateTop) > 1
        )
          return;
        scroll.scrollTop = oldRange ? fraction * range : Math.min(top, range);
        scroll.scrollLeft = left;
      },
    });
    reflect();
    return mode;
  };

  return Object.freeze({
    get mode() {
      return mode;
    },
    extension(previewExtensions) {
      previews = previewExtensions;
      return [
        // Completion and snippet keys are Prec.highest; ordinary selection
        // Escape must not run before this preview-exit command.
        Prec.high(
          keymap.of([
            {
              key: "Escape",
              run(view) {
                // Nested editors and native form controls keep their own keys.
                if (view.dom.ownerDocument.activeElement !== view.contentDOM)
                  return false;
                if (mode === "source") {
                  toggle(view, true);
                  return true;
                }
                const range = activeSourceRange(view.state);
                if (!range) return false;
                view.dispatch({
                  selection: {
                    anchor: Math.min(range.to, view.state.doc.length),
                  },
                  effects: sourcePreviewExit.of(),
                  scrollIntoView: true,
                });
                return true;
              },
            },
          ]),
        ),
        compartment.of(mode === "preview" ? previews : []),
      ];
    },
    toggle,
    reset() {
      scrollRevision += 1;
      mode = "preview";
      reflect();
    },
    createButton(document, getView, className = "") {
      if (!document?.createElement || typeof getView !== "function")
        throw new TypeError("Source mode button requires a document and view");
      const button = createIconButton(document, {
        label: "Show Markdown source",
        icon: "source",
        className: `aic-source-mode-toggle ${className}`.trim(),
        onActivate: () => {
          const view = getView();
          if (view) toggle(view);
        },
      });
      buttons.add(button);
      reflect();
      return button;
    },
  });
}
