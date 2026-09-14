// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function inspectNotices() {
  const probe = String.raw`
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { pathToFileURL } from "node:url";
    const { generateNotices, productionPackages } = await import(
      pathToFileURL(resolve("scripts/generate-third-party-notices.mjs"))
    );
    const generated = await generateNotices();
    const committed = await readFile("public/THIRD_PARTY_NOTICES.md", "utf8");
    const retained = [];
    for (const source of [
      "node_modules/@codemirror/view/LICENSE",
      "node_modules/mermaid/LICENSE",
      "node_modules/es-toolkit/NOTICE",
      "node_modules/jsqr/LICENSE",
    ]) {
      const text = await readFile(source, "utf8");
      retained.push(generated.includes(text.replace(/\r\n?/g, "\n").replace(/[\t ]+$/gm, "").trimEnd()));
    }
    console.log(JSON.stringify({
      matches: committed.replace(/\r\n?/g, "\n") === generated,
      retained,
      embedded: ["langium@4.2.1", "chevrotain@11.1.2", "vscode-languageserver-protocol@3.17.5"]
        .every(id => generated.includes("## " + id)),
      pathCopyright: generated.includes("Copyright Joyent, Inc. and other Node contributors."),
      missingCopyrightDisclosure: generated.includes("no copyright holder or year"),
      includesDevOnly: /^## (?:vitest|vite|eslint|jsdom)@/m.test(generated),
      production: productionPackages({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/runtime": { version: "1.0.0" },
          "node_modules/test-only": { version: "1.0.0", dev: true },
          "node_modules/runtime/node_modules/runtime": { version: "0.9.0" },
        },
      }).map(([path]) => path),
    }));
  `;
  return JSON.parse(
    execFileSync(
      (globalThis as unknown as { process: { execPath: string } }).process
        .execPath,
      ["--input-type=module", "-e", probe],
      { encoding: "utf8" },
    ),
  );
}

describe("release third-party notices", () => {
  it("preserve copyright and complete license text for locked and prebundled runtime dependencies", () => {
    const result = inspectNotices();
    expect(result.matches).toBe(true);
    expect(result.retained).toEqual([true, true, true, true]);
    expect(result.embedded).toBe(true);
    expect(result.pathCopyright).toBe(true);
    expect(result.missingCopyrightDisclosure).toBe(true);
    expect(result.includesDevOnly).toBe(false);
    expect(result.production).toEqual([
      "node_modules/runtime",
      "node_modules/runtime/node_modules/runtime",
    ]);
  });
});
