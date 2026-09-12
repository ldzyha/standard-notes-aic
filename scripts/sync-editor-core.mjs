// Canonical source is src/core. Mirroring is a mechanical distribution step.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
const snapshotRequested = process.argv.includes("--snapshot");
if (check && snapshotRequested)
  throw new Error("Check is read-only; do not combine it with --snapshot");
const different = [];
const isCoreFile = (name) => /\.(?:js|css|d\.ts)$/u.test(name);
// Distribution is explicit. Unconnected experiments are never released just
// because a developer created another file in src/core.
const files = JSON.parse(
  await readFile(path.join(root, "CORE_FILES.json"), "utf8"),
);
if (
  !Array.isArray(files) ||
  !files.length ||
  files.some(
    (name, index) =>
      typeof name !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*\.(?:js|css|d\.ts)$/iu.test(name) ||
      (index > 0 && files[index - 1] >= name),
  )
)
  throw new Error("Invalid canonical core distribution inventory");
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
if (snapshotRequested) {
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${root.replaceAll("\\", "/")}`,
        "-C",
        root,
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const sourceCommit = git("rev-parse", "HEAD");
  const sourcePaths = [
    "package.json",
    "CORE_FILES.json",
    ...files.map((name) => `src/core/${name}`),
  ];
  const dirty = Boolean(git("status", "--porcelain", "--", ...sourcePaths));
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const hashes = {};
  for (const name of files)
    hashes[name] = createHash("sha256")
      .update(await readFile(path.join(source, name)))
      .digest("hex");
  await writeFile(
    path.join(target, "..", "..", "CORE_SNAPSHOT.json"),
    JSON.stringify(
      {
        coreVersion: manifest.aicEditorCore,
        sourceRepository: "https://github.com/ldzyha/standard-notes-aic",
        sourceCommit,
        ...(dirty ? { sourceState: "working-tree" } : {}),
        files: hashes,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(
  check
    ? "Shared core copies match"
    : `Mirrored ${different.length} core files`,
);
