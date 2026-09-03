import { syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
  createLinkControl,
  writeTextToClipboard,
} from "./core/structured-preview.js";
import { providePreviewRanges } from "./core/preview-ranges.js";
import { safeExternalUrl } from "./block-views";

export type MarkdownLink = {
  from: number;
  to: number;
  label: string;
  url: string;
  urlFrom: number;
  urlTo: number;
};

export async function writeLinkToClipboard(
  text: string,
  document: Document,
): Promise<boolean> {
  return writeTextToClipboard(text, document);
}

export function linkRecords(state: EditorState): MarkdownLink[] {
  const records: MarkdownLink[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Link") {
        const url = node.node.getChild("URL");
        const marks = node.node.getChildren("LinkMark");
        if (!url || marks.length < 2 || !marks[0] || !marks[1]) return;
        records.push({
          from: node.from,
          to: node.to,
          label: state.sliceDoc(marks[0].to, marks[1].from),
          url: state.sliceDoc(url.from, url.to),
          urlFrom: url.from,
          urlTo: url.to,
        });
        return false;
      }
      if (node.name === "Autolink") {
        const url = node.node.getChild("URL");
        if (!url) return;
        const value = state.sliceDoc(url.from, url.to);
        records.push({
          from: node.from,
          to: node.to,
          label: value,
          url: value,
          urlFrom: url.from,
          urlTo: url.to,
        });
        return false;
      }
      if (
        node.name === "URL" &&
        !["Link", "Autolink"].includes(node.node.parent?.name ?? "")
      ) {
        const value = state.sliceDoc(node.from, node.to);
        records.push({
          from: node.from,
          to: node.to,
          label: value,
          url: value,
          urlFrom: node.from,
          urlTo: node.to,
        });
      }
    },
  });
  return records;
}

class LinkWidget extends WidgetType {
  constructor(
    private readonly record: MarkdownLink,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: LinkWidget): boolean {
    return (
      other.record.from === this.record.from &&
      other.record.to === this.record.to &&
      other.record.label === this.record.label &&
      other.record.url === this.record.url &&
      other.readOnly === this.readOnly
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const external = safeExternalUrl(this.record.url);
    return createLinkControl(document, {
      label: this.record.label,
      url: this.record.url,
      openable: Boolean(external),
      readOnly: this.readOnly,
      onOpen: () => {
        document.defaultView?.open(external, "_blank", "noopener,noreferrer");
      },
      onCopy: () => writeLinkToClipboard(this.record.url, document),
      onEdit: () => {
        view.dispatch({
          selection: { anchor: this.record.urlFrom, head: this.record.urlTo },
          scrollIntoView: true,
        });
        view.focus();
      },
    });
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function linkActionsExtension(): Extension {
  const build = (state: EditorState) => {
    const decorations = linkRecords(state)
      .filter(
        (record) =>
          !state.selection.ranges.some(
            (range) => range.from <= record.to && range.to >= record.from,
          ),
      )
      .map((record) =>
        Decoration.replace({
          widget: new LinkWidget(record, state.readOnly),
        }).range(record.from, record.to),
      );
    return Decoration.set(decorations, true);
  };
  return StateField.define({
    create: build,
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        transaction.startState.readOnly === transaction.state.readOnly
      )
        return value;
      return build(transaction.state);
    },
    provide: providePreviewRanges,
  });
}
