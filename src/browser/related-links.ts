import { parser } from "@lezer/markdown";
import type { ChangeSpec } from "@codemirror/state";
import type { PageContext } from "./library";
import { displayPageTitle } from "./navigation";

/** Add provenance to the same editor transaction as typing, so save and Undo stay atomic. */
export function relatedPageLink(
  markdown: string,
  page: PageContext,
  noteUrl: string,
): ChangeSpec | null {
  if (page.url === noteUrl) return null;
  let url: URL;
  try {
    url = new URL(page.url);
  } catch {
    return null;
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password)
    return null;
  const target = url.href.replace(/[\s<>\\()]/gu, (value) =>
    encodeURIComponent(value).replaceAll("(", "%28").replaceAll(")", "%29"),
  );
  const tree = parser.parse(markdown);
  let linked = false;
  tree.iterate({
    enter(node) {
      if (
        node.name === "URL" &&
        node.node.parent?.name === "Link" &&
        markdown.slice(node.from, node.to).replace(/^<|>$/gu, "") === target
      )
        linked = true;
    },
  });
  if (linked) return null;
  const title = displayPageTitle(page).replace(/[\\`*_{}[\]<>|#!()]/gu, "\\$&");
  const line = `- [${title}](<${target}>)`;
  let section = false;
  let end = markdown.length;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (section && /^(?:ATX|Setext)Heading[12]$/u.test(node.name)) {
      end = node.from;
      break;
    }
    if (
      node.name === "ATXHeading2" &&
      /^##\s+Related links\s*#*\s*$/iu.test(markdown.slice(node.from, node.to))
    )
      section = true;
  }
  // Keep generated Markdown outside a code fence that is still being typed.
  const last = tree.topNode.lastChild;
  if (
    end === markdown.length &&
    last?.name === "FencedCode" &&
    last.getChildren("CodeMark").length === 1
  )
    end = last.from;
  const before = markdown.slice(0, end);
  const separator =
    !before || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    from: end,
    insert: `${separator}${section ? "" : "## Related links\n\n"}${line}\n${end < markdown.length ? "\n" : ""}`,
  };
}
