import type { BrowserApi } from "./api";

export function initializeSidebar(api: BrowserApi): () => void {
  const panel = api.sidePanel;
  if (!panel?.setPanelBehavior)
    throw new Error("AIC requires the Chromium side panel API.");
  const configure = () => {
    void panel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) => {
        console.error("AIC could not enable the browser side panel.", error);
      });
  };
  api.runtime.onInstalled.addListener(configure);
  configure();
  return () => api.runtime.onInstalled.removeListener(configure);
}
