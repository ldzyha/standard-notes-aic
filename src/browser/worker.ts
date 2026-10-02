import { BrowserFileError } from "./file-errors";
import { getBrowserApi } from "./api";
import { BrowserActionError, createBrowserService } from "./service";
import { LibraryError } from "./library";
import { initializeSidebar } from "./platform";

export function startBrowserWorker(api = getBrowserApi()): () => void {
  const service = createBrowserService(api);
  const onMessage: Parameters<typeof api.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    respond,
  ) => {
    // Only our exact editor page, in the side panel or a normal top-level tab.
    // The tab is an explicit permission fallback for older Chromium side panels.
    const editorUrl = api.runtime.getURL("browser/index.html");
    if (
      sender.id !== api.runtime.id ||
      sender.url !== editorUrl ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      (sender.tab !== undefined &&
        (sender.tab.incognito === true ||
          !Number.isSafeInteger(sender.tab.id) ||
          (sender.tab.id ?? -1) < 0 ||
          !Number.isSafeInteger(sender.tab.windowId) ||
          sender.tab.windowId < 0 ||
          (sender.tab.url !== undefined && sender.tab.url !== editorUrl)))
    )
      return false;
    void service.handle(message).then(
      (value) => respond({ ok: true, value }),
      (error: unknown) => {
        const recognized =
          error instanceof BrowserFileError ||
          error instanceof LibraryError ||
          error instanceof BrowserActionError;
        respond({
          ok: false,
          error: recognized
            ? error.message
            : "AIC could not complete this action. Check the current page and retry.",
          code: recognized ? error.code : "action",
        });
      },
    );
    return true;
  };
  api.runtime.onMessage.addListener(onMessage);
  const disposeSidebar = initializeSidebar(api);
  return () => {
    api.runtime.onMessage.removeListener(onMessage);
    disposeSidebar();
  };
}

startBrowserWorker();
