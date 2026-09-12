import { describe, expect, it } from "vitest";
import {
  mermaidConfig,
  renderMermaidSvg,
} from "../src/core/mermaid-runtime.js";

describe("Mermaid source directives", () => {
  it("locks source-controlled CSS and HTML/security settings", () => {
    expect(mermaidConfig().secure).toEqual(
      expect.arrayContaining([
        "securityLevel",
        "themeCSS",
        "fontFamily",
        "altFontFamily",
        "htmlLabels",
      ]),
    );
  });
  it.each([
    '%%{init: {"themeCSS": ".node { fill: url(https://attacker.invalid/pixel) !important; }"}}%%\nflowchart LR\n A-->B',
    '%%{init: {"fontFamily": "Arial; background-image:url(https://attacker.invalid/pixel);"}}%%\nflowchart LR\n A-->B',
  ])(
    "blocks source-provided CSS through the actual pinned engine",
    async (source) => {
      const svg = await renderMermaidSvg(document, { source });
      expect(svg).toContain("<svg");
      expect(svg).toContain(">A<");
      expect(svg).not.toContain("attacker.invalid/pixel");
    },
    15_000,
  );
});
