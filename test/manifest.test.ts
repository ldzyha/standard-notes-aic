import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import manifest from "../public/ext.json";
import localManifest from "../public/ext.local.json";

describe("Standard Notes component manifest", () => {
  it("registers AIC as a Markdown editor note type", () => {
    expect(packageJson.version).toBe("4.0.1");
    expect(manifest).toMatchObject({
      identifier: "com.dzyha.standard-notes-aic",
      name: "AIC",
      content_type: "SN|Component",
      area: "editor-editor",
      note_type: "markdown",
      file_type: "md",
      interchangeable: true,
      url: "https://ldzyha.github.io/standard-notes-aic/",
      latest_url: "https://ldzyha.github.io/standard-notes-aic/ext.json",
    });
    expect(manifest).not.toHaveProperty("marketing_url");
    expect(packageJson.homepage).toBe(
      "https://ldzyha.github.io/standard-notes-aic/",
    );
    expect(manifest.download_url).toContain(`/v${packageJson.version}/`);
    expect(
      manifest.download_url.endsWith(
        `/standard-notes-aic-${packageJson.version}.zip`,
      ),
    ).toBe(true);
    expect(manifest.version).toBe(packageJson.version);
    expect(packageJson.sn).toMatchObject({
      name: "AIC",
      content_type: "SN|Component",
      area: "editor-editor",
      note_type: "markdown",
      file_type: "md",
      interchangeable: true,
    });
  });

  it("keeps localhost development separate under the stable identifier", () => {
    expect(localManifest).toMatchObject({
      identifier: manifest.identifier,
      name: "AIC (Local)",
      content_type: manifest.content_type,
      area: manifest.area,
      version: packageJson.version,
      url: "http://localhost:5178/",
      note_type: manifest.note_type,
      file_type: manifest.file_type,
      interchangeable: true,
    });
  });

  it("uses the narrow Standard Notes bridge instead of legacy EditorKit", () => {
    expect(packageJson.dependencies).toMatchObject({
      "sn-extension-api": "0.4.0",
      mermaid: "11.16.1",
    });
    expect(packageJson.dependencies).not.toHaveProperty(
      "@standardnotes/editor-kit",
    );
  });
});
