export type PageCaptureMode = "page" | "selection";

export interface PageCapture {
  html: string;
  title: string;
  url: string;
  truncated: boolean;
}

/** Inject this function itself as chrome.scripting.executeScript's `func`. */
export function capturePage(mode: PageCaptureMode): PageCapture {
  // Keep every runtime dependency inside this function: Chrome serializes `func`.
  const MAX_NODES = 30_000;
  const MAX_HTML = 2 * 1024 * 1024;
  const MAX_DEPTH = 80;
  const excluded = new Set([
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
  const semantic = new Set([
    "article",
    "section",
    "main",
    "div",
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "strong",
    "b",
    "em",
    "i",
    "s",
    "del",
    "a",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "figure",
    "figcaption",
    "dl",
    "dt",
    "dd",
    "span",
    "sup",
    "sub",
    "mark",
    "time",
    "details",
    "summary",
  ]);
  const selection = mode === "selection" ? window.getSelection() : null;
  if (mode !== "page" && mode !== "selection") {
    throw new Error("Unsupported page capture mode.");
  }
  if (
    mode === "selection" &&
    (!selection || selection.isCollapsed || selection.rangeCount === 0)
  ) {
    throw new Error("Select visible page content before importing.");
  }
  const ranges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!range.collapsed) ranges.push(range);
    }
  }
  const isHidden = (element: Element): boolean => {
    if (
      element.hasAttribute("hidden") ||
      element.hasAttribute("inert") ||
      element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
      (element.getAttribute("contenteditable")?.toLowerCase() !== undefined &&
        element.getAttribute("contenteditable")?.toLowerCase() !== "false")
    )
      return true;
    const style = window.getComputedStyle(element);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      style.opacity === "0"
    );
  };
  const visibleCandidate = (element: Element | null): element is Element => {
    if (!element) return false;
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      if (
        isHidden(parent) ||
        excluded.has(parent.localName.toLowerCase()) ||
        parent.getAttribute("role") === "navigation" ||
        (parent.localName === "details" &&
          !parent.hasAttribute("open") &&
          !parent.querySelector(":scope > summary")?.contains(element))
      )
        return false;
    }
    return true;
  };
  let root: Element | null = document.body;
  if (mode === "page") {
    const candidates = [
      document.querySelector("main"),
      document.querySelector("[role='main']"),
      document.querySelector("article"),
    ].filter(visibleCandidate);
    // A layout's first <main> can contain only controls or hidden text while
    // the readable article sits beside it. Score only content we can import.
    const visibleTextLength = (candidate: Element): number => {
      let length = 0;
      let visited = 0;
      const pending: Node[] = [candidate];
      while (pending.length && visited < MAX_NODES && length < 80) {
        const node = pending.pop()!;
        visited += 1;
        if (node.nodeType === Node.TEXT_NODE) {
          length += node.textContent?.trim().length ?? 0;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            excluded.has(element.localName.toLowerCase()) ||
            isHidden(element) ||
            element.getAttribute("role") === "navigation"
          )
            continue;
          const children =
            element.localName === "details" && !element.hasAttribute("open")
              ? [element.querySelector(":scope > summary")].filter(
                  (child): child is Element => child !== null,
                )
              : element.childNodes;
          for (let index = children.length - 1; index >= 0; index -= 1)
            pending.push(children[index]!);
        }
      }
      return length;
    };
    const scored = candidates.map((candidate) => ({
      candidate,
      length: visibleTextLength(candidate),
    }));
    // Prefer substantive main content, then any readable candidate, then body.
    root =
      scored.find(({ length }) => length >= 80)?.candidate ??
      scored.find(({ length }) => length > 0)?.candidate ??
      document.body;
  }
  if (!root) throw new Error("Page content is unavailable.");

  const output = document.createElement("div");
  let seen = 0;
  // Six characters per source character is an upper bound for HTML escaping.
  let remainingHtml = MAX_HTML;
  let truncated = false;
  const intersectsSelection = (node: Node): boolean => {
    if (mode === "page") return true;
    return ranges.some((range) => {
      try {
        return range.intersectsNode(node);
      } catch {
        return false;
      }
    });
  };
  const selectedText = (node: Text): string => {
    if (mode === "page") return node.data;
    let result = "";
    for (const range of ranges) {
      if (!range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end =
        range.endContainer === node ? range.endOffset : node.data.length;
      if (end > start) result += node.data.slice(start, end);
    }
    return result;
  };
  const clone = (source: Node, destination: Node, depth: number): void => {
    if (seen >= MAX_NODES || depth > MAX_DEPTH || remainingHtml <= 0) {
      truncated = true;
      return;
    }
    seen += 1;
    if (!intersectsSelection(source)) return;
    if (source.nodeType === Node.TEXT_NODE) {
      const value = selectedText(source as Text);
      if (!value) return;
      const limited = value.slice(0, Math.floor(remainingHtml / 6));
      remainingHtml -= limited.length * 6;
      if (limited.length < value.length) truncated = true;
      destination.appendChild(document.createTextNode(limited));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return;
    const element = source as Element;
    const tag = element.localName.toLowerCase();
    if (
      excluded.has(tag) ||
      isHidden(element) ||
      element.getAttribute("role") === "navigation"
    )
      return;
    const target = semantic.has(tag)
      ? document.createElement(tag)
      : document.createElement("span");
    if (tag === "a") {
      const href = element.getAttribute("href");
      if (href && href.length <= 2048) target.setAttribute("href", href);
    }
    if (tag === "ol") {
      const start = element.getAttribute("start");
      if (start && /^\d{1,6}$/u.test(start))
        target.setAttribute("start", start);
    }
    if (tag === "th" || tag === "td") {
      const colspan = element.getAttribute("colspan");
      if (colspan && /^\d{1,2}$/u.test(colspan))
        target.setAttribute("colspan", colspan);
    }
    if (tag === "code" || tag === "pre") {
      const match =
        /(?:^|\s)(?:language|lang)-([a-z0-9_+.-]{1,40})(?:\s|$)/iu.exec(
          element.getAttribute("class") ?? "",
        );
      if (match)
        target.setAttribute("class", `language-${match[1]!.toLowerCase()}`);
    }
    const requiredHtml = target.outerHTML.length;
    if (requiredHtml > remainingHtml) {
      truncated = true;
      return;
    }
    remainingHtml -= requiredHtml;
    destination.appendChild(target);
    const children =
      tag === "details" && !element.hasAttribute("open")
        ? [element.querySelector(":scope > summary")].filter(
            (child): child is Element => child !== null,
          )
        : element.childNodes;
    for (const child of children) {
      clone(child, target, depth + 1);
      if (truncated && (seen >= MAX_NODES || remainingHtml <= 0)) break;
    }
    if (!target.hasChildNodes() && tag !== "br" && tag !== "hr")
      destination.removeChild(target);
  };
  clone(root, output, 0);
  const html = output.innerHTML;
  if (mode === "selection" && !output.textContent?.trim()) {
    throw new Error("The selection has no visible importable text.");
  }
  return {
    html,
    title: document.title.slice(0, 500),
    // The service validates the complete URL against its bounded active-page
    // context. Truncating a supported URL would look like a navigation race.
    url: location.href,
    truncated,
  };
}
