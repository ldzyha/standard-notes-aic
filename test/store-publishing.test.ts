import { describe, expect, it } from "vitest";
// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { createHash } from "node:crypto";
// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
// @ts-expect-error Node types are not included in the browser-focused tsconfig.
import { tmpdir } from "node:os";
import path from "node:path";
// prettier-ignore
// @ts-expect-error Publication helper is a dependency-free Node module.
import { createClient, edgeOperation, inspectBrowserArchive, publishChrome, publishEdge, releaseIdentity, verifyBrowserRelease } from "../scripts/publish-browser-store.mjs";
// prettier-ignore
// @ts-expect-error Packaging helper is a dependency-free Node module.
import { createStoredZip } from "../scripts/browser-assets.mjs";
import manifest from "../browser/manifest.json";
import { parse } from "yaml";

const tag = "v47.1.0";
const version = "0.10.0";
const fileName = `aic-browser-chromium-${version}.zip`;
const release = () => ({
  tagName: tag,
  isDraft: false,
  isPrerelease: false,
  assets: [{ name: fileName }, { name: `${fileName}.sha256` }],
});
const archive = (overrides = {}) =>
  createStoredZip([
    {
      name: "manifest.json",
      data: JSON.stringify({ ...manifest, version, ...overrides }),
    },
    ...[
      "browser/index.html",
      "worker.js",
      "icon-128.png",
      "PRIVACY.md",
      "PRIVACY.uk.md",
      "THIRD_PARTY_NOTICES.md",
    ].map((name) => ({ name, data: "fixture" })),
  ]);
const artifact = () => ({ bytes: archive(), version, sha256: "1".repeat(64) });
const chromeEnv = {
  CHROME_PUBLISHER_ID: "publisher",
  CHROME_EXTENSION_ID: "a".repeat(32),
  CHROME_CLIENT_ID: "fixture-client",
  CHROME_CLIENT_SECRET: "fixture-secret",
  CHROME_REFRESH_TOKEN: "fixture-refresh",
};
const edgeEnv = {
  EDGE_PRODUCT_ID: "fixture-product",
  EDGE_API_KEY: "fixture-key",
  EDGE_CLIENT_ID: "fixture-client",
};
const itemId = chromeEnv.CHROME_EXTENSION_ID;
function mockClient(
  responses: Array<{ status?: number; body?: any; location?: string }>,
) {
  const calls: Array<{ url: string; init: any }> = [];
  let delays = 0;
  return {
    calls,
    get delays() {
      return delays;
    },
    options: {
      attempts: 3,
      sleep: async () => {
        delays++;
      },
      fetchImpl: async (url: string, init: any) => {
        calls.push({ url, init });
        const next = responses.shift();
        if (!next) throw new Error("Unexpected request");
        return {
          status: next.status ?? 200,
          json: async () => next.body,
          headers: new Map([["location", next.location]]),
        };
      },
    },
  };
}

