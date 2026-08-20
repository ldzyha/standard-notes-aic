import { syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { showTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { safeExternalUrl } from "./block-views";

type MarkdownLink = {
  from: number;
  to: number;
  url: string;
  urlFrom: number;
  urlTo: number;
};

export function linkAt(
  state: EditorState,
  position: number,
): MarkdownLink | null {
  let node = syntaxTree(state).resolveInner(position, 0);
  while (node && node.name !== "Link") node = node.parent!;
  if (!node) return null;
  const url = node.getChild("URL");
  return {
    from: node.from,
    to: node.to,
    url: url ? state.sliceDoc(url.from, url.to) : "",
    urlFrom: url?.from ?? node.to - 1,
    urlTo: url?.to ?? node.to - 1,
  };
}

function button(label: string, run: () => void, document: Document) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", run);
  return element;
}

function tooltipFor(link: MarkdownLink): Tooltip {
  return {
    pos: link.from,
    above: true,
    create(view: EditorView) {
      const document = view.dom.ownerDocument;
      const element = document.createElement("div");
      element.className = "cm-md-link-tooltip";
      element.addEventListener("pointerdown", (event) =>
        event.preventDefault(),
      );
      const url = document.createElement("span");
      url.textContent = link.url || "(empty URL)";
      const safeUrl = safeExternalUrl(link.url);
      if (safeUrl) {
        element.append(
          button(
            "Open",
            () =>
              document.defaultView?.open(
                safeUrl,
                "_blank",
                "noopener,noreferrer",
              ),
            document,
          ),
        );
      }
      element.append(
        url,
        button(
          "Edit",
          () => {
            view.dispatch({
              selection: { anchor: link.urlFrom, head: link.urlTo },
              scrollIntoView: true,
            });
            view.focus();
          },
          document,
        ),
        button(
          "Unlink",
          () => {
            if (view.state.readOnly) return;
            const source = view.state.sliceDoc(link.from, link.to);
            const text = /^\[([^\]]*)\]/su.exec(source)?.[1] ?? source;
            view.dispatch({
              changes: { from: link.from, to: link.to, insert: text },
              userEvent: "input",
            });
            view.focus();
          },
          document,
        ),
      );
      return { dom: element };
    },
  };
}

export function linkTooltip(): Extension {
  return StateField.define<MarkdownLink | null>({
    create: () => null,
    update(value, transaction) {
      if (!transaction.selection && !transaction.docChanged) return value;
      return linkAt(transaction.state, transaction.state.selection.main.head);
    },
    provide: (field) =>
      showTooltip.compute([field], (state) => {
        const link = state.field(field);
        return link ? tooltipFor(link) : null;
      }),
  });
}
