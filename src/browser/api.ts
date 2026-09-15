import type { PageContext, PageNoteExpectation } from "./library";
import type { capturePage } from "./capture-page";

export type BrowserTab = {
  id?: number;
  windowId: number;
  url?: string;
  title?: string;
  active?: boolean;
  incognito?: boolean;
};
export type ActivePage = PageContext & { tabId: number; windowId: number };
type Listener<T extends unknown[]> = {
  addListener(fn: (...args: T) => unknown): void;
  removeListener(fn: (...args: T) => unknown): void;
};
export type MessageSender = { id?: string; url?: string; tab?: BrowserTab };
export type BrowserApi = {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage<T>(message: Request): Promise<Reply<T>>;
    onMessage: Listener<
      [unknown, MessageSender, (reply: Reply<unknown>) => void]
    >;
    onInstalled: Listener<[]>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      setAccessLevel(options: {
        accessLevel: "TRUSTED_CONTEXTS";
      }): Promise<void>;
    };
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
      setAccessLevel(options: {
        accessLevel: "TRUSTED_CONTEXTS";
      }): Promise<void>;
    };
    onChanged: Listener<[Record<string, unknown>, string]>;
  };
  tabs: {
    query(query: {
      active?: boolean;
      windowId?: number;
    }): Promise<BrowserTab[]>;
    get(id: number): Promise<BrowserTab>;
    update(
      id: number,
      update: { active?: boolean; url?: string },
    ): Promise<BrowserTab>;
    create(options: { url: string; windowId: number }): Promise<BrowserTab>;
    onActivated: Listener<[{ tabId: number; windowId: number }]>;
    onUpdated: Listener<
      [number, { url?: string; title?: string; status?: string }, BrowserTab]
    >;
    onRemoved: Listener<[number, { windowId: number }]>;
  };
  windows: { getCurrent(): Promise<{ id?: number; incognito?: boolean }> };
  permissions: { request(options: { origins: string[] }): Promise<boolean> };
  sidePanel: {
    setPanelBehavior(options: {
      openPanelOnActionClick: boolean;
    }): Promise<void>;
  };
  scripting: {
    executeScript(options: {
      target: { tabId: number };
      func: typeof capturePage;
      args: ["auto" | "page" | "selection"];
    }): Promise<{ result?: ReturnType<typeof capturePage> }[]>;
  };
};

export type Request =
  | { type: "status" }
  | { type: "setup"; password: string }
  | { type: "unlock"; password: string }
  | { type: "lock" }
  | { type: "load" }
  | { type: "context"; windowId: number; allowPrivate?: boolean }
  | { type: "visit"; windowId: number; allowPrivate?: boolean }
  | {
      type: "create";
      page: ActivePage;
      markdown: string;
      allowPrivate?: boolean;
      ifAbsent?: boolean;
    }
  | { type: "save"; id: string; markdown: string; revision: number }
  | { type: "delete-page"; url: string; expectedNote: PageNoteExpectation }
  | {
      type: "create-domain";
      page: ActivePage;
      markdown: string;
      allowPrivate?: boolean;
    }
  | { type: "save-domain"; id: string; markdown: string; revision: number }
  | {
      type: "capture";
      page: ActivePage;
      mode: "auto" | "page" | "selection";
      allowPrivate?: boolean;
    }
  | { type: "navigate"; windowId: number; url: string; allowPrivate?: boolean }
  | { type: "import"; text: string; password: string }
  | { type: "export" };
export type Reply<T> =
  { ok: true; value: T } | { ok: false; error: string; code?: string };

export function getBrowserApi(): BrowserApi {
  const chromium = (globalThis as unknown as { chrome?: BrowserApi }).chrome;
  if (!chromium?.runtime?.id)
    throw new Error("Open AIC from the browser extension toolbar.");
  if (
    typeof chromium.storage?.local?.get !== "function" ||
    typeof chromium.storage?.local?.set !== "function" ||
    typeof chromium.storage?.local?.setAccessLevel !== "function" ||
    typeof chromium.storage?.session?.get !== "function" ||
    typeof chromium.storage?.session?.set !== "function" ||
    typeof chromium.storage?.session?.remove !== "function" ||
    typeof chromium.storage?.session?.setAccessLevel !== "function"
  )
    throw new Error(
      "AIC requires trusted-only local storage and in-memory session storage (Chromium 140 or newer). The vault cannot start safely.",
    );
  if (typeof chromium.sidePanel?.setPanelBehavior !== "function")
    throw new Error("AIC requires the Chromium side panel API.");
  return chromium;
}

export async function request<T>(
  api: BrowserApi,
  message: Request,
): Promise<T> {
  const reply = await api.runtime.sendMessage<T>(message);
  if (!reply?.ok)
    throw Object.assign(
      new Error(reply?.error || "AIC could not complete this action."),
      { code: reply?.code },
    );
  return reply.value;
}
