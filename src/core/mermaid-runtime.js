// One renderer/configuration for read previews and inline visual editing.
import { makeMermaidRenderQueue } from "./render-queue.js";
let mermaidPromise;
const renderQueue = makeMermaidRenderQueue();
let renderSerial = 0;

export function mermaidConfig(theme = "default") {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    // Mermaid's default secure list does not protect source-provided themeCSS
    // or fontFamily. Both can inject external CSS resources through %%init%%.
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "themeCSS",
      "fontFamily",
      "altFontFamily",
      "htmlLabels",
    ],
    suppressErrorRendering: true,
    maxTextSize: 50000,
    theme: theme === "dark" ? "dark" : "default",
    htmlLabels: false,
    fontFamily: "Arial, Helvetica, sans-serif",
    themeVariables: {
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: "12px",
    },
    flowchart: {
      useMaxWidth: false,
      htmlLabels: false,
      wrappingWidth: 100,
      padding: 10,
      nodeSpacing: 25,
      rankSpacing: 40,
    },
    sequence: {
      useMaxWidth: false,
      width: 100,
      wrap: true,
      actorMargin: 30,
      actorFontSize: 12,
      messageFontSize: 12,
    },
    class: { useMaxWidth: false },
  };
}

/** Defense in depth for SVG returned by the pinned strict Mermaid renderer.
 * This is not a general-purpose sanitizer for arbitrary SVG or authored CSS. */
export function sanitizeMermaidSvg(svg, document = globalThis.document) {
  const window = document.defaultView;
  const parsed = new window.DOMParser().parseFromString(
    String(svg),
    "image/svg+xml",
  );
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    parsed.querySelector("parsererror")
  )
    throw new Error("Mermaid returned invalid SVG.");
  for (const unsafe of root.querySelectorAll(
    "script,foreignObject,iframe,object,embed",
  ))
    unsafe.remove();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/iu.test(attribute.name) ||
        /^(?:xlink:)?href$/iu.test(attribute.name)
      )
        element.removeAttributeNode(attribute);
    }
  }
  return new window.XMLSerializer().serializeToString(root);
}

export function renderMermaidSvg(
  document,
  { source, theme = "default", signal },
) {
  const aborted = () =>
    new document.defaultView.DOMException(
      "Mermaid render was superseded",
      "AbortError",
    );
  const checkAborted = () => {
    if (signal?.aborted) throw aborted();
  };
  if (signal?.aborted) return Promise.reject(aborted());
  source = String(source);
  if (source.length > 50000)
    return Promise.reject(
      new Error("Mermaid source is limited to 50000 characters."),
    );
  return renderQueue.schedule(
    async () => {
      checkAborted();
      mermaidPromise ??= import("mermaid")
        .then((module) => module.default)
        .catch((error) => {
          mermaidPromise = undefined;
          throw error;
        });
      const mermaid = await mermaidPromise;
      checkAborted();
      // initialize mutates global state: retain the queue through the entire render.
      mermaid.initialize(mermaidConfig(theme));
      const id = `aic-mermaid-${++renderSerial}`;
      try {
        const result = await mermaid.render(id, source);
        // Never invoke source-provided bindFunctions / click callbacks.
        return sanitizeMermaidSvg(result.svg, document);
      } finally {
        document.getElementById(`d${id}`)?.remove();
      }
    },
    { signal },
  );
}
