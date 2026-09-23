// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import chromiumManifest from "../browser/manifest.json";
// prettier-ignore
// @ts-expect-error Packaging helper is a dependency-free JavaScript module.
import { crc32, createIconPng, createStoredZip } from "../scripts/browser-assets.mjs";

describe("browser package assets", () => {
  it("creates a deterministic, ordered ZIP with valid fixed DOS dates", () => {
    const files = [
      { name: "b.txt", data: new TextEncoder().encode("B") },
      { name: "a.txt", data: new TextEncoder().encode("A") },
    ];
    const archive = createStoredZip(files);
    expect(archive.equals(createStoredZip([...files].reverse()))).toBe(true);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.subarray(30, 35).toString()).toBe("a.txt");
    expect(archive.readUInt16LE(10)).toBe(0);
    expect(archive.readUInt16LE(12)).toBe(0x21);
    const central = archive.indexOf(Uint8Array.of(0x50, 0x4b, 0x01, 0x02));
    expect(central).toBeGreaterThan(0);
    expect(archive.readUInt16LE(central + 12)).toBe(0);
    expect(archive.readUInt16LE(central + 14)).toBe(0x21);
    expect(archive.readUInt32LE(14)).toBe(crc32(new TextEncoder().encode("A")));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("rejects unsafe and duplicate archive paths", () => {
    expect(() => createStoredZip([{ name: "../bad", data: "x" }])).toThrow();
    expect(() => createStoredZip([{ name: "/bad", data: "x" }])).toThrow();
    expect(() =>
      createStoredZip([
        { name: "same", data: "a" },
        { name: "same", data: "b" },
      ]),
    ).toThrow();
  });

  it("renders the transparent 128px >_ icon as a valid PNG", () => {
    const png = createIconPng();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png[24]).toBe(8); // 8-bit RGBA.
    expect(png[25]).toBe(6);
    const compressedLength = png.readUInt32BE(33);
    expect(compressedLength).toBeGreaterThan(0);
    expect(png.subarray(37, 41).toString()).toBe("IDAT");
    expect(png.readUInt32BE(41 + compressedLength)).toBe(
      crc32(png.subarray(37, 41 + compressedLength)),
    );
  });

  it("packages one Chromium ZIP and rejects non-service-worker builds", () => {
    // A real Node import preserves the file URL that the packaging script uses.
    const probe = String.raw`
      import { readFile } from "node:fs/promises";
      import { resolve } from "node:path";
      import { pathToFileURL } from "node:url";
      const { verifyBuild, createBrowserArchive } = await import(pathToFileURL(resolve("scripts/package-browser.mjs")));
      const { createIconPng } = await import(pathToFileURL(resolve("scripts/browser-assets.mjs")));
      const manifest = JSON.parse(await readFile("browser/manifest.json", "utf8"));
      const entries = [
        { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
        { name: "browser/index.html", data: Buffer.from('<script src="../assets/panel.js"></script>') },
        { name: "assets/panel.js", data: Buffer.from("// panel") },
        { name: "worker.js", data: Buffer.from("// worker") },
        { name: "icon-128.png", data: createIconPng() },
        { name: "PRIVACY.md", data: Buffer.from("privacy") },
        { name: "PRIVACY.uk.md", data: Buffer.from("privacy uk") },
        { name: "README.uk.md", data: Buffer.from("readme uk") },
        { name: "VERIFICATION.md", data: Buffer.from("verification") },
        { name: "VERIFICATION.uk.md", data: Buffer.from("verification uk") },
        { name: "THIRD_PARTY_NOTICES.md", data: Buffer.from("notices") },
      ];
      const version = await verifyBuild(entries);
      const archive = await createBrowserArchive(entries);
      let missingWorker;
      let scriptBackground;
      try { await verifyBuild(entries.filter(entry => entry.name !== "worker.js")); }
      catch (error) { missingWorker = error.message; }
      const changed = [...entries];
      changed[0] = { name: "manifest.json", data: Buffer.from(JSON.stringify({ ...manifest, background: { scripts: ["worker.js"], type: "module" } })) };
      try { await verifyBuild(changed); }
      catch (error) { scriptBackground = error.message; }
      console.log(JSON.stringify({ version, name: archive.name, signature: archive.data.subarray(0, 4).toString("hex"), missingWorker, scriptBackground }));
    `;
    const result = JSON.parse(
      execFileSync(
        (globalThis as unknown as { process: { execPath: string } }).process
          .execPath,
        ["--input-type=module", "-e", probe],
        {
          encoding: "utf8",
        },
      ),
    );
    expect(result.version).toBe(chromiumManifest.version);
    expect(result.name).toBe(
      `aic-browser-chromium-${chromiumManifest.version}.zip`,
    );
    expect(result.signature).toBe("504b0304");
    expect(result.missingWorker).toContain("missing worker.js");
    expect(result.scriptBackground).toContain("service_worker");
  });
});
