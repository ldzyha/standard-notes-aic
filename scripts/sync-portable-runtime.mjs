// Generated host distribution of the canonical PWA. Source provenance is read
// from Git; a working tree snapshot can build locally but cannot prove a release.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const format = "aic-portable-runtime";
const sourceRepository = "https://github.com/ldzyha/standard-notes-aic";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function safeName(name) {
  return (
    typeof name === "string" &&
    !name.includes("\\") &&
    name
      .split("/")
      .every(
        (part) => /^[a-z\d_.-]+$/iu.test(part) && part !== "." && part !== "..",
      )
  );
}

function snapshotInventory(snapshot) {
  if (
    !object(snapshot) ||
    snapshot.format !== format ||
    snapshot.version !== 1 ||
    snapshot.sourceRepository !== sourceRepository ||
    !/^[a-f0-9]{40}$/u.test(snapshot.sourceCommit) ||
    (snapshot.sourceState !== undefined &&
      snapshot.sourceState !== "working-tree") ||
    !object(snapshot.hashes)
  )
    throw new Error("Invalid portable runtime snapshot metadata");
  const names = Object.keys(snapshot.hashes);
  const sorted = [...names].sort();
  if (
    !names.length ||
    names.length > 10000 ||
    names.some(
      (name, index) =>
        !safeName(name) ||
        name !== sorted[index] ||
        !/^[a-f0-9]{64}$/u.test(snapshot.hashes[name]),
    )
  )
    throw new Error("Invalid portable runtime snapshot inventory");
  return names;
}

function expectedDirectories(names) {
  const directories = new Set();
  for (const name of names) {
    const pieces = name.split("/");
    for (let index = 1; index < pieces.length; index++)
      directories.add(pieces.slice(0, index).join("/"));
  }
  return [...directories].sort();
}

async function readTree(root) {
  const files = new Map();
  const directories = [];
  let totalBytes = 0;
  async function visit(directory, prefix = "") {
    if (!(await lstat(directory)).isDirectory())
      throw new Error("Portable runtime directories must not be symlinks");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeName(name)) throw new Error("Unsafe portable runtime path");
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(name);
        await visit(location, name);
      } else if (entry.isFile()) {
        totalBytes += (await lstat(location)).size;
        if (totalBytes > 256 * 1024 * 1024 || files.size >= 10000)
          throw new Error("Portable runtime file exceeds size limit");
        files.set(name, await readFile(location));
      } else
        throw new Error(
          "Portable runtime must contain only regular files and directories",
        );
    }
  }
  await visit(root);
  return { files, directories: directories.sort() };
}

function assertTree(tree, names, hashes) {
  const actual = [...tree.files.keys()].sort();
  if (
    actual.length !== names.length ||
    actual.some((name, index) => name !== names[index]) ||
    JSON.stringify(tree.directories) !==
      JSON.stringify(expectedDirectories(names))
  )
    throw new Error("Portable runtime inventory differs from its snapshot");
  if (hashes)
    for (const name of names)
      if (sha256(tree.files.get(name)) !== hashes[name])
        throw new Error(`Portable runtime hash differs: ${name}`);
}

function assertBuild(files) {
  const html = files.get("index.html")?.toString("utf8");
  if (
    !html ||
    !/<script\b[^>]*type="module"[^>]*src="\.\/assets\/[^"<>]+\.js"/u.test(html)
  )
    throw new Error(
      "Build the canonical PWA with a local module entry before synchronization",
    );
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gu,
  )) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (
      !reference.startsWith("./") ||
      !safeName(reference.slice(2)) ||
      !files.has(reference.slice(2))
    )
      throw new Error("Portable HTML must reference bundled local resources");
  }
}

