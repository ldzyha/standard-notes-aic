// Canonical source is src/core. Mirroring is a mechanical distribution step.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "core");
const target = path.resolve(
  root,
  "..",
  "aic-notes",
  "vendor",
  "aic-editor-core",
);
const check = process.argv.includes("--check");
const different = [];
const isCoreFile = (name) => /\.(?:js|css|d\.ts)$/u.test(name);
const files = (await readdir(source)).filter(isCoreFile).sort();
const unexpected = (await readdir(target)).filter(
  (name) => isCoreFile(name) && !files.includes(name),
);
if (unexpected.length)
  throw new Error(
    `Unexpected vendor files require review: ${unexpected.join(", ")}`,
  );
for (const name of files) {
  const expected = await readFile(path.join(source, name));
  const actual = await readFile(path.join(target, name)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (actual?.equals(expected)) continue;
  different.push(name);
  if (!check) await writeFile(path.join(target, name), expected);
}
if (check && different.length)
  throw new Error(`Core copies differ: ${different.join(", ")}`);
console.log(
  check
    ? "Shared core copies match"
    : `Mirrored ${different.length} core files`,
);
