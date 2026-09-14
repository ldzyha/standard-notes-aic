import type { PageCapture } from "./capture-page";

export interface ImportedPage {
  markdown: string;
  title: string;
  url: string;
  warnings: string[];
}

const MAX_HTML = 2 * 1024 * 1024;
const MAX_NODES = 30_000;
const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "picture",
  "img",
  "video",
  "audio",
  "source",
  "track",
  "input",
  "textarea",
  "select",
  "option",
  "button",
  "form",
  "nav",
  "dialog",
  "menu",
  "search",
  "footer",
]);

function safeUrl(value: string, base: URL | null): string {
  try {
    const url = new URL(value, base ?? undefined);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      return "";
    return url.href
      .replaceAll("(", "%28")
      .replaceAll(")", "%29")
      .replaceAll("<", "%3C")
      .replaceAll(">", "%3E");
  } catch {
    return "";
  }
}

function escapeText(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/[\\`*_{}[\]<>|#+.!()~-]/gu, "\\$&");
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/gu))
    longest = Math.max(longest, match[0].length);
  return longest;
}

function hidden(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  return (
    element.hasAttribute("hidden") ||
    element.hasAttribute("inert") ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
    (element.hasAttribute("contenteditable") &&
      element.getAttribute("contenteditable") !== "false") ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)/iu.test(
      style,
    )
  );
}

export function importCapturedPage(snapshot: PageCapture): ImportedPage {
  if (
    !snapshot ||
    typeof snapshot.html !== "string" ||
    typeof snapshot.title !== "string" ||
    typeof snapshot.url !== "string" ||
    typeof snapshot.truncated !== "boolean" ||
    snapshot.html.length > MAX_HTML ||
    snapshot.title.length > 10_000 ||
    snapshot.url.length > 10_000 ||
    new TextEncoder().encode(snapshot.html).length > MAX_HTML
  ) {
    throw new Error("Page capture is invalid or too large.");
  }
  const warnings: string[] = [];
  if (snapshot.truncated)
    warnings.push("Page content was truncated at the capture limit.");
  const sourceUrl = safeUrl(snapshot.url, null);
  const base = sourceUrl ? new URL(sourceUrl) : null;
  if (!sourceUrl)
    warnings.push(
      "The page URL is unavailable or unsafe; relative links were omitted.",
    );
  // Template contents remain inert: no scripts execute and resource elements
  // are never attached to a live document.
  const template = document.createElement("template");
  template.innerHTML = snapshot.html;
  let nodes = 0;
  let hitLimit = false;
  const counted = new WeakSet<Node>();
  const allowed = (node: Node): boolean => {
    if (!counted.has(node)) {
      if (nodes >= MAX_NODES) {
        hitLimit = true;
        return false;
      }
      counted.add(node);
      nodes += 1;
    }
    return (
      node.nodeType !== Node.ELEMENT_NODE ||
      (!SKIP.has((node as Element).localName.toLowerCase()) &&
        !hidden(node as Element))
    );
  };
  const rawText = (node: Node): string => {
    if (!allowed(node)) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    return Array.from(node.childNodes, rawText).join("");
  };
  const inline = (node: Node): string => {
    if (!allowed(node)) return "";
    if (node.nodeType === Node.TEXT_NODE)
      return escapeText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (tag === "br") return "  \n";
    if (tag === "code") {
      const raw = Array.from(element.childNodes, rawText)
        .join("")
        .replace(/\s+/gu, " ");
      const fence = "`".repeat(Math.max(1, longestBacktickRun(raw) + 1));
      const pad = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
      return `${fence}${pad}${raw}${pad}${fence}`;
    }
    const content = Array.from(element.childNodes, inline).join("");
    if (!content.trim()) return "";
    if (tag === "a") {
      const href = element.getAttribute("href")?.trim();
      const safeHref = href ? safeUrl(href, base) : "";
      return safeHref ? `[${content}](${safeHref})` : content;
    }
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "s" || tag === "del") return `~~${content}~~`;
    return content;
  };
  const pre = (element: Element): string => {
    const raw = Array.from(element.childNodes, rawText)
      .join("")
      .replace(/\r\n?/gu, "\n")
      .replace(/^\n|\n$/gu, "");
    const visibleCode = Array.from(element.querySelectorAll("code")).find(
      (code) => {
        for (
          let parent: Element | null = code;
          parent && parent !== element;
          parent = parent.parentElement
        )
          if (hidden(parent)) return false;
        return true;
      },
    );
    const className =
      visibleCode?.getAttribute("class") ?? element.getAttribute("class") ?? "";
    const language =
      /(?:^|\s)(?:language|lang)-([a-z0-9_+.-]{1,40})(?:\s|$)/iu
        .exec(className)?.[1]
        ?.toLowerCase() ?? "";
    const fence = "`".repeat(Math.max(3, longestBacktickRun(raw) + 1));
    return `${fence}${language}\n${raw}\n${fence}`;
  };
  const table = (element: Element): string => {
    const data: string[][] = [];
    for (const row of element.querySelectorAll("tr")) {
      if (nodes >= MAX_NODES) {
        hitLimit = true;
        break;
      }
      if (row.closest("table") !== element) continue;
      let parent: Element | null = row;
      let concealed = false;
      while (parent && parent !== element) {
        if (hidden(parent)) {
          concealed = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (concealed || !allowed(row)) continue;
      const cells: string[] = [];
      for (const cell of row.children) {
        if (nodes >= MAX_NODES) {
          hitLimit = true;
          break;
        }
        if (cell.localName !== "th" && cell.localName !== "td") continue;
        cells.push(
          inline(cell)
            .replace(/\s*\n\s*/gu, " ")
            .trim(),
        );
      }
      data.push(cells);
    }
    let width = 0;
    for (const row of data) width = Math.max(width, row.length);
    if (!width) return "";
    const line = (cells: string[]) =>
      `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
    return [
      line(data[0] ?? []),
      line(Array.from({ length: width }, () => "---")),
      ...data.slice(1).map(line),
    ].join("\n");
  };
  const list = (element: Element, indent: number): string => {
    if (hidden(element)) return "";
    const ordered = element.localName === "ol";
    let number = ordered
      ? Number(element.getAttribute("start") ?? "1") || 1
      : 1;
    const lines: string[] = [];
    for (const child of element.children) {
      if (child.localName !== "li" || !allowed(child)) continue;
      const marker = ordered ? `${number++}.` : "-";
      const sublists: Element[] = [];
      const content = Array.from(child.childNodes)
        .map((node) => {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            ["ul", "ol"].includes((node as Element).localName)
          ) {
            sublists.push(node as Element);
            return "";
          }
          return inline(node);
        })
        .join("")
        .trim();
      lines.push(`${" ".repeat(indent)}${marker} ${content}`.trimEnd());
      for (const nested of sublists)
        lines.push(list(nested, indent + marker.length + 1));
    }
    return lines.filter(Boolean).join("\n");
  };
  const inlineTags = new Set([
    "a",
    "strong",
    "b",
    "em",
    "i",
    "s",
    "del",
    "code",
    "span",
    "sup",
    "sub",
    "mark",
    "time",
    "br",
  ]);
  const blocks = (children: NodeListOf<ChildNode>): string => {
    const parts: string[] = [];
    const run: Node[] = [];
    const flush = () => {
      const text = run.map(inline).join("").trim();
      if (text) parts.push(text);
      run.length = 0;
    };
    for (const child of children) {
      if (
        child.nodeType === Node.TEXT_NODE ||
        (child.nodeType === Node.ELEMENT_NODE &&
          inlineTags.has((child as Element).localName.toLowerCase()))
      ) {
        run.push(child);
      } else {
        flush();
        const content = block(child);
        if (content) parts.push(content);
      }
    }
    flush();
    return parts.join("\n\n");
  };
  const block = (node: Node): string => {
    if (!allowed(node)) return "";
    if (node.nodeType === Node.TEXT_NODE) return inline(node).trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (tag === "pre") return pre(element);
    if (tag === "table") return table(element);
    if (tag === "ul" || tag === "ol") return list(element, 0);
    if (tag === "hr") return "---";
    if (/^h[1-6]$/u.test(tag))
      return `${"#".repeat(Number(tag[1]))} ${inline(element).trim()}`;
    if (tag === "blockquote") {
      const content = Array.from(element.childNodes, block)
        .filter(Boolean)
        .join("\n\n");
      return content
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    }
    if (
      tag === "p" ||
      tag === "li" ||
      tag === "figcaption" ||
      tag === "dt" ||
      tag === "dd"
    )
      return inline(element).trim();
    if (inlineTags.has(tag)) {
      return inline(element).trim();
    }
    return blocks(element.childNodes);
  };
  const markdown = blocks(template.content.childNodes)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (hitLimit)
    warnings.push(
      "Page content exceeded the import node limit and was truncated.",
    );
  if (!markdown) warnings.push("No importable page content was available.");
  return {
    markdown,
    title: Array.from(snapshot.title, (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
      .join("")
      .trim()
      .slice(0, 500),
    url: sourceUrl,
    warnings,
  };
}
