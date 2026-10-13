import {
  BrowserMarkdownStorage,
  type BrowserSourceBindings,
  type BrowserStatus,
} from "./markdown-storage";
import { BrowserFileError } from "./file-errors";
import { BrowserDraftRecovery } from "./recovery-store";
import { normalizePageUrl } from "./library";
import { capturePage } from "./capture-page";
import type { ActivePage, BrowserApi, BrowserTab, Request } from "./api";

export const SESSION_KEY = "aic-browser-unlock";

export class BrowserActionError extends Error {
  readonly code = "action";
}

function pageFromTab(
  tab: BrowserTab | undefined,
  allowPrivate = false,
): ActivePage | null {
  if (!tab?.url || tab.id === undefined || (tab.incognito && !allowPrivate))
    return null;
  try {
    const url = normalizePageUrl(tab.url);
    return {
      url,
      title: Array.from(tab.title || new URL(url).hostname)
        .slice(0, 256)
        .join(""),
      tabId: tab.id,
      windowId: tab.windowId,
    };
  } catch {
    return null;
  }
}

export function createBrowserService(
  api: BrowserApi,
  bindings?: BrowserSourceBindings,
) {
  const files = new BrowserMarkdownStorage(api.storage.local, bindings);
  const recovery = new BrowserDraftRecovery(api.storage.local);
  let sourceGeneration = 0;
  // Only this worker writes the note file. Panels never write storage directly.
  // Restrict access before any operation, not only during installation.
  const ready = api.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  // Attach a rejection handler immediately; operations still fail closed on ready.
  void ready.catch(() => {});
  let tail: Promise<unknown> = Promise.resolve();
  const queued = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => {});
    return next;
  };
  const status = async (): Promise<BrowserStatus> => {
    await ready;
    const source = await files.location();
    if (source.kind === "unselected") return { state: "unselected", source };
    try {
      let access = await files.access();
      if (access.read !== "granted")
        return {
          state: "unavailable",
          source,
          access,
          sourceErrorCode: "permission",
          sourceError: "Continue to allow access to your remembered files.",
        };
      await files.read(false);
      access = await files.access();
      return {
        state: "ready",
        source,
        access,
        ...(access.write !== "granted"
          ? {
              sourceErrorCode: "permission",
              sourceError:
                "Allow file editing to save changes. Reconnect files; your draft is unchanged.",
            }
          : {}),
        ...(files.legacyNotes ? { legacyNotes: true as const } : {}),
      };
    } catch (error) {
      return {
        state: "unavailable",
        source,
        sourceErrorCode:
          error instanceof BrowserFileError ? error.code : "storage",
        sourceError:
          error instanceof Error
            ? error.message
            : "Reconnect the original files.",
      };
    }
  };
  const context = async (windowId: number, allowPrivate = false) => {
    if (!Number.isInteger(windowId) || windowId < 0)
      throw new BrowserActionError("Browser window is unavailable.");
    return pageFromTab(
      (await api.tabs.query({ active: true, windowId }))[0],
      allowPrivate,
    );
  };
  const requireCurrent = async (page: ActivePage, allowPrivate = false) => {
    const current = await context(page?.windowId, allowPrivate);
    if (!current || current.tabId !== page.tabId || current.url !== page.url)
      throw new BrowserActionError(
        "The active page changed. Retry from its AIC panel.",
      );
    return current;
  };

  async function handle(input: unknown): Promise<unknown> {
    if (!input || typeof input !== "object" || !("type" in input))
      throw new BrowserActionError("Invalid AIC request.");
    const message = input as Request;
    const run = <T>(operation: () => Promise<T>) =>
      queued(async () => {
        await ready;
        await files.assertSource(message.sourceId);
        return operation();
      });
    switch (message.type) {
      case "status":
        return queued(status);
      case "connect-source":
        return run(async () => {
          if (message.mode === "migrate")
            throw new BrowserActionError(
              "Open a Markdown file or folder. Encrypted libraries are not supported.",
            );
          await files.connect(message.bindingId);
          sourceGeneration += 1;
          return status();
        });
      case "setup":
      case "unlock":
      case "lock":
      case "import":
      case "export":
        throw new BrowserActionError(
          "AIC edits Markdown files directly. Passwords and encrypted libraries are not supported.",
        );
      case "load":
        // Read the note file again so a change made on disk reaches the panel.
        return run(() => files.read(true));
      case "save":
        return run(async () => {
          await files.read(false);
          return files.save(message.id, message.markdown, message.revision);
        });
      case "checkpoint-drafts":
      case "list-recovery":
      case "dismiss-recovery": {
        if (!message.sourceId)
          throw new BrowserFileError(
            "source",
            "Choose a notes file before keeping a recovery copy.",
          );
        const sourceId = message.sourceId;
        await ready;
        await files.assertSource(sourceId);
        if (message.type === "checkpoint-drafts") {
          return recovery.checkpoint(
            sourceId,
            message.clientId,
            message.sequence,
            message.entries,
          );
        }
        if (message.type === "list-recovery") return recovery.list(sourceId);
        return recovery.dismiss(sourceId, message.clientId, message.sequence);
      }
      case "context":
        return context(message.windowId, message.allowPrivate === true);
      case "capture": {
        const generation = sourceGeneration;
        await run(() => files.read(false));
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        if (!["auto", "page", "selection"].includes(message.mode))
          throw new BrowserActionError("Choose a page or selection to import.");
        let result;
        try {
          [result] = await api.scripting.executeScript({
            target: { tabId: page.tabId },
            func: capturePage,
            args: [message.mode],
          });
        } catch {
          throw new BrowserActionError(
            "Cannot read this page. Allow site access, select text if needed, and retry. Browser-protected pages cannot be imported.",
          );
        }
        await requireCurrent(page, message.allowPrivate === true);
        if (!result?.result || result.result.url !== page.url)
          throw new BrowserActionError(
            "The page changed during import. Retry on the intended page.",
          );
        await run(() => files.read(false));
        if (generation !== sourceGeneration)
          throw new BrowserActionError(
            "Import cancelled because the selected files changed.",
          );
        return result.result;
      }
      default:
        throw new BrowserActionError("Unsupported AIC request.");
    }
  }
  return { handle };
}
