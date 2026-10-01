// Submit the exact verified GitHub release bytes; never rebuild in a publisher job.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "./browser-assets.mjs";

const stable = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const maxArchiveBytes = 256 * 1024 * 1024;
const requiredFiles = [
  "manifest.json",
  "browser/index.html",
  "worker.js",
  "icon-128.png",
  "PRIVACY.md",
  "PRIVACY.uk.md",
  "THIRD_PARTY_NOTICES.md",
];

export function releaseIdentity(tag, release) {
  if (
    typeof tag !== "string" ||
    !tag.startsWith("v") ||
    !stable.test(tag.slice(1))
  )
    throw new Error("Use a stable vN.N.N release tag");
  if (
    release?.tagName !== tag ||
    release.isDraft !== false ||
    release.isPrerelease !== false
  )
    throw new Error("Use the exact published stable GitHub release");
  const archives = release.assets?.filter(({ name }) =>
    /^aic-browser-chromium-[\d.]+\.zip$/u.test(name),
  );
  if (archives?.length !== 1)
    throw new Error("Release must contain exactly one Chromium ZIP");
  const fileName = archives[0].name;
  const version = fileName.slice("aic-browser-chromium-".length, -4);
  if (!stable.test(version))
    throw new Error("Browser version must be stable N.N.N");
  for (const name of [fileName, `${fileName}.sha256`]) {
    if (release.assets.filter((asset) => asset.name === name).length !== 1)
      throw new Error("Release archive and checksum must be unambiguous");
  }
  return { fileName, version };
}

/** Read only the deterministic ZIP STORE format emitted by package-browser.mjs. */
export function inspectBrowserArchive(bytes) {
  if (bytes.length < 22 || bytes.length > maxArchiveBytes)
    throw new Error("Browser archive exceeds size limits");
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 20) !== 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw new Error("Use the deterministic single-disk release ZIP");
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  if (
    !count ||
    count > 10000 ||
    count !== bytes.readUInt16LE(end + 8) ||
    centralStart + centralSize !== end
  )
    throw new Error("Invalid archive directory");
  let offset = centralStart;
  let nextLocal = 0;
  const files = new Map();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid archive entry");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (
      entryEnd > end ||
      flags !== 0x0800 ||
      method !== 0 ||
      extraLength ||
      commentLength ||
      bytes.readUInt32LE(offset + 24) !== size ||
      bytes.readUInt16LE(offset + 34) !== 0 ||
      local !== nextLocal ||
      local + 30 > centralStart
    )
      throw new Error("Unexpected release ZIP structure");
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString("utf8");
    if (
      !name ||
      !Buffer.from(name).equals(nameBytes) ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      /^[a-z]:/iu.test(name) ||
      files.has(name)
    )
      throw new Error("Duplicate or unsafe archive path");
    const dataStart = local + 30 + nameLength;
    if (
      dataStart + size > centralStart ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt32LE(local + 14) !== checksum ||
      bytes.readUInt32LE(local + 18) !== size ||
      bytes.readUInt32LE(local + 22) !== size ||
      bytes.readUInt16LE(local + 26) !== nameLength ||
      bytes.readUInt16LE(local + 28) !== 0 ||
      !bytes.subarray(local + 30, dataStart).equals(nameBytes)
    )
      throw new Error("Archive local and central entries differ");
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== checksum) throw new Error("Archive CRC mismatch");
    files.set(name, data);
    nextLocal = dataStart + size;
    offset = entryEnd;
  }
  if (offset !== end || nextLocal !== centralStart)
    throw new Error("Unexpected archive contents");
  for (const name of requiredFiles)
    if (!files.has(name)) throw new Error(`Archive is missing ${name}`);
  if (files.get("manifest.json").length > 1024 * 1024)
    throw new Error("Manifest exceeds size limit");
  const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
  if (
    manifest.manifest_version !== 3 ||
    manifest.name !== "AIC — Page notes" ||
    !stable.test(manifest.version) ||
    manifest.background?.service_worker !== "worker.js" ||
    manifest.side_panel?.default_path !== "browser/index.html"
  )
    throw new Error(
      "Archive manifest is not the expected AIC browser extension",
    );
  return manifest;
}

