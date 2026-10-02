import {
  BrowserMarkdownStorage,
  type BrowserSourceBindings,
  type BrowserStatus,
} from "./markdown-storage";
import { BrowserFileError } from "./file-errors";
import { BrowserDraftRecovery } from "./recovery-store";
import { LibraryStore, normalizePageUrl } from "./library";
import { capturePage } from "./capture-page";
import type { ActivePage, BrowserApi, BrowserTab, Request } from "./api";

export const LIBRARY_KEY = "aic-browser-library";
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
  // Only this worker writes the library. Panels never write storage directly.
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
    const scan = files.scanStatus().scan ?? undefined;
    if (source.kind === "unselected")
      return { state: "unselected", source, scan };
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
        warnings: [...files.warnings],
        scan: files.scanStatus().scan ?? undefined,
      };
    } catch (error) {
      return {
        state: "unavailable",
        source,
        sourceErrorCode:
          error instanceof BrowserFileError ? error.code : "storage",
        scan: files.scanStatus().scan ?? undefined,
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
    const run = <T>(
      operation: (store: LibraryStore) => Promise<T>,
      persist = true,
    ) =>
      queued(async () => {
        await ready;
        await files.assertSource(message.sourceId);
        let current = await files.read(false);
        let changed = false;
        const store = new LibraryStore({
          read: async () => current,
          write: async (next) => {
            if (persist) {
              await files.write(next);
              changed = true;
            }
            current = next;
          },
        });
        const result = await operation(store);
        if (changed && result && typeof result === "object" && "id" in result) {
          const saved = files.snapshot();
          const record = [
            ...saved.notes,
            ...saved.domains,
            ...(saved.global ? [saved.global] : []),
          ].find((item) => item.id === result.id);
          if (record) return record as T;
        }
        return result;
      });
    switch (message.type) {
      case "scan-status":
        await ready;
        return files.scanStatus(message.id, message.after);
      case "cancel-scan":
        await ready;
        return files.cancelScan(message.id);
      case "refresh-files":
        return queued(async () => {
          await ready;
          await files.assertSource(message.sourceId);
          await files.read(true);
          return status();
        });
      case "status":
        return queued(status);
      case "connect-source":
        return queued(async () => {
          await ready;
          await files.assertSource(message.sourceId);
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
        return run((store) => store.load());
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
      case "visit": {
        const page = await context(
          message.windowId,
          message.allowPrivate === true,
        );
        return run(
          (store) =>
            page
              ? store.visit({ url: page.url, title: page.title })
              : store.load(),
          false,
        );
      }
      case "create": {
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        return run(async (store) => {
          if (message.ifAbsent === true)
            return store.create(
              { url: page.url, title: page.title },
              message.markdown,
              { ifAbsent: true },
            );
          const existing = (await store.load()).notes.find(
            (note) => note.url === page.url,
          );
          // Two panels may explicitly import into the same previously unnoted URL.
          // Serialize the append with the vault write; never discard the second import.
          if (
            existing &&
            typeof message.markdown === "string" &&
            message.markdown.length
          )
            return store.save(
              existing.id,
              `${existing.markdown}${existing.markdown ? "\n\n" : ""}${message.markdown}`,
              existing.revision,
            );
          return store.create(
            { url: page.url, title: page.title },
            message.markdown,
          );
        });
      }
      case "create-file":
        return run((store) => store.createFile(message.path, message.markdown));
      case "link-file": {
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        return run((store) =>
          store.linkFile(message.id, { url: page.url, title: page.title }),
        );
      }
      case "save":
        return run((store) =>
          store.save(message.id, message.markdown, message.revision),
        );
      case "delete-page":
        return run((store) =>
          store.deletePage(message.url, message.expectedNote),
        );
      case "create-domain": {
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        return run((store) =>
          store.createDomain(new URL(page.url).origin, message.markdown),
        );
      }
      case "save-domain":
        return run((store) =>
          store.saveDomain(message.id, message.markdown, message.revision),
        );
      case "create-global":
        return run((store) => store.createGlobal(message.markdown));
      case "save-global":
        return run((store) =>
          store.saveGlobal(message.id, message.markdown, message.revision),
        );
      case "capture": {
        const generation = sourceGeneration;
        await run((store) => store.load());
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
        await run((store) => store.load());
        if (generation !== sourceGeneration)
          throw new BrowserActionError(
            "Import cancelled because the selected files changed.",
          );
        return result.result;
      }
      case "navigate": {
        const generation = sourceGeneration;
        const url = normalizePageUrl(message.url);
        // Only navigate to known library/history URLs, never arbitrary input from a webpage.
        const library = await run((store) => store.load());
        if (
          ![...library.notes, ...library.history].some(
            (item) => item.url === url,
          )
        )
          throw new BrowserActionError(
            "This page is not in your local AIC library.",
          );
        if (!Number.isInteger(message.windowId) || message.windowId < 0)
          throw new BrowserActionError("Browser window is unavailable.");
        const tabs = await api.tabs.query({ windowId: message.windowId });
        if (tabs.some((tab) => tab.incognito) && message.allowPrivate !== true)
          throw new BrowserActionError(
            "Allow AIC in this private window before opening saved pages. Notes in your files persist after the window closes.",
          );
        if (generation !== sourceGeneration)
          throw new BrowserActionError(
            "Navigation cancelled because the selected files changed.",
          );
        const existing = tabs.find((tab) => tab.url === url);
        if (existing?.id !== undefined)
          await api.tabs.update(existing.id, { active: true });
        // Keep the current page intact, including any unsaved website form.
        else await api.tabs.create({ url, windowId: message.windowId });
        return null;
      }
      default:
        throw new BrowserActionError("Unsupported AIC request.");
    }
  }
  return { handle };
}
