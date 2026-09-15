import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";
import readme from "../README.md?raw";
import changelog from "../CHANGELOG.md?raw";
import functionalIndex from "../FUNCTIONAL_INDEX.md?raw";
import manifest from "../public/ext.json";
import { parse } from "yaml";

describe("publication metadata", () => {
  it("installs entirely from GitHub Pages", () => {
    expect(readme).toContain(
      "https://ldzyha.github.io/standard-notes-aic/ext.json",
    );
    expect(readme).not.toContain("dzyha.com");
    expect(manifest.url).toBe("https://ldzyha.github.io/standard-notes-aic/");
    expect(manifest.latest_url).toBe(
      "https://ldzyha.github.io/standard-notes-aic/ext.json",
    );
    expect(manifest).not.toHaveProperty("marketing_url");
    expect(readme).toContain('<img src="./public/aic-logo.svg"');
  });

  it("uses dzyha.com only as the release-notes website link", () => {
    expect(releaseWorkflow.match(/https:\/\/dzyha\.com\//gu)).toHaveLength(1);
    expect(releaseWorkflow).toMatch(
      /--notes "[^"\n]*Website: https:\/\/dzyha\.com\/"/u,
    );
  });

  it("serializes duplicate tag deliveries and republishes idempotently", () => {
    expect(releaseWorkflow).toContain("group: release-${{ github.ref }}");
    expect(releaseWorkflow).toContain(
      'gh release view "$RELEASE_TAG" >/dev/null 2>&1',
    );
    expect(releaseWorkflow).toMatch(
      /gh release upload "\$RELEASE_TAG" "\$ASSET" "\$ASSET.sha256" \\\n\s+"\$BROWSER_ASSET" "\$BROWSER_ASSET.sha256" MARKETPLACE_HOWTO.md --clobber/u,
    );
  });

  it("builds and attaches one verified Chrome/Edge ZIP with a checksum and HOWTO", () => {
    const workflow = parse(releaseWorkflow);
    expect(workflow.jobs["test-platforms"].steps).toContainEqual({
      run: "npm run build:browser",
    });
    const steps = workflow.jobs.release.steps;
    const buildIndex = steps.findIndex(
      (step: { run?: string }) => step.run === "npm run build:browser",
    );
    const publishIndex = steps.findIndex(
      (step: { name?: string }) => step.name === "Publish GitHub release",
    );
    expect(buildIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(buildIndex);
    const script = steps[publishIndex].run as string;
    expect(script).toContain(
      'BROWSER_ASSET="dist-browser/artifacts/aic-browser-chromium-$BROWSER_VERSION.zip"',
    );
    expect(
      script.match(
        /"\$BROWSER_ASSET" "\$BROWSER_ASSET.sha256" MARKETPLACE_HOWTO.md/gu,
      ),
    ).toHaveLength(2);
    expect(script).toContain("experimental Chrome/Edge");
    expect(script).not.toMatch(/firefox|mullvad/iu);
  });

  it("documents the current R.F.B release and packages usage and UI contracts", () => {
    expect(changelog).toContain(`## ${manifest.version} — 2026-09-15`);
    expect(changelog).toContain(
      "Release sequence 34 · 3 feature outcomes · 1 fixed-bug outcome",
    );
    expect(readme).toContain("## Slash templates");
    expect(readme).toContain("`Tab` to move through");
    expect(readme).toContain("ordinary `.md` documents");
    expect(readme).toContain("## Preview and source controls");
    expect(readme).toContain(">>>|open| Title");
    expect(readme).toContain("Raw Space is");
    expect(releaseWorkflow).toContain(
      "cp README.md CHANGELOG.md FUNCTIONAL_INDEX.md FEATURES.json COMPONENTS.json UI_ARCHITECTURE.md .release/",
    );
    expect(releaseWorkflow).toContain(
      "package.json README.md CHANGELOG.md FUNCTIONAL_INDEX.md FEATURES.json COMPONENTS.json UI_ARCHITECTURE.md dist",
    );
  });

  it("indexes every release-critical editor contract", () => {
    for (const contract of [
      "working-note UUID",
      "Ctrl/Cmd+S",
      "Only a title ending in `.note.md` receives managed",
      "refuses saves with missing identity, unknown text, a lock or mismatched UUID",
      "Mermaid",
      "Code fences",
      "code-fence-preview",
      "code-fence-extension",
      "slash-snippets",
      "preview-ranges",
      "Tables",
      "Properties",
      "Read-only",
      "Distribution",
    ])
      expect(functionalIndex).toContain(contract);
  });
});
