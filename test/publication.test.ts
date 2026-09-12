import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";
import readme from "../README.md?raw";
import changelog from "../CHANGELOG.md?raw";
import functionalIndex from "../FUNCTIONAL_INDEX.md?raw";
import manifest from "../public/ext.json";

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
    expect(releaseWorkflow).toContain('--notes "Website: https://dzyha.com/"');
  });

  it("serializes duplicate tag deliveries and republishes idempotently", () => {
    expect(releaseWorkflow).toContain("group: release-${{ github.ref }}");
    expect(releaseWorkflow).toContain(
      'gh release view "$RELEASE_TAG" >/dev/null 2>&1',
    );
    expect(releaseWorkflow).toContain(
      'gh release upload "$RELEASE_TAG" "$ASSET" "$ASSET.sha256" --clobber',
    );
  });

  it("documents the 22.1.8 R.F.B release and packages usage instructions", () => {
    expect(changelog).toContain("## 22.1.8 — 2026-09-12");
    expect(changelog).toContain(
      "Release sequence 22 · 1 feature outcome · 8 fixed-bug outcomes",
    );
    expect(readme).toContain("## Slash templates");
    expect(readme).toContain("`Tab` to move through");
    expect(readme).toContain("ordinary `.md` documents");
    expect(readme).toContain("## Preview and source controls");
    expect(readme).toContain(">>>|open| Title");
    expect(readme).toContain("Raw Space is");
    expect(releaseWorkflow).toContain(
      "cp README.md CHANGELOG.md FUNCTIONAL_INDEX.md .release/",
    );
    expect(releaseWorkflow).toContain(
      "package.json README.md CHANGELOG.md FUNCTIONAL_INDEX.md dist",
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