describe("verified browser store release", () => {
  it("defaults manual store runs to verification and scopes core sync to a review PR", async () => {
    const workflow = parse(
      await readFile(
        path.resolve(".github/workflows/browser-marketplace.yml"),
        "utf8",
      ),
    );
    expect(workflow.on.workflow_dispatch.inputs.verification_only.default).toBe(
      true,
    );
    expect(workflow.on.workflow_call.inputs.verification_only.default).toBe(
      true,
    );
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.submit.permissions).toEqual({ contents: "read" });
    const steps = workflow.jobs.submit.steps;
    const verification = steps.findIndex((step: any) =>
      step.run?.includes("publish-browser-store.mjs verify"),
    );
    const submissions = steps.filter((step: any) =>
      step.name?.startsWith("Submit "),
    );
    expect(verification).toBeGreaterThan(0);
    for (const step of submissions) {
      expect(steps.indexOf(step)).toBeGreaterThan(verification);
      expect(step.if).toContain("inputs.verification_only != true");
      expect(step.run).toContain('"$PUBLISH_ENABLED" != true');
    }
    const sync = parse(
      await readFile(path.resolve(".github/workflows/sync-core.yml"), "utf8"),
    );
    expect(sync.jobs.propose.if).toContain(
      "vars.AIC_CORE_SYNC_ENABLED == 'true'",
    );
    expect(sync.jobs.propose.if).toContain("refs/heads/main");
    const actions = sync.jobs.propose.steps;
    const gate = actions.findIndex((step: any) =>
      step.run?.includes("npm run release:gate"),
    );
    const pr = actions.findIndex((step: any) =>
      step.run?.includes("gh pr create"),
    );
    expect(pr).toBeGreaterThan(gate);
    expect(actions[pr].run).toContain("SYNC_BRANCH=codex/sync-editor-core");
    expect(actions[pr].run).toContain("--force-with-lease=");
    expect(actions[pr].run).not.toContain("git push origin main");
  });

  it("selects one stable browser asset independently of the Standard Notes tag version", () => {
    expect(releaseIdentity(tag, release())).toEqual({ fileName, version });
    for (const value of [
      "47.1.0",
      "v47.1.0-beta",
      "v047.1.0",
      "v47.1.0\n",
      "$(invalid)",
    ])
      expect(() => releaseIdentity(value, release())).toThrow();
    for (const override of [
      { isDraft: true },
      { isPrerelease: true },
      { tagName: "v48.0.0" },
      { assets: [] },
      { assets: [...release().assets, { name: fileName }] },
    ])
      expect(() =>
        releaseIdentity(tag, { ...release(), ...override }),
      ).toThrow();
  });

  it("checks release bytes, checksum filename, identity and manifest version", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aic-browser-store-"));
    try {
      const bytes = archive();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const archivePath = path.join(directory, fileName);
      await writeFile(archivePath, bytes);
      await writeFile(`${archivePath}.sha256`, `${sha256}  ${fileName}\n`);
      const input = { tag, release: release(), directory };
      expect((await verifyBrowserRelease(input)).sha256).toBe(sha256);
      expect(await readFile(archivePath, "utf8")).toBe(bytes.toString("utf8"));
      await writeFile(`${archivePath}.sha256`, `${sha256}  another.zip\n`);
      await expect(verifyBrowserRelease(input)).rejects.toThrow(/checksum/);
      const mismatch = archive({ version: "0.11.0" });
      await writeFile(archivePath, mismatch);
      await writeFile(
        `${archivePath}.sha256`,
        `${createHash("sha256").update(mismatch).digest("hex")}  ${fileName}\n`,
      );
      await expect(verifyBrowserRelease(input)).rejects.toThrow(/version/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects corruption, unexpected ZIP structures and extension identity", () => {
    expect(inspectBrowserArchive(archive()).version).toBe(version);
    const changed = archive();
    changed[changed.indexOf("fixture")] ^= 1;
    expect(() => inspectBrowserArchive(changed)).toThrow(/CRC/);
    const compressed = archive();
    compressed.writeUInt16LE(8, 8);
    expect(() => inspectBrowserArchive(compressed)).toThrow();
    for (const overrides of [
      { name: "Other extension" },
      { manifest_version: 2 },
      { version: "0.11.0-beta" },
    ])
      expect(() => inspectBrowserArchive(archive(overrides))).toThrow(
        /manifest/,
      );
    const truncated = archive().subarray(0, -1);
    expect(() => inspectBrowserArchive(truncated)).toThrow();
  });
});

