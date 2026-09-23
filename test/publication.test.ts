import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";
import readme from "../README.md?raw";
import changelog from "../CHANGELOG.md?raw";
import functionalIndex from "../FUNCTIONAL_INDEX.md?raw";
import marketplaceHowto from "../MARKETPLACE_HOWTO.md?raw";
import releaseInstall from "../RELEASE_INSTALL.md?raw";
import browserManifest from "../browser/manifest.json";
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

  it("uses the unified installation guide as the public release notes", () => {
    expect(releaseInstall).toContain("https://dzyha.com/");
    expect(releaseInstall).toContain("aic-notes-50.1.0.vsix");
    expect(releaseInstall).toContain("aic-browser-chromium-0.7.0.zip");
    expect(releaseInstall).toContain("## English");
    expect(releaseInstall).toContain("## Українська");
    expect(releaseWorkflow).toContain("--notes-file RELEASE_INSTALL.md");
  });

  it("serializes duplicate tag deliveries and republishes idempotently", () => {
    expect(releaseWorkflow).toContain("group: release-${{ github.ref }}");
    expect(releaseWorkflow).toContain(
      'gh release view "$RELEASE_TAG" >/dev/null 2>&1',
    );
    expect(releaseWorkflow).toMatch(
      /gh release upload "\$RELEASE_TAG" "\$ASSET" "\$ASSET.sha256" \\\n\s+"\$BROWSER_ASSET" "\$BROWSER_ASSET.sha256" RELEASE_INSTALL.md MARKETPLACE_HOWTO.md --clobber/u,
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
        /"\$BROWSER_ASSET" "\$BROWSER_ASSET.sha256" RELEASE_INSTALL.md MARKETPLACE_HOWTO.md/gu,
      ),
    ).toHaveLength(2);
    expect(releaseInstall).toContain("експериментальне розширення Chrome/Edge");
    expect(script).not.toMatch(/firefox|mullvad/iu);
  });

  it("documents the current R.F.B release and packages usage and UI contracts", () => {
    expect(manifest.version).toBe("42.1.0");
    expect(browserManifest.version).toBe("0.7.0");
    expect(changelog).toContain(`## ${manifest.version} — 2026-09-23`);
    expect(changelog).toContain(
      "Release sequence 40 · 0 feature outcomes · 1 fixed-bug outcome",
    );
    expect(changelog).toContain(
      "An unfinished fenced code block stays editable",
    );
    expect(marketplaceHowto).toContain("aic-browser-chromium-0.7.0.zip");
    expect(marketplaceHowto).toContain("Standard Notes AIC **42.1.0**");
    expect(marketplaceHowto).toContain("## English");
    expect(marketplaceHowto).toContain("## Українська");
    expect(readme).toContain("## Slash templates");
    expect(readme).toContain("`Tab` to move through");
    expect(readme).toContain("ordinary `.md` documents");
    expect(readme).toContain("## Preview and source controls");
    expect(readme).toContain(">>>|open| Title");
    expect(readme).toContain("Raw Space is");
    expect(releaseWorkflow).toContain(
      "README.uk.md RELEASE_INSTALL.md MARKETPLACE_HOWTO.md DOCUMENTATION.md",
    );
    expect(releaseWorkflow).toContain(
      "README.md README.uk.md RELEASE_INSTALL.md MARKETPLACE_HOWTO.md DOCUMENTATION.md",
    );
  });

  it("indexes every release-critical editor contract", () => {
    for (const contract of [
      "working-note UUID",
      "Ctrl/Cmd+S",
      "No save path generates, stamps or cleans up",
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
