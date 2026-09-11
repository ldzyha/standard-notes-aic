import { StateEffect } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { ViewPlugin, WidgetType } from "@codemirror/view";
import { createDiagramBuilder } from "./diagram-builder.js";
import {
  createIconButton,
  showIconFeedback,
  writeTextToClipboard,
} from "./structured-preview.js";

const sessions = new WeakMap();

// Mapping keeps an inline draft stable when prose outside its block changes.
// A document identity boundary still retires the old session permanently.
const lifecycle = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
    }
    update(update) {
      sessions.get(this.view)?.update(update);
    }
    destroy() {
      sessions.get(this.view)?.retire();
    }
  },
);

function scheduleReattach(view) {
  Promise.resolve().then(() => sessions.get(view)?.reattach());
}

export function registerDiagramEditorHost(view, container, { from, to }) {
  container.dataset.aicDiagramFrom = String(from);
  container.dataset.aicDiagramTo = String(to);
  scheduleReattach(view);
}

export function releaseDiagramEditorHost(view) {
  scheduleReattach(view);
}

export function closeDiagramEditor(view, container) {
  const session = sessions.get(view);
  if (session && (!container || session.container === container))
    session.close(false);
}

export function openDiagramEditor(
  view,
  { from, to },
  { container, theme = "default", hideElements = [], onCopy } = {},
) {
  if (
    view.state.readOnly ||
    !container?.isConnected ||
    !view.dom.contains(container) ||
    from < 0 ||
    to < from ||
    to > view.state.doc.length
  )
    return null;
  const previousSession = sessions.get(view);
  if (previousSession) {
    previousSession.reattach();
    previousSession.focus();
    return previousSession.controller;
  }
  if (!view.plugin(lifecycle))
    view.dispatch({ effects: StateEffect.appendConfig.of(lifecycle) });
  let originalDocument = view.state.doc;
  const source = view.state.sliceDoc(from, to);
  const document = view.dom.ownerDocument;
  const previousFocus = document.activeElement;
  const element = document.createElement("div");
  element.className = "cm-aic-diagram-inline";
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "Diagram editor");
  let hiddenPreviews = [];
  let closed = false;
  let stale = false;
  let recoverySource = source;
  let recoveryHost;
  let pendingFocus;
  let controller;
  const notice = document.createElement("div");
  notice.className = "cm-aic-diagram-stale-notice";
  notice.hidden = true;
  notice.setAttribute("role", "status");
  const noticeText = document.createElement("span");
  notice.append(
    noticeText,
    createIconButton(document, {
      label: "Copy retained diagram draft",
      icon: "copy",
      onActivate: async (button) => {
        try {
          const copied = onCopy
            ? (await onCopy(getSource())) !== false
            : await writeTextToClipboard(getSource(), document);
          if (copied)
            showIconFeedback(button, {
              restoreLabel: "Copy retained diagram draft",
            });
        } catch {
          /* Clipboard failure must not alter or discard the retained draft. */
        }
      },
    }),
  );
  const getSource = () =>
    closed ? recoverySource : (controller?.getSource?.() ?? source);
  const restorePreviews = () => {
    container.classList.remove("cm-aic-diagram-inline-active");
    for (const preview of hiddenPreviews)
      preview.element.hidden = preview.hidden;
    hiddenPreviews = [];
  };
  const attach = (nextContainer) => {
    const focused = element.contains(document.activeElement)
      ? document.activeElement
      : pendingFocus;
    pendingFocus = null;
    restorePreviews();
    container = nextContainer;
    const related = container.classList.contains(
      "cm-aic-diagram-source-actions",
    )
      ? [...view.dom.querySelectorAll("[data-aic-diagram-live-from]")].filter(
          (preview) => preview.dataset.aicDiagramLiveFrom === String(from),
        )
      : hideElements;
    hiddenPreviews = [...related]
      .filter(
        (other) =>
          other !== container && other?.isConnected && view.dom.contains(other),
      )
      .map((other) => ({ element: other, hidden: other.hidden }));
    for (const preview of hiddenPreviews) preview.element.hidden = true;
    container.classList.add("cm-aic-diagram-inline-active");
    container.append(element);
    if (focused?.isConnected) focused.focus();
    view.requestMeasure();
  };
  const invalidate = (message) => {
    stale = true;
    noticeText.textContent = message;
    notice.hidden = false;
    controller?.setApplyBlocked?.(message);
  };
  const reattach = () => {
    if (closed) return;
    const replacement = [
      ...view.dom.querySelectorAll("[data-aic-diagram-from]"),
    ].find(
      (host) =>
        host.dataset.aicDiagramFrom === String(from) &&
        host.dataset.aicDiagramTo === String(to),
    );
    if (replacement && replacement !== container) attach(replacement);
    else if (!container.isConnected && stale && view.dom.isConnected) {
      recoveryHost ??= document.createElement("div");
      recoveryHost.className = "cm-aic-diagram-recovery";
      view.dom.append(recoveryHost);
      attach(recoveryHost);
    }
  };
  const close = (restoreFocus = true) => {
    if (closed) return;
    recoverySource = getSource();
    closed = true;
    sessions.delete(view);
    controller?.destroy();
    element.remove();
    restorePreviews();
    recoveryHost?.remove();
    view.requestMeasure();
    if (restoreFocus) {
      if (
        previousFocus?.isConnected &&
        typeof previousFocus.focus === "function"
      )
        previousFocus.focus();
      else if (view.dom.isConnected) view.focus();
    }
  };
  const commit = (next) => {
    if (
      closed ||
      stale ||
      view.state.readOnly ||
      !container.isConnected ||
      view.state.doc !== originalDocument ||
      view.state.sliceDoc(from, to) !== source
    )
      return false;
    // No change is still a successful Apply, but does not create Undo/dirty.
    close(false);
    const insert =
      source.endsWith("\n") && !next.endsWith("\n") ? `${next}\n` : next;
    if (insert !== source)
      view.dispatch({
        changes: { from, to, insert },
        userEvent: "input.diagram",
        annotations: isolateHistory.of("full"),
      });
    view.focus();
    return true;
  };
  controller = createDiagramBuilder(document, {
    source,
    theme,
    onCopy: onCopy
      ? async (text) => {
          try {
            return (await onCopy(text)) !== false;
          } catch {
            return false;
          }
        }
      : undefined,
    onRender: () => {
      if (!closed) view.requestMeasure();
    },
    onApply: commit,
    onClose: () => close(),
  });
  element.append(notice, controller.element);
  registerDiagramEditorHost(view, container, { from, to });
  attach(container);
  const sessionController = {
    element,
    close,
    getSource,
    apply: () => !closed && !stale && controller.apply(),
  };
  sessions.set(view, {
    close,
    controller: sessionController,
    focus: () => {
      if (!element.isConnected && !stale)
        view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      Promise.resolve().then(() => {
        if (!closed) {
          reattach();
          controller.element.focus();
        }
      });
    },
    get container() {
      return container;
    },
    reattach,
    retire: () => close(false),
    update(update) {
      pendingFocus = element.contains(document.activeElement)
        ? document.activeElement
        : null;
      if (update.docChanged) {
        let overlaps = false;
        update.changes.iterChangedRanges((changedFrom, changedTo) => {
          if (
            (changedFrom < to && changedTo > from) ||
            (changedFrom === changedTo &&
              changedFrom >= from &&
              changedFrom <= to)
          )
            overlaps = true;
        });
        from = update.changes.mapPos(from, 1);
        to = Math.max(from, update.changes.mapPos(to, -1));
        if (overlaps || update.state.sliceDoc(from, to) !== source)
          invalidate(
            "This diagram changed elsewhere. Copy the retained draft or cancel; Apply is disabled.",
          );
        else originalDocument = update.state.doc;
      }
      if (update.state.readOnly)
        invalidate(
          "This note is read-only. Copy the retained draft or cancel; Apply is disabled.",
        );
      scheduleReattach(view);
    },
  });
  element.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      event.stopPropagation();
      if (stale || !controller.apply()) return;
      // Apply to the local draft first, then preserve the host's existing
      // explicit-save shortcut. No persistence path is duplicated here.
      view.contentDOM.dispatchEvent(
        new document.defaultView.KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    true,
  );
  // Child editors own their first Escape (connection cancel / Tab escape).
  // Close only an unhandled Escape after those local key handlers run.
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  view.requestMeasure();
  controller.element.focus();
  return sessionController;
}