export async function verifyBrowserRelease({ tag, release, directory }) {
  const { fileName, version } = releaseIdentity(tag, release);
  const archivePath = path.resolve(directory, fileName);
  for (const file of [archivePath, `${archivePath}.sha256`]) {
    const stat = await lstat(file);
    const limit = file.endsWith(".sha256") ? 4096 : maxArchiveBytes;
    if (!stat.isFile() || stat.size > limit)
      throw new Error("Assets must be bounded regular files");
  }
  const bytes = await readFile(archivePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    (await readFile(`${archivePath}.sha256`, "utf8")).trim() !==
    `${sha256}  ${fileName}`
  )
    throw new Error("Release ZIP checksum does not match");
  if (inspectBrowserArchive(bytes).version !== version)
    throw new Error("ZIP manifest version differs from asset name");
  return { archivePath, bytes, version, sha256, fileName };
}

function required(env, name, pattern) {
  const value = env[name];
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value)))
    throw new Error(`Configure ${name} before submitting an update`);
  return value;
}

export function createClient({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 30,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30)
    throw new Error("Invalid polling limit");
  async function request(url, init = {}, expected = 200) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(
        "Store request failed or timed out; inspect the store dashboard before retrying",
      );
    }
    // Do not print response bodies: provider errors may contain credentials.
    if (response.status !== expected)
      throw new Error(`Store request returned HTTP ${response.status}`);
    return response;
  }
  async function json(url, init) {
    const response = await request(url, init);
    try {
      return await response.json();
    } catch {
      throw new Error("Store returned invalid JSON");
    }
  }
  async function poll(read, succeeded, pending) {
    for (let index = 0; index < attempts; index++) {
      const status = await read();
      if (succeeded(status)) return status;
      if (!pending(status))
        throw new Error("Store processing failed; inspect the store dashboard");
      if (index + 1 < attempts) await sleep(10000);
    }
    throw new Error(
      "Store processing timed out; inspect the store dashboard before retrying",
    );
  }
  return { request, json, poll };
}

const versions = (revision) =>
  revision?.distributionChannels?.map((channel) => channel.crxVersion) ?? [];
function compareVersion(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export async function publishChrome(artifact, env = process.env, options = {}) {
  const publisher = required(env, "CHROME_PUBLISHER_ID", /^[a-z\d_-]+$/iu);
  const item = required(env, "CHROME_EXTENSION_ID", /^[a-p]{32}$/u);
  const clientId = required(env, "CHROME_CLIENT_ID");
  const clientSecret = required(env, "CHROME_CLIENT_SECRET");
  const refreshToken = required(env, "CHROME_REFRESH_TOKEN");
  const client = createClient(options);
  const token = await client.json("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (
    typeof token.access_token !== "string" ||
    !token.access_token ||
    /[\r\n]/u.test(token.access_token)
  )
    throw new Error("Chrome OAuth did not provide an access token");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const name = `publishers/${publisher}/items/${item}`;
  const base = `https://chromewebstore.googleapis.com/v2/${name}`;
  const readStatus = () => client.json(`${base}:fetchStatus`, { headers });
  const before = await readStatus();
  if (before.itemId !== item || before.takenDown || before.warned)
    throw new Error("Chrome item identity or policy status needs attention");
  if (versions(before.publishedItemRevisionStatus).includes(artifact.version))
    return {
      store: "chrome",
      version: artifact.version,
      state: "already-published",
    };
  if (
    versions(before.publishedItemRevisionStatus).some(
      (version) =>
        !/^[\d.]+$/u.test(version) ||
        compareVersion(version, artifact.version) >= 0,
    )
  )
    throw new Error("Chrome update must increase the published version");
  const submitted = before.submittedItemRevisionStatus;
  if (["PENDING_REVIEW", "STAGED"].includes(submitted?.state)) {
    if (versions(submitted).includes(artifact.version))
      return {
        store: "chrome",
        version: artifact.version,
        state: "already-submitted",
      };
    throw new Error("Another Chrome submission is active");
  }
  const upload = await client.json(
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: artifact.bytes,
    },
  );
  if (
    upload.itemId !== item ||
    (upload.crxVersion && upload.crxVersion !== artifact.version)
  )
    throw new Error("Chrome uploaded item or version differs from release");
  if (upload.uploadState === "IN_PROGRESS") {
    await client.poll(
      readStatus,
      (status) =>
        status.itemId === item && status.lastAsyncUploadState === "SUCCEEDED",
      (status) =>
        status.itemId === item && status.lastAsyncUploadState === "IN_PROGRESS",
    );
  } else if (upload.uploadState !== "SUCCEEDED")
    throw new Error("Chrome upload failed");
  const result = await client.json(`${base}:publish`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: "DEFAULT_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    }),
  });
  if (
    result.itemId !== item ||
    !["PENDING_REVIEW", "PUBLISHED", "STAGED", "PUBLISHED_TO_TESTERS"].includes(
      result.state,
    )
  )
    throw new Error("Chrome submission did not reach an accepted state");
  return { store: "chrome", version: artifact.version, state: result.state };
}

