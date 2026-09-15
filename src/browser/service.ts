import { normalizePageUrl } from "./library";
import { BrowserVault } from "./vault-store";
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

export function createBrowserService(api: BrowserApi) {
  let lockGeneration = 0;
  // Only this worker writes the library. Panels never write storage directly.
  // Restrict access before any operation, not only during installation.
  const ready = Promise.all([
    api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    api.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  // Attach a rejection handler immediately; operations still fail closed on ready.
  void ready.catch(() => {});
  const vault = new BrowserVault({
    async readLocal() {
      await ready;
      return (await api.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY];
    },
    async writeLocal(envelope) {
      await ready;
      await api.storage.local.set({ [LIBRARY_KEY]: envelope });
    },
    async readSession() {
      await ready;
      return (await api.storage.session.get(SESSION_KEY))[SESSION_KEY];
    },
    async writeSession(session) {
      await ready;
      await api.storage.session.set({ [SESSION_KEY]: session });
    },
    async clearSession() {
      await ready;
      await api.storage.session.remove(SESSION_KEY);
    },
  });
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
    switch (message.type) {
      case "status":
        return vault.status();
      case "setup":
        return vault.setup(message.password);
      case "unlock":
        return vault.unlock(message.password);
      case "lock": {
        lockGeneration += 1;
        return vault.lock();
      }
      case "load":
        return vault.run((store) => store.load());
      case "context":
        return context(message.windowId, message.allowPrivate === true);
      case "visit": {
        const page = await context(
          message.windowId,
          message.allowPrivate === true,
        );
        return vault.run((store) =>
          page
            ? store.visit({ url: page.url, title: page.title })
            : store.load(),
        );
      }
      case "create": {
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        return vault.run(async (store) => {
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
      case "save":
        return vault.run((store) =>
          store.save(message.id, message.markdown, message.revision),
        );
      case "delete-page":
        return vault.run((store) =>
          store.deletePage(message.url, message.expectedNote),
        );
      case "create-domain": {
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        return vault.run((store) =>
          store.createDomain(new URL(page.url).origin, message.markdown),
        );
      }
      case "save-domain":
        return vault.run((store) =>
          store.saveDomain(message.id, message.markdown, message.revision),
        );
      case "import":
        return vault.importBackup(message.text, message.password);
      case "export":
        return vault.exportBackup();
      case "capture": {
        const generation = lockGeneration;
        // Require unlock even though capture only reads an explicitly selected page.
        await vault.run((store) => store.load());
        const page = await requireCurrent(
          message.page,
          message.allowPrivate === true,
        );
        if (!["page", "selection"].includes(message.mode))
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
        // A Lock while the page was being captured invalidates the operation.
        await vault.run((store) => store.load());
        if (generation !== lockGeneration)
          throw new BrowserActionError(
            "Import cancelled because AIC was locked.",
          );
        return result.result;
      }
      case "navigate": {
        const generation = lockGeneration;
        const url = normalizePageUrl(message.url);
        // Only navigate to known library/history URLs, never arbitrary input from a webpage.
        const library = await vault.run((store) => store.load());
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
            "Allow AIC in this private window before opening saved pages. Its encrypted notes and history persist after the window closes.",
          );
        if (generation !== lockGeneration)
          throw new BrowserActionError(
            "Navigation cancelled because AIC was locked.",
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
