import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createStoredZip } from "./browser-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = resolve(root, "dist-browser");

async function filesIn(directory, prefix = "") {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = posix.join(prefix, item.name);
    if (item.isDirectory())
      entries.push(...(await filesIn(resolve(directory, item.name), name)));
    else if (item.isFile())
      entries.push({
        name,
        data: await readFile(resolve(directory, item.name)),
      });
    else throw new Error(`Unexpected browser build entry: ${name}`);
  }
  return entries;
}

export async function verifyBuild(entries) {
  const files = new Map(entries.map((entry) => [entry.name, entry.data]));
  for (const required of [
    "manifest.json",
    "browser/index.html",
    "worker.js",
    "icon-128.png",
    "PRIVACY.md",
    "VERIFICATION.md",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    if (!files.has(required))
      throw new Error(`Chromium build is missing ${required}`);
  }
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  if (manifest.background?.service_worker !== "worker.js") {
    throw new Error(
      "Chromium manifest background.service_worker must be worker.js",
    );
  }
  const sourceManifest = JSON.parse(
    await readFile(resolve(root, "browser/manifest.json"), "utf8"),
  );
  if (JSON.stringify(manifest) !== JSON.stringify(sourceManifest)) {
    throw new Error("Chromium build contains the wrong manifest");
  }
  const panel = files.get("browser/index.html").toString("utf8");
  for (const match of panel.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g,
  )) {
    const reference = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) {
      throw new Error(
        `Chromium panel references a remote resource: ${reference}`,
      );
    }
    const normalized = posix.normalize(posix.join("browser", reference));
    if (!files.has(normalized))
      throw new Error(`Chromium panel references missing ${reference}`);
  }
  if (
    files.get("icon-128.png").subarray(0, 8).toString("hex") !==
    "89504e470d0a1a0a"
  ) {
    throw new Error("Chromium icon is not PNG");
  }
  return manifest.version;
}

export async function createBrowserArchive(entries) {
  const version = await verifyBuild(entries);
  return {
    name: `aic-browser-chromium-${version}.zip`,
    data: createStoredZip(entries),
  };
}

async function main() {
  process.chdir(root);
  await build({
    configFile: resolve(root, "vite.browser.config.mjs"),
    mode: "browser-chromium",
  });
  const directory = resolve(outputRoot, "chromium");
  const entries = await filesIn(directory);
  const archive = await createBrowserArchive(entries);
  console.log(
    `chromium: ${entries.length} bundled files, ${relative(root, directory)}`,
  );
  const artifactDir = resolve(outputRoot, "artifacts");
  await mkdir(artifactDir, { recursive: true });
  const path = resolve(artifactDir, archive.name);
  if (dirname(path) !== artifactDir) throw new Error("Invalid artifact path.");
  await writeFile(path, archive.data);
  const checksum = createHash("sha256").update(archive.data).digest("hex");
  await writeFile(`${path}.sha256`, `${checksum}  ${archive.name}\n`);
  console.log(`${relative(root, path)} sha256 ${checksum}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
