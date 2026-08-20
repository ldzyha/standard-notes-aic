import { describe, expect, it } from "vitest";
import releaseWorkflow from "../.github/workflows/release.yml?raw";
import readme from "../README.md?raw";
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
});
