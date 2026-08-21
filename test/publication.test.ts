import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";
import readme from "../README.md?raw";
import changelog from "../CHANGELOG.md?raw";
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

  it("documents the 4.0.1 R.F.B release and packages usage instructions", () => {
    expect(changelog).toContain("## 4.0.1 — 2026-08-21");
    expect(changelog).toContain(
      "Release sequence 4 · 0 feature outcomes · 1 fixed-bug outcome",
    );
    expect(readme).toContain("## Preview and source controls");
    expect(readme).toContain(">>>|open| Title");
    expect(readme).toContain("Raw Space is");
    expect(releaseWorkflow).toContain("cp README.md CHANGELOG.md .release/");
    expect(releaseWorkflow).toContain(
      "package.json README.md CHANGELOG.md dist",
    );
  });
});