export function createDiagramEditButton(view, range, options = {}) {
  const source = view.state.sliceDoc(range.from, range.to);
  return createIconButton(view.dom.ownerDocument, {
    label: "Edit diagram visually",
    icon: "diagram",
    className: "cm-md-edit-source cm-aic-diagram-edit",
    disabled: view.state.readOnly,
    onActivate: (button) => {
      if (
        !button.isConnected ||
        !view.dom.isConnected ||
        range.to > view.state.doc.length ||
        view.state.sliceDoc(range.from, range.to) !== source
      )
        return;
      openDiagramEditor(
        view,
        range,
        typeof options === "function" ? options() : options,
      );
    },
  });
}

function diagramLabel(source) {
  const declaration = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));
  if (/^(?:flowchart|graph)\b/iu.test(declaration || "")) return "Flowchart";
  if (/^sequenceDiagram\b/iu.test(declaration || "")) return "Sequence";
  if (/^classDiagram\b/iu.test(declaration || "")) return "Class diagram";
  return "Mermaid";
}

// Source remains ordinary editable Markdown. This adds only a measured action
// row before the fence, so entering a snippet field never hides the builder.
export class DiagramSourceActionsWidget extends WidgetType {
  constructor({
    from,
    to,
    source,
    readOnly = false,
    theme = "default",
    onCopy,
  }) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.readOnly = readOnly;
    this.theme = theme;
    this.onCopy = onCopy;
  }

  eq(other) {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.source === other.source &&
      this.theme === other.theme &&
      this.onCopy === other.onCopy &&
      this.readOnly === other.readOnly
    );
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const element = document.createElement("div");
    element.className = "cm-aic-diagram-source-actions";
    const toolbar = document.createElement("div");
    toolbar.className = "cm-aic-diagram-source-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Mermaid source actions");
    const label = document.createElement("span");
    label.className = "cm-aic-diagram-source-label";
    label.textContent = `${diagramLabel(this.source)} · source`;
    toolbar.append(
      label,
      createDiagramEditButton(view, { from: this.from, to: this.to }, () => ({
        container: element,
        theme: this.theme,
        onCopy: this.onCopy,
        hideElements: [
          ...view.dom.querySelectorAll("[data-aic-diagram-live-from]"),
        ].filter(
          (preview) => preview.dataset.aicDiagramLiveFrom === String(this.from),
        ),
      })),
    );
    element.append(toolbar);
    element.__aicDiagramView = view;
    registerDiagramEditorHost(view, element, { from: this.from, to: this.to });
    return element;
  }

  destroy(element) {
    releaseDiagramEditorHost(element.__aicDiagramView);
  }

  ignoreEvent() {
    return true;
  }
}