export function edgeOperation(location, operationPath) {
  if (typeof location !== "string" || !location || /[\r\n]/u.test(location))
    throw new Error("Edge did not return an operation ID");
  if (/^[a-z\d-]+$/iu.test(location)) return `${operationPath}/${location}`;
  const url = new URL(
    location,
    "https://api.addons.microsoftedge.microsoft.com",
  );
  const expected = new URL(operationPath);
  if (
    url.origin !== expected.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(`${expected.pathname}/`) ||
    !/^[a-z\d-]+$/iu.test(url.pathname.slice(expected.pathname.length + 1))
  )
    throw new Error("Edge returned an unexpected operation location");
  return url.href;
}

export async function publishEdge(artifact, env = process.env, options = {}) {
  const product = required(env, "EDGE_PRODUCT_ID", /^[a-z\d-]+$/iu);
  const apiKey = required(env, "EDGE_API_KEY");
  const clientId = required(env, "EDGE_CLIENT_ID");
  if (/[\r\n]/u.test(apiKey + clientId))
    throw new Error("Invalid Edge credential headers");
  const client = createClient(options);
  const headers = { Authorization: `ApiKey ${apiKey}`, "X-ClientID": clientId };
  // v1.1 authentication uses the documented /v1 route, not the retired Bearer auth.
  const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${product}/submissions`;
  async function operation(url, init, operationPath) {
    const response = await client.request(
      url,
      { ...init, method: "POST", headers: { ...headers, ...init.headers } },
      202,
    );
    const statusUrl = edgeOperation(
      response.headers.get("location"),
      operationPath,
    );
    return client.poll(
      () => client.json(statusUrl, { headers }),
      (status) => status.status === "Succeeded",
      (status) => status.status === "InProgress",
    );
  }
  await operation(
    `${base}/draft/package`,
    { headers: { "Content-Type": "application/zip" }, body: artifact.bytes },
    `${base}/draft/package/operations`,
  );
  // The endpoint reference specifies plain text certification notes.
  await operation(
    base,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: `AIC browser ${artifact.version}. Verified GitHub release SHA-256 ${artifact.sha256}.`,
    },
    `${base}/operations`,
  );
  return {
    store: "edge",
    version: artifact.version,
    state: "submitted-for-review",
  };
}

async function main() {
  const [, , mode = "verify", tag, metadataPath, directory] = process.argv;
  if (
    !["verify", "chrome", "edge"].includes(mode) ||
    !tag ||
    !metadataPath ||
    !directory ||
    process.argv.length !== 6
  )
    throw new Error(
      "Usage: publish-browser-store.mjs <verify|chrome|edge> <release-tag> <release.json> <asset-directory>",
    );
  const release = JSON.parse(await readFile(metadataPath, "utf8"));
  const artifact = await verifyBrowserRelease({ tag, release, directory });
  const result =
    mode === "verify"
      ? {
          state: "verified",
          version: artifact.version,
          fileName: artifact.fileName,
          sha256: artifact.sha256,
        }
      : await (mode === "chrome" ? publishChrome : publishEdge)(artifact);
  process.stdout.write(`${JSON.stringify(result)}\n`);
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
