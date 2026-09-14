import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = "public/THIRD_PARTY_NOTICES.md";
const normalize = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .trimEnd();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const noticeName =
  /^(?:licen[cs]e|copying|notice|copyright)(?:[-.](?:txt|md|rst|apache.*|mpl.*|mit.*|bsd.*))?$/i;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

export function productionPackages(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""])
    throw new Error("Notices require an npm v3 lockfile.");
  return Object.entries(lock.packages)
    .filter(([path, metadata]) => path && !metadata.dev)
    .sort(([a], [b]) => compare(a, b));
}

async function mapFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await mapFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".map")) found.push(path);
  }
  return found.sort(compare);
}

export async function generateNotices(projectRoot = root) {
  const lock = await readJson(join(projectRoot, "package-lock.json"));
  const overrides = await readJson(
    join(projectRoot, "scripts/third-party-license-overrides.json"),
  );
  const packages = new Map();
  for (const [path, locked] of productionPackages(lock)) {
    const directory = resolve(projectRoot, path);
    if (!directory.startsWith(resolve(projectRoot, "node_modules") + sep))
      throw new Error(`Unexpected dependency path: ${path}`);
    const metadata = await readJson(join(directory, "package.json"));
    if (metadata.version !== locked.version)
      throw new Error(`Installed version differs from lockfile: ${path}`);
    const files = {};
    for (const file of (await readdir(directory)).sort(compare)) {
      if (noticeName.test(file))
        files[file] = normalize(await readFile(join(directory, file), "utf8"));
    }
    const id = `${metadata.name}@${metadata.version}`;
    packages.set(id, {
      license: metadata.license ?? "See the supplied license text below",
      source: `npm ${id}`,
      files,
    });
  }

  // This pinned package declares MIT but supplies no license/copyright file,
  // including in its upstream repository. Do not invent a copyright holder.
  const transport = packages.get("sn-extension-api@0.4.0");
  if (transport && Object.keys(transport.files).length === 0) {
    if (transport.license !== "MIT")
      throw new Error("sn-extension-api license metadata changed.");
    const codemirror = packages.get("@codemirror/view@6.43.1");
    const permission = codemirror?.files.LICENSE?.match(
      /Permission is hereby granted[\s\S]+/,
    )?.[0];
    if (!permission) throw new Error("Cannot locate the supplied MIT terms.");
    transport.files["Published license declaration and MIT terms"] =
      "The published sn-extension-api@0.4.0 package.json declares MIT. The package\n" +
      "does not supply a separate license file or copyright notice. Upstream:\n" +
      "https://github.com/nienow/sn-extension-api\n\n" +
      "The MIT permission and warranty terms follow; no copyright holder or year\n" +
      "has been inferred or added.\n\n" +
      permission;
  }

  // Mermaid prebundles some dependencies that are absent from npm's installed
  // production graph. Its published source maps identify their exact versions.
  // Include their reviewed, version-pinned npm license files without networking.
  for (const directory of [
    "node_modules/mermaid/dist/chunks/mermaid.core",
    "node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core",
  ]) {
    for (const file of await mapFiles(join(projectRoot, directory))) {
      const map = await readJson(file);
      for (const [index, source] of map.sources.entries()) {
        const match = source.match(
          /\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)/,
        );
        if (match) {
          const name = match[2];
          const prefix = `${name.replace("/", "+")}@`;
          if (!match[1].startsWith(prefix))
            throw new Error(`Unrecognized embedded dependency: ${source}`);
          const version = match[1].slice(prefix.length).split("_")[0];
          const id = `${name}@${version}`;
          if (!packages.has(id)) {
            if (!overrides[id])
              throw new Error(
                `Missing pinned embedded dependency notice: ${id}`,
              );
            packages.set(id, overrides[id]);
          }
        } else if (source.includes("node_modules/")) {
          if (source !== "webpack://LIB/node_modules/path-browserify/index.js")
            throw new Error(`Unversioned embedded dependency: ${source}`);
          const header = map.sourcesContent[index]?.match(
            /^(?:(?:\/\/[^\n]*\n)|\s*\n)+/,
          )?.[0];
          if (
            !header?.includes("Copyright Joyent") ||
            !header.includes("Permission is hereby granted") ||
            !header.includes("OTHER DEALINGS IN THE SOFTWARE")
          )
            throw new Error("Embedded path-browserify notice changed.");
          packages.set("path-browserify (embedded source)", {
            license: "MIT terms supplied in the source header",
            source,
            files: { "Source copyright and permission notice": header },
          });
        }
      }
    }
  }

  const sections = [
    "# Third-party notices\n\n" +
      "Generated from the installed, locked production dependency set and license\n" +
      "files for dependencies embedded in the upstream Mermaid bundles. Development-only\n" +
      "packages are excluded. This is a conservative shared inventory: an individual\n" +
      "Standard Notes, browser or VS Code bundle may omit unused packages and code.\n\n" +
      "These terms apply to the named third-party components only. They do not change\n" +
      "the surrounding application's own license. Copyright and license text supplied\n" +
      "by each package is reproduced below; line endings and trailing whitespace\n" +
      "are normalized.\n\n" +
      "Regenerate with `node scripts/generate-third-party-notices.mjs`; verify with\n" +
      "`node scripts/generate-third-party-notices.mjs --check`. Embedded license sources\n" +
      "and package integrity metadata are pinned in\n" +
      "`scripts/third-party-license-overrides.json`.",
  ];
  for (const [id, notice] of [...packages].sort(([a], [b]) => compare(a, b))) {
    if (!Object.keys(notice.files).length)
      throw new Error(`Dependency supplies no reviewed license text: ${id}`);
    const parts = [
      `## ${id}\n\nDeclared license: ${notice.license}\n\nSource: ${notice.source}`,
    ];
    for (const [name, text] of Object.entries(notice.files).sort(([a], [b]) =>
      compare(a, b),
    )) {
      if (!text.trim()) throw new Error(`Empty license notice: ${id}/${name}`);
      const fence = "`".repeat(
        Math.max(
          3,
          ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1),
        ),
      );
      parts.push(`### ${name}\n\n${fence}text\n${normalize(text)}\n${fence}`);
    }
    sections.push(parts.join("\n\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.slice(2).some((arg) => arg !== "--check"))
    throw new Error("Usage: generate-third-party-notices.mjs [--check]");
  const generated = await generateNotices();
  if (process.argv.includes("--check")) {
    if (
      normalize(await readFile(join(root, output), "utf8")) !==
      normalize(generated)
    )
      throw new Error(
        "Third-party notices are stale; regenerate before packaging.",
      );
    console.log("Third-party notices match the locked dependencies.");
  } else {
    await writeFile(join(root, output), generated);
    console.log(`Generated ${output}`);
  }
}
