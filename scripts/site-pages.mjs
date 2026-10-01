import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GFM, parser } from "@lezer/markdown";

const markdown = parser.configure(GFM);
const ORIGIN = "https://aic.dzyha.com";
const REPOSITORY = "https://github.com/ldzyha/standard-notes-aic/blob/main/";
const MARKERS = {
  "<!-- AIC_BROWSER_PRIVACY -->": "browser/PRIVACY",
  "<!-- AIC_CHANGELOG -->": "CHANGELOG",
};
const ROUTES = {
  "PRIVACY.md": "/terms",
  "PRIVACY.uk.md": "/terms/uk/",
  "CHANGELOG.md": "/releases",
  "CHANGELOG.uk.md": "/releases/uk/",
  "RELEASE_INSTALL.md": "/releases",
  "how-to.md": "/how-to",
  "how-to.uk.md": "/how-to/uk/",
};
const LEGACY_REDIRECTS = [
  ["terms/index.html", "/terms"],
  ["terms/uk/index.html", "/terms/uk/"],
  ["releases/index.html", "/releases"],
  ["releases/uk/index.html", "/releases/uk/"],
  ["how-to/index.html", "/how-to"],
  ["how-to/uk/index.html", "/how-to/uk/"],
];
const MARKUP = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "ListMark",
  "QuoteMark",
  "CodeMark",
  "CodeInfo",
  "TableDelimiter",
  "TaskMarker",
]);