export async function syncPortableRuntime({
  root = defaultRoot,
  targetRoot = path.resolve(root, "..", "aic-notes"),
  check = false,
} = {}) {
  root = path.resolve(root);
  targetRoot = path.resolve(targetRoot);
  const targetManifest = JSON.parse(
    await readFile(path.join(targetRoot, "package.json"), "utf8"),
  );
  if (targetManifest.name !== "aic-notes")
    throw new Error("--target must name the AIC Notes repository");
  const source = await readTree(path.join(root, "dist-pwa"));
  const names = [...source.files.keys()].sort();
  if (!names.length) throw new Error("Canonical PWA build is empty");
  assertTree(source, names);
  assertBuild(source.files);
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
      {
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  const sourceCommit = git("rev-parse", "HEAD");
  const inputs = [
    "src",
    "pwa",
    "public",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.pwa.config.mjs",
  ];
  const dirty = Boolean(
    git("status", "--porcelain", "--untracked-files=all", "--", ...inputs),
  );
  const hashes = Object.fromEntries(
    names.map((name) => [name, sha256(source.files.get(name))]),
  );
  const snapshot = {
    format,
    version: 1,
    sourceRepository,
    sourceCommit,
    ...(dirty ? { sourceState: "working-tree" } : {}),
    hashes,
  };
  snapshotInventory(snapshot);

  const vendorRoot = path.join(targetRoot, "vendor");
  if (!(await lstat(vendorRoot)).isDirectory())
    throw new Error("Target vendor directory must be a regular directory");
  const destination = path.join(vendorRoot, "portable-runtime");
  const snapshotPath = path.join(targetRoot, "PORTABLE_SNAPSHOT.json");
  const snapshotStat = await lstat(snapshotPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (snapshotStat && !snapshotStat.isFile())
    throw new Error("Portable runtime snapshot must be a regular file");
  if (snapshotStat?.size > 1024 * 1024)
    throw new Error("Portable runtime snapshot exceeds size limit");
  const prior = await readFile(snapshotPath, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
  const current = await readTree(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return { files: new Map(), directories: [] };
  });
  if (check) {
    if (!prior) throw new Error("Portable runtime snapshot is missing");
    const priorNames = snapshotInventory(prior);
    assertTree(current, priorNames, prior.hashes);
    if (JSON.stringify(prior) !== JSON.stringify(snapshot))
      throw new Error(
        "Portable runtime or source provenance differs; synchronize the canonical build",
      );
    return snapshot;
  }
  // A populated directory without a valid exact snapshot is never claimed or
  // deleted. This prevents removing unrelated files during generated cleanup.
  if (prior) assertTree(current, snapshotInventory(prior), prior.hashes);
  else if (current.files.size || current.directories.length)
    throw new Error(
      "Refusing to replace an unowned portable runtime directory",
    );
  await mkdir(destination, { recursive: true });
  for (const name of names) {
    const location = path.join(destination, ...name.split("/"));
    await mkdir(path.dirname(location), { recursive: true });
    await writeFile(location, source.files.get(name));
  }
  for (const name of current.files.keys())
    if (!source.files.has(name))
      await unlink(path.join(destination, ...name.split("/")));
  const wantedDirectories = new Set(expectedDirectories(names));
  for (const directory of [...current.directories].sort(
    (a, b) => b.length - a.length,
  )) {
    if (!wantedDirectories.has(directory))
      await rmdir(path.join(destination, ...directory.split("/")));
  }
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

async function main() {
  const args = process.argv.slice(2);
  let check = false;
  let targetRoot;
  while (args.length) {
    const option = args.shift();
    if (option === "--check" && !check) check = true;
    else if (
      option === "--target" &&
      !targetRoot &&
      args[0] &&
      !args[0].startsWith("--")
    )
      targetRoot = path.resolve(args.shift());
    else
      throw new Error(
        "Usage: sync-portable-runtime.mjs [--check] [--target <AIC-Notes-repository>]",
      );
  }
  const snapshot = await syncPortableRuntime({
    check,
    ...(targetRoot ? { targetRoot } : {}),
  });
  process.stdout.write(
    `${check ? "Verified" : "Synchronized"} portable runtime: ${Object.keys(snapshot.hashes).length} files, ${snapshot.sourceCommit}${snapshot.sourceState ? " (working-tree)" : ""}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
