export type MermaidTheme = "dark" | "default";
export function mermaidConfig(
  theme?: MermaidTheme,
): import("mermaid").MermaidConfig;
export function sanitizeMermaidSvg(svg: string, document?: Document): string;
export function renderMermaidSvg(
  document: Document,
  options: { source: string; theme?: MermaidTheme; signal?: AbortSignal },
): Promise<string>;
