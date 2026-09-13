import { Compartment } from "@codemirror/state";
import { createIconButton } from "./structured-preview.js";
import { suspendDiagramEditor } from "./diagram-session.js";

export const SOURCE_MODE_CORE_VERSION = "1.0.0";

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

  const toggle = (view) => {
    if (!view || compartment.get(view.state) === undefined) return mode;
    const scroll = view.scrollDOM;
    const top = scroll.scrollTop;
    const left = scroll.scrollLeft;
    const oldRange = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const fraction = oldRange ? top / oldRange : 0;
    const revision = ++scrollRevision;
    mode = mode === "preview" ? "source" : "preview";
    if (mode === "source") suspendDiagramEditor(view, true);
    view.dispatch({
      effects: compartment.reconfigure(mode === "preview" ? previews : []),
    });
    if (mode === "preview") suspendDiagramEditor(view, false);
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
      return compartment.of(mode === "preview" ? previews : []);
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
