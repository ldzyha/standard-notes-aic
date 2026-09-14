import { getBrowserApi } from "./api";
import { BrowserActionError, createBrowserService } from "./service";
import { LibraryError } from "./library";
import { VaultError } from "./vault-crypto";
import { VaultStateError } from "./vault-store";
import { initializeSidebar } from "./platform";

export function startBrowserWorker(api = getBrowserApi()): () => void {
  const service = createBrowserService(api);
  const onMessage: Parameters<typeof api.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    respond,
  ) => {
    // No externally_connectable API and no content-script access to notes.
    if (
      sender.id !== api.runtime.id ||
      sender.tab ||
      sender.url !== api.runtime.getURL("browser/index.html")
    )
      return false;
    void service.handle(message).then(
      (value) => respond({ ok: true, value }),
      (error: unknown) => {
        const recognized =
          error instanceof LibraryError ||
          error instanceof VaultError ||
          error instanceof VaultStateError ||
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
