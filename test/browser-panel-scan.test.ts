import { afterEach, expect, it, vi } from "vitest";
import { BrowserPanel } from "../src/browser/panel";
import type { BrowserApi, Request } from "../src/browser/api";
import type {
  BrowserScan,
  BrowserScanStatus,
  BrowserStatus,
} from "../src/browser/markdown-storage";

vi.mock("../src/browser/markdown-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/browser/markdown-storage")>()),
  chooseBrowserSource: vi.fn(async () => "browser-scan-folder"),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const panels: BrowserPanel[] = [];
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function progress(
  phase: BrowserScan["phase"],
  names: string[],
  next: number,
): BrowserScanStatus {
  return {
    scan: {
      id: "current-scan",
      sourceId: "browser-scan-folder",
      phase,
      inspected: next * 10,
      found: next,
      loaded: next,
      path: names.at(-1) ?? "",
      revision: next,
    },
    notes: names.map((filePath) => ({
      id: filePath,
      filePath,
      title: filePath,
      url: "",
      scope: "current",
    })),
    next,
  };
}

it("drains an in-flight scan tick before the final cursor read", async () => {
  const connected = deferred<BrowserStatus>();
  const reads: {
    message: Extract<Request, { type: "scan-status" }>;
    result: ReturnType<typeof deferred<BrowserScanStatus>>;
  }[] = [];
  let connecting = false;
  let status: BrowserStatus = {
    state: "unselected",
    source: { kind: "unselected" },
  };
  const event = () => ({ addListener() {}, removeListener() {} });
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        let value: unknown;
        switch (message.type) {
          case "status":
            value = status;
            break;
          case "connect-source":
            connecting = true;
            value = status = await connected.promise;
            break;
          case "scan-status": {
            if (!connecting) {
              value = { scan: null, notes: [], next: 0 };
              break;
            }
            const result = deferred<BrowserScanStatus>();
            reads.push({ message, result });
            value = await result.promise;
            break;
          }
          case "list-recovery":
            value = [];
            break;
          case "context":
            value = null;
            break;
          case "visit":
          case "load":
            value = {
              version: 3,
              notes: [],
              domains: [],
              global: null,
              history: [],
            };
            break;
          default:
            throw new Error(`Unexpected request ${message.type}`);
        }
        return { ok: true, value };
      },
    },
    windows: { getCurrent: async () => ({ id: 1, incognito: false }) },
    storage: { onChanged: event() },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event() },
  } as unknown as BrowserApi;
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  await panel.ready;
  root.querySelector<HTMLButtonElement>('[aria-label="Open folder"]')!.click();
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  reads[0]!.result.resolve(progress("reading", ["a.note.md"], 1));
  await vi.waitFor(() => expect(reads).toHaveLength(2));
  expect(reads[1]!.message).toMatchObject({ id: "current-scan", after: 1 });
  const stopButton = root.querySelector('[aria-label="Use found notes"]');
  const foundControl = root.querySelector(".browser-scan__found summary");

  // The authoritative operation finishes while the second progress response is pending.
  connected.resolve({
    state: "ready",
    source: { kind: "directory", id: "browser-scan-folder", name: "Notes" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reads).toHaveLength(2);

  reads[1]!.result.resolve(progress("reading", ["b.note.md"], 2));
  await vi.waitFor(() => expect(reads).toHaveLength(3));
  expect(reads[2]!.message).toMatchObject({ id: "current-scan", after: 2 });
  expect(root.querySelector('[aria-label="Use found notes"]')).toBe(stopButton);
  expect(root.querySelector(".browser-scan__found summary")).toBe(foundControl);
  expect(
    [...root.querySelectorAll(".browser-scan__found li")].map(
      (row) => row.textContent,
    ),
  ).toEqual(["a.note.md", "b.note.md"]);

  reads[2]!.result.resolve(progress("complete", ["c.note.md"], 3));
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>(".browser-scan")!.hidden).toBe(true),
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(reads).toHaveLength(3);
});