function escape(value) {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function children(node) {
  const result = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    result.push(child);
  return result;
}

function linkTarget(raw, sourcePath) {
  const href = raw.replace(/^<|>$/gu, "").replace(/\\([\\()[\]<>])/gu, "$1");
  if (
    !href ||
    [...href].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    ) ||
    href.includes("\\") ||
    href.startsWith("//")
  )
    return null;
  if (href.startsWith("#")) return href;
  if (href.startsWith("/")) {
    const target = new URL(href, ORIGIN);
    return target.origin === ORIGIN
      ? target.pathname + target.search + target.hash
      : null;
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(href)) {
    try {
      const target = new URL(href);
      if (
        !["https:", "http:", "mailto:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        return null;
      return href;
    } catch {
      return null;
    }
  }
  const [path, fragment = ""] = href.split("#", 2);
  const filename = path.split("/").at(-1);
  if (ROUTES[filename])
    return ROUTES[filename] + (fragment ? `#${fragment}` : "");
  const target = new URL(href, REPOSITORY + sourcePath);
  return target.origin === "https://github.com" &&
    target.pathname.startsWith("/ldzyha/standard-notes-aic/")
    ? target.href
    : null;
}

function renderMarkdown(text, sourcePath, headings, offset = 0) {
  const tree = markdown.parse(text);
  const slice = (node) => text.slice(node.from, node.to);
  const references = new Map();
  const labelKey = (value) =>
    value
      .replace(/^\[|\]$/gu, "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
  for (const node of children(tree.topNode)) {
    if (node.name !== "LinkReference") continue;
    const parts = children(node);
    const label = parts.find((child) => child.name === "LinkLabel");
    const url = parts.find((child) => child.name === "URL");
    if (label && url) references.set(labelKey(slice(label)), slice(url));
  }
  function range(node, from = node.from, to = node.to) {
    let result = "";
    let position = from;
    for (const child of children(node)) {
      if (child.to <= from || child.from >= to) continue;
      result += escape(text.slice(position, Math.max(position, child.from)));
      if (child.from >= from && child.to <= to) result += render(child);
      position = Math.min(to, child.to);
    }
    return result + escape(text.slice(position, to));
  }
  const blocks = (node) =>
    children(node)
      .filter((child) => !MARKUP.has(child.name))
      .map(render)
      .join("\n");
  function render(node) {
    const name = node.name;
    if (MARKUP.has(name) || name === "LinkReference") return "";
    const heading = /^(?:ATX|Setext)Heading([1-6])$/u.exec(name);
    if (heading) {
      const level = Math.min(6, Number(heading[1]) + offset);
      const content = range(node).trim();
      const base =
        slice(node)
          .replace(/^#+\s*|\s*#+$|\n[=-]+\s*$/gu, "")
          .normalize("NFC")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/gu, "-") || "section";
      const count = headings.get(base) || 0;
      headings.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      return `<h${level} id="${escape(id)}">${content}</h${level}>`;
    }
    switch (name) {
      case "Document":
        return blocks(node);
      case "Paragraph":
        return `<p>${range(node)}</p>`;
      case "Emphasis":
        return `<em>${range(node)}</em>`;
      case "StrongEmphasis":
        return `<strong>${range(node)}</strong>`;
      case "Strikethrough":
        return `<del>${range(node)}</del>`;
      case "HardBreak":
        return "<br>";
      case "Escape":
        return escape(slice(node).slice(1));
      case "Entity":
        return escape(slice(node));
      case "InlineCode": {
        const marks = children(node).filter(
          (child) => child.name === "CodeMark",
        );
        let value = text
          .slice(marks[0]?.to ?? node.from, marks.at(-1)?.from ?? node.to)
          .replace(/\r?\n/gu, " ");
        if (/^ .+ $/u.test(value) && /[^ ]/u.test(value))
          value = value.slice(1, -1);
        return `<code>${escape(value)}</code>`;
      }
      case "FencedCode":
      case "CodeBlock": {
        const value = children(node)
          .filter((child) => child.name === "CodeText")
          .map(slice)
          .join("\n");
        return `<pre><code>${escape(value)}</code></pre>`;
      }
      case "BulletList":
        return `<ul>${blocks(node)}</ul>`;
      case "OrderedList": {
        const mark = node.firstChild?.firstChild;
        const start = mark ? Number.parseInt(slice(mark), 10) : 1;
        return `<ol${Number.isSafeInteger(start) && start > 1 ? ` start="${start}"` : ""}>${blocks(node)}</ol>`;
      }
      case "ListItem":
        return `<li>${blocks(node)}</li>`;
      case "Task": {
        const marker = node.firstChild;
        return `<p><span aria-label="${marker && /x/iu.test(slice(marker)) ? "Complete" : "Incomplete"}">${marker && /x/iu.test(slice(marker)) ? "☑" : "☐"}</span> ${range(node).trim()}</p>`;
      }
      case "Blockquote":
        return `<blockquote>${blocks(node)}</blockquote>`;
      case "HorizontalRule":
        return "<hr>";
      case "Table": {
        const nodes = children(node);
        return `<div class="aic-site__table"><table>${nodes
          .filter((child) => child.name === "TableHeader")
          .map(render)
          .join("")}<tbody>${nodes
          .filter((child) => child.name === "TableRow")
          .map(render)
          .join("")}</tbody></table></div>`;
      }
      case "TableHeader":
        return `<thead><tr>${children(node)
          .filter((child) => child.name === "TableCell")
          .map((child) => `<th scope="col">${range(child)}</th>`)
          .join("")}</tr></thead>`;
      case "TableRow":
        return `<tr>${children(node)
          .filter((child) => child.name === "TableCell")
          .map((child) => `<td>${range(child)}</td>`)
          .join("")}</tr>`;
      case "Link":
      case "Image": {
        const nodes = children(node);
        const open = nodes.find((child) => child.name === "LinkMark");
        const close = nodes.find(
          (child) => child.name === "LinkMark" && slice(child) === "]",
        );
        if (!open || !close) return escape(slice(node));
        const content = range(node, open.to, close.from);
        if (name === "Image") return content;
        const url = nodes.find((child) => child.name === "URL");
        const label = nodes.find((child) => child.name === "LinkLabel");
        const raw = url
          ? slice(url)
          : references.get(
              labelKey(label ? slice(label) : text.slice(open.to, close.from)),
            );
        const href = raw && linkTarget(raw, sourcePath);
        return href ? `<a href="${escape(href)}">${content}</a>` : content;
      }
      case "Autolink": {
        const value = children(node).find((child) => child.name === "URL");
        const raw = value ? slice(value) : slice(node).slice(1, -1);
        const href = linkTarget(
          raw.includes(":") ? raw : `mailto:${raw}`,
          sourcePath,
        );
        return href
          ? `<a href="${escape(href)}">${escape(raw)}</a>`
          : escape(raw);
      }
      case "HTMLBlock":
        return `<pre>${escape(slice(node))}</pre>`;
      case "HTMLTag":
        return escape(slice(node));
      default:
        return range(node);
    }
  }
  return render(tree.topNode);
}

const CSS = `:root{color-scheme:light dark;--aic-background:#fff;--aic-foreground:#242424;--aic-border:#d8d8d8;--aic-link:#1760ad;--aic-surface:#f5f5f5;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--aic-background);color:var(--aic-foreground);line-height:1.65}.aic-site{max-width:56rem;margin:auto;padding:1rem}.aic-site__nav{display:flex;flex-wrap:wrap;gap:.35rem 1rem;align-items:center;padding:.5rem 0 1rem;border-bottom:1px solid var(--aic-border)}.aic-site__nav a{display:inline-flex;align-items:center;min-height:44px}.aic-site__content{overflow-wrap:anywhere}.aic-site__content h1,.aic-site__content h2,.aic-site__content h3{line-height:1.25}.aic-site__content h2{margin-top:2rem}.aic-site__table{overflow:auto}a{color:var(--aic-link)}a[aria-current=page]{font-weight:700}a:focus-visible{outline:2px solid var(--aic-link);outline-offset:3px}pre,code{font-family:ui-monospace,monospace;background:var(--aic-surface)}pre{overflow:auto;padding:1rem;white-space:pre-wrap}code{padding:.1rem .25rem}pre code{padding:0}table{border-collapse:collapse;min-width:100%;font-size:.95rem}th,td{border:1px solid var(--aic-border);padding:.4rem .6rem;text-align:left}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid var(--aic-border)}hr{border:0;border-top:1px solid var(--aic-border)}@media(prefers-color-scheme:dark){:root{--aic-background:#171717;--aic-foreground:#eee;--aic-border:#4b4b4b;--aic-link:#8bbfff;--aic-surface:#252525}}@media(max-width:600px){.aic-site{padding:.75rem}.aic-site__nav{gap:.25rem .75rem}}`;

/** Build inert public documents; the PWA host owns caching and deployment. */
export async function buildPublicPages(root) {
  const pages = new Map([["site.css", CSS]]);
  for (const page of ["terms", "releases", "how-to"]) {
    for (const locale of ["en", "uk"]) {
      const suffix = locale === "uk" ? ".uk" : "";
      const sourcePath = `pwa/${page}${suffix}.md`;
      const source = await readFile(resolve(root, sourcePath), "utf8");
      const headings = new Map();
      const parts = source.split(
        /(<!-- AIC_BROWSER_PRIVACY -->|<!-- AIC_CHANGELOG -->)/gu,
      );
      const rendered = [];
      for (const part of parts) {
        if (!MARKERS[part])
          rendered.push(renderMarkdown(part, sourcePath, headings));
        else {
          const injectedPath = `${MARKERS[part]}${suffix}.md`;
          const injected = await readFile(resolve(root, injectedPath), "utf8");
          rendered.push(renderMarkdown(injected, injectedPath, headings, 2));
        }
      }
      const path = `/${page}${locale === "uk" ? "/uk/" : ""}`;
      const alternate = `/${page}${locale === "en" ? "/uk/" : ""}`;
      const title = source.match(/^#\s+(.+)$/mu)?.[1] || page;
      const labels =
        locale === "uk"
          ? [
              "AIC Notes",
              "Умови й приватність",
              "Випуски та встановлення",
              "Як створювати документи",
              "English",
            ]
          : [
              "AIC Notes",
              "Terms and privacy",
              "Releases and installation",
              "How to",
              "Українська",
            ];
      const nav = [
        ["/", labels[0]],
        [locale === "uk" ? "/terms/uk/" : "/terms", labels[1]],
        [locale === "uk" ? "/releases/uk/" : "/releases", labels[2]],
        [locale === "uk" ? "/how-to/uk/" : "/how-to", labels[3]],
      ]
        .map(
          ([href, label]) =>
            `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${label}</a>`,
        )
        .join("\n");
      pages.set(
        `${page}/${locale === "uk" ? "uk/" : ""}index.html`,
        `<!doctype html>\n<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} · AIC</title><link rel="canonical" href="${ORIGIN}${path}"><link rel="alternate" hreflang="${locale === "en" ? "uk" : "en"}" href="${ORIGIN}${alternate}"><link rel="stylesheet" href="/site.css"></head><body><div class="aic-site"><nav class="aic-site__nav" aria-label="${locale === "uk" ? "Сторінки AIC" : "AIC pages"}">${nav}<a href="${alternate}" hreflang="${locale === "en" ? "uk" : "en"}">${labels[4]}</a></nav><main class="aic-site__content">${rendered.join("\n")}</main></div></body></html>\n`,
      );
    }
  }
  return pages;
}

/**
 * GitHub Pages hosts the Standard Notes editor and its `ext.json` manifest.
 * Its old documentation paths must lead to the public AIC site instead of
 * presenting a second privacy or release surface.
 */
export function buildGitHubLegacyRedirects() {
  return new Map(
    LEGACY_REDIRECTS.map(([fileName, path]) => {
      const target = `${ORIGIN}${path}`;
      const locale = path.includes("/uk/") ? "uk" : "en";
      const title = locale === "uk" ? "Перехід до AIC" : "Redirecting to AIC";
      const link =
        locale === "uk" ? "Відкрити сторінку AIC" : "Open the AIC page";
      return [
        fileName,
        `<!doctype html>\n<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="${target}"><title>${title}</title></head><body><p><a href="${target}">${link}</a></p></body></html>\n`,
      ];
    }),
  );
}
