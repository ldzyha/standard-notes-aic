import { StateField } from "@codemirror/state";
import { EditorView, showPanel } from "@codemirror/view";
import { notePages } from "./note-pages.js";
import { createIconButton } from "./structured-preview.js";
import { applyUiComponent } from "./ui-system.js";

// Pages are derived from the document and never stored. The bar exists only
// while the note has more than one page; the whole note stays in the editor.
const pagesField = StateField.define({
  create: (state) => notePages(state.doc.toString()),
  update: (pages, transaction) =>
    transaction.docChanged ? notePages(transaction.newDoc.toString()) : pages,
  provide: (field) =>
    showPanel.from(field, (pages) => (pages.length > 1 ? createBar : null)),
});

/** Install outside preview/source compartments so both modes share the bar. */
export function notePagesBar() {
  return pagesField;
}

/** The page holding the caret; a caret on a separator belongs to the page above. */
export function currentNotePage(state) {
  const pages = state.field(pagesField, false) ?? [];
  const head = state.selection.main.head;
  let index = 0;
  for (let next = 1; next < pages.length && pages[next].from <= head; next++)
    index = next;
  return index;
}

/** Move the caret to the start of a page and bring it to the top. */
export function showNotePage(view, index) {
  const page = (view.state.field(pagesField, false) ?? [])[index];
  if (!page) return false;
  view.dispatch({
    selection: { anchor: page.from },
    effects: EditorView.scrollIntoView(page.from, { y: "start" }),
  });
  return true;
}

function createBar(view) {
  const document = view.dom.ownerDocument;
  const dom = applyUiComponent(document.createElement("nav"), "pages");
  dom.setAttribute("aria-label", "Note pages");
  const step = (offset) => () =>
    showNotePage(view, currentNotePage(view.state) + offset);
  const previous = createIconButton(document, {
    label: "Previous page",
    icon: "chevron-left",
    onActivate: step(-1),
  });
  const next = createIconButton(document, {
    label: "Next page",
    icon: "chevron",
    onActivate: step(1),
  });
  const position = applyUiComponent(
    document.createElement("span"),
    "pages",
    [],
    "position",
  );
  const target = applyUiComponent(
    document.createElement("span"),
    "pages",
    [],
    "target",
  );
  dom.append(previous, position, next, target);
  const render = (state) => {
    const pages = state.field(pagesField);
    const index = currentNotePage(state);
    previous.disabled = index === 0;
    next.disabled = index === pages.length - 1;
    position.textContent = `${index + 1} / ${pages.length}`;
    target.textContent = target.title = pages[index].target ?? "";
  };
  render(view.state);
  return {
    dom,
    top: true,
    update: (update) => {
      if (update.docChanged || update.selectionSet) render(update.state);
    },
  };
}
