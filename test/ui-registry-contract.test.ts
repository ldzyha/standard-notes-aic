import { describe, expect, it } from "vitest";
import { readFile, readdir, access } from "node:fs/promises";
import * as path from "node:path";
import { cwd } from "node:process";
import { UI_COMPONENTS } from "../src/core/ui-system.js";

const root = cwd();
const workspace = path.resolve(root, "..");
const read = (name: string) => readFile(path.join(root, name), "utf8");
const exists = (name: string) =>
  access(name).then(
    () => true,
    () => false,
  );

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(name)));
    else if (/\.(?:ts|js|css)$/u.test(entry.name)) result.push(name);
  }
  return result;
}

describe("shared design and feature registry contract", () => {
  it("gives Field, Row and Section distinct registered icons", async () => {
    const css = await read("src/core/icons.css");
    const masks = ["add-property", "add-row", "add-section"].map((name) => {
      const rule = css.match(
        new RegExp(`\\[data-aic-icon="${name}"\\] \\{([^}]+)\\}`, "u"),
      );
      expect(rule, `Missing ${name} icon`).not.toBeNull();
      expect(rule![1]).toContain("--aic-icon:");
      return rule![1]!.trim();
    });
    expect(new Set(masks).size).toBe(3);
  });

  it("requires a feature owner for every runtime source file", async () => {
    const registry = JSON.parse(await read("FEATURES.json"));
    const ids = registry.features.map((feature: { id: string }) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    const registered = new Set<string>(
      registry.features.flatMap(
        (feature: { sourceFiles: string[] }) => feature.sourceFiles,
      ),
    );
    for (const prefix of Object.values(registry.sourceRoots) as string[]) {
      const directory = path.join(workspace, prefix);
      // Standalone CI checkout has no VS Code sibling. Its snapshot is verified
      // separately; joint local/release checks validate the complete inventory.
      if (!(await exists(directory))) {
        expect(prefix.startsWith("aic-notes/")).toBe(true);
        continue;
      }
      for (const name of await sourceFiles(directory)) {
        const relative = path.relative(workspace, name).replaceAll("\\", "/");
        expect(
          registered.has(relative),
          `Unregistered source: ${relative}`,
        ).toBe(true);
      }
    }
  });

  it("keeps source, entrypoint and verification references real and scoped", async () => {
    const registry = JSON.parse(await read("FEATURES.json"));
    const hasVscode = await exists(path.join(workspace, "aic-notes"));
    for (const feature of registry.features) {
      expect(feature.purpose.trim()).not.toBe("");
      expect(feature.verification.length).toBeGreaterThan(0);
      const references = [
        ...feature.canonicalOwners,
        ...feature.sourceFiles,
        ...feature.entrypoints,
        ...feature.verification,
      ] as string[];
      for (const name of references) {
        expect(name).toMatch(
          /^(?:standard-notes-aic|aic-notes)\/[a-zA-Z0-9_./-]+$/u,
        );
        expect(name.split("/")).not.toContain("..");
        if (!hasVscode && name.startsWith("aic-notes/")) continue;
        expect(
          await exists(path.join(workspace, name)),
          `${feature.id}: ${name}`,
        ).toBe(true);
      }
    }
  });

  it("keeps documented BEM elements/modifiers identical to the runtime registry", async () => {
    const registry = JSON.parse(await read("COMPONENTS.json"));
    expect(
      registry.components.map((item: { id: string }) => item.id).sort(),
    ).toEqual(Object.keys(UI_COMPONENTS).sort());
    for (const component of registry.components) {
      const actual = UI_COMPONENTS[component.id as keyof typeof UI_COMPONENTS];
      expect(component.bem.block).toBe(`aic-${component.id}`);
      expect([...component.bem.elements].sort()).toEqual(
        [...actual.elements].sort(),
      );
      expect([...component.bem.modifiers].sort()).toEqual(
        [...actual.modifiers].sort(),
      );
      expect(component.canonicalOwners).toContain(
        "standard-notes-aic/src/core/ui-system.js",
      );
    }
  });

  it("loads shared UI in every host and does not restore copied preview shells", async () => {
    const inventory: string[] = JSON.parse(await read("CORE_FILES.json"));
    for (const file of ["ui-system.js", "ui-system.d.ts", "ui-system.css"])
      expect(inventory).toContain(file);
    for (const file of ["src/main.ts", "src/browser/main.ts"])
      expect(await read(file)).toContain("core/ui-system.css");
    const hostStyles = [await read("src/styles.css")];
    if (await exists(path.join(workspace, "aic-notes/src/webview/main.js"))) {
      expect(
        await readFile(
          path.join(workspace, "aic-notes/src/webview/main.js"),
          "utf8",
        ),
      ).toContain("UI_SYSTEM_CSS");
      hostStyles.push(
        await readFile(
          path.join(workspace, "aic-notes/src/webview/theme.css"),
          "utf8",
        ),
      );
    }
    for (const css of hostStyles) {
      expect(css).not.toMatch(/\.cm-md-preview-header\s*\{/u);
      expect(css).not.toMatch(/\.cm-md-code-preview\s*>\s*pre\s*\{/u);
    }
    expect(await read("src/core/preview-layout.css")).toContain(
      ".aic-card__header",
    );
  });
});