describe("Chrome update submission", () => {
  it("polls asynchronous upload and submits the exact bytes for review", async () => {
    const mock = mockClient([
      { body: { access_token: "fixture-access" } },
      { body: { itemId } },
      { body: { itemId, uploadState: "IN_PROGRESS" } },
      { body: { itemId, lastAsyncUploadState: "IN_PROGRESS" } },
      { body: { itemId, lastAsyncUploadState: "SUCCEEDED" } },
      { body: { itemId, state: "PENDING_REVIEW" } },
    ]);
    const input = artifact();
    expect(await publishChrome(input, chromeEnv, mock.options)).toEqual({
      store: "chrome",
      version,
      state: "PENDING_REVIEW",
    });
    expect(mock.calls[2]?.url).toContain(
      "/upload/v2/publishers/publisher/items/",
    );
    expect(mock.calls[2]?.init.body).toBe(input.bytes);
    expect(JSON.parse(mock.calls[5]?.init.body)).toEqual({
      publishType: "DEFAULT_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    });
    expect(mock.delays).toBe(1);
    expect(
      mock.calls.every(
        (call) => call.init.redirect === "error" && call.init.signal,
      ),
    ).toBe(true);
  });

  it("leaves an identical published or pending version alone", async () => {
    for (const [field, state] of [
      ["publishedItemRevisionStatus", "already-published"],
      ["submittedItemRevisionStatus", "already-submitted"],
    ]) {
      const mock = mockClient([
        { body: { access_token: "fixture-access" } },
        {
          body: {
            itemId,
            [field!]: {
              state: "PENDING_REVIEW",
              distributionChannels: [{ crxVersion: version }],
            },
          },
        },
      ]);
      expect(
        (await publishChrome(artifact(), chromeEnv, mock.options)).state,
      ).toBe(state);
      expect(mock.calls).toHaveLength(2);
    }
  });

  it("rejects an active different submission, older version, failed upload and wrong upload identity", async () => {
    for (const before of [
      {
        itemId,
        submittedItemRevisionStatus: {
          state: "PENDING_REVIEW",
          distributionChannels: [{ crxVersion: "0.9.3" }],
        },
      },
      {
        itemId,
        publishedItemRevisionStatus: {
          distributionChannels: [{ crxVersion: "0.11.0" }],
        },
      },
      { itemId, takenDown: true },
    ]) {
      const mock = mockClient([
        { body: { access_token: "fixture-access" } },
        { body: before },
      ]);
      await expect(
        publishChrome(artifact(), chromeEnv, mock.options),
      ).rejects.toThrow();
      expect(mock.calls).toHaveLength(2);
    }
    for (const upload of [
      { itemId, uploadState: "FAILED" },
      { itemId, uploadState: "SUCCEEDED", crxVersion: "0.9.3" },
      { itemId: "b".repeat(32), uploadState: "SUCCEEDED" },
    ]) {
      const mock = mockClient([
        { body: { access_token: "fixture-access" } },
        { body: { itemId } },
        { body: upload },
      ]);
      await expect(
        publishChrome(artifact(), chromeEnv, mock.options),
      ).rejects.toThrow();
      expect(mock.calls).toHaveLength(3);
    }
  });

  it("does not contact a store when credentials are absent", async () => {
    const mock = mockClient([]);
    await expect(publishChrome(artifact(), {}, mock.options)).rejects.toThrow(
      /Configure/,
    );
    await expect(publishEdge(artifact(), {}, mock.options)).rejects.toThrow(
      /Configure/,
    );
    expect(mock.calls).toHaveLength(0);
  });
});

describe("Edge update submission", () => {
  it("waits for upload before submitting and polls both operation IDs", async () => {
    const mock = mockClient([
      { status: 202, location: "upload-operation" },
      { body: { status: "InProgress" } },
      { body: { status: "Succeeded" } },
      { status: 202, location: "publish-operation" },
      { body: { status: "Succeeded" } },
    ]);
    const input = artifact();
    expect((await publishEdge(input, edgeEnv, mock.options)).state).toBe(
      "submitted-for-review",
    );
    expect(mock.calls[0]?.init.body).toBe(input.bytes);
    expect(mock.calls[1]?.url).toContain(
      "/draft/package/operations/upload-operation",
    );
    expect(mock.calls[3]?.url).toBe(
      "https://api.addons.microsoftedge.microsoft.com/v1/products/fixture-product/submissions",
    );
    expect(mock.calls[4]?.url).toContain(
      "/submissions/operations/publish-operation",
    );
    expect(
      mock.calls.every(
        (call) =>
          call.init.headers.Authorization === "ApiKey fixture-key" &&
          call.init.headers["X-ClientID"] === "fixture-client",
      ),
    ).toBe(true);
  });

  it("rejects failed processing and credential-leaking operation locations", async () => {
    const mock = mockClient([
      { status: 202, location: "upload-operation" },
      { body: { status: "Failed", message: "fixture-secret" } },
    ]);
    await expect(
      publishEdge(artifact(), edgeEnv, mock.options),
    ).rejects.toThrow("Store processing failed; inspect the store dashboard");
    expect(mock.calls).toHaveLength(2);
    const base =
      "https://api.addons.microsoftedge.microsoft.com/v1/products/product/submissions/operations";
    expect(edgeOperation("operation-id", base)).toBe(`${base}/operation-id`);
    expect(edgeOperation(`${base}/operation-id`, base)).toBe(
      `${base}/operation-id`,
    );
    for (const value of [
      "https://example.com/secret",
      `${base}/../other`,
      `${base}/operation?token=x`,
      `${base}/operation#fragment`,
      "",
    ])
      expect(() => edgeOperation(value, base)).toThrow();
  });

  it("bounds polling and never includes provider response text in HTTP errors", async () => {
    const mock = mockClient([
      { body: { status: "InProgress" } },
      { body: { status: "InProgress" } },
      { body: { status: "InProgress" } },
    ]);
    const client = createClient(mock.options);
    await expect(
      client.poll(
        () => client.json("https://example.com"),
        () => false,
        () => true,
      ),
    ).rejects.toThrow(/timed out/);
    expect(mock.calls).toHaveLength(3);
    expect(mock.delays).toBe(2);
    const failed = mockClient([
      { status: 401, body: { message: "fixture-secret" } },
    ]);
    await expect(
      createClient(failed.options).json("https://example.com"),
    ).rejects.toThrow("Store request returned HTTP 401");
  });
});
