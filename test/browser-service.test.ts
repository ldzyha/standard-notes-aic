import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createBrowserService,
  LIBRARY_KEY,
  SESSION_KEY,
} from "../src/browser/service";
import type { ActivePage, BrowserApi } from "../src/browser/api";
import type {
  BrowserNote,
  BrowserDomain,
  BrowserLibrary,
} from "../src/browser/library";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const password = "Synthetic master phrase!";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

function harness() {
  let disk: Record<string, unknown> = {};
  let session: Record<string, unknown> = {};
  let active = {
    id: 7,
    windowId: 1,
    url: "https://example.test/wiki/page?id=2#part",
    title: "Synthetic page",
    incognito: false,
  };
  const api = {
    storage: {
      local: {
        get: vi.fn(async () => structuredClone(disk)),
        set: vi.fn(async (value) => {
          disk = structuredClone(value);
        }),
        setAccessLevel: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => structuredClone(session)),
        set: vi.fn(async (value) => {
          session = structuredClone(value);
        }),
        remove: vi.fn(async (key: string) => {
          delete session[key];
        }),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    tabs: {
      query: vi.fn(async () => [active]),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            url: active.url,
            title: active.title,
            html: "<p>Synthetic</p>",
            truncated: false,
          },
        },
      ]),
    },
  };
  const service = createBrowserService(api as unknown as BrowserApi);
  const page = (): ActivePage => ({
    url: active.url,
    title: active.title,
    tabId: active.id,
    windowId: active.windowId,
  });
  return {
    api,
    service,
    page,
    disk: () => disk,
    session: () => session,
    change: (value: Partial<typeof active>) => {
      active = { ...active, ...value };
    },
  };
}

describe("browser service encrypted boundaries", () => {
  it("deletes a local note and its history through one encrypted write without touching the website", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const page = h.page();
    const note = (await h.service.handle({
      type: "create",
      page,
      markdown: "Delete local note",
    })) as BrowserNote;
    await h.service.handle({ type: "visit", windowId: 1 });
    await h.service.handle({
      type: "create-domain",
      page,
      markdown: "```aic\n# Properties\nShared | keep\n```\n",
    });
    h.change({ url: "https://other.test/" });
    await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "Unrelated note",
    });
    await h.service.handle({ type: "visit", windowId: 1 });
    const before = (await h.service.handle({ type: "load" })) as BrowserLibrary;
    const writes = h.api.storage.local.set.mock.calls.length;
    const result = await h.service.handle({
      type: "delete-page",
      url: page.url,
      expectedNote: { id: note.id, revision: note.revision },
    });
    expect(result).toEqual({
      ...before,
      notes: before.notes.filter((item) => item.id !== note.id),
      history: before.history.filter((item) => item.url !== note.url),
    });
    expect(h.api.storage.local.set).toHaveBeenCalledTimes(writes + 1);
    expect(await h.service.handle({ type: "load" })).toEqual(result);
    expect(h.disk()[LIBRARY_KEY]).toMatchObject({
      format: "aic-browser-vault",
    });
    expect(JSON.stringify(h.disk())).not.toContain("Unrelated note");
    expect(h.api.tabs.create).not.toHaveBeenCalled();
    expect(h.api.tabs.update).not.toHaveBeenCalled();
    expect(h.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("protects newer edits and concurrent creation from stale deletion requests", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    await h.service.handle({ type: "visit", windowId: 1 });
    const note = (await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "Original",
    })) as BrowserNote;
    const result = await Promise.allSettled([
      h.service.handle({
        type: "save",
        id: note.id,
        markdown: "Newer",
        revision: 1,
      }),
      h.service.handle({
        type: "delete-page",
        url: note.url,
        expectedNote: { id: note.id, revision: 1 },
      }),
    ]);
    expect(result.map((item) => item.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((result[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    h.change({ url: "https://new.test/" });
    let releaseWrite!: () => void;
    let startedWrite!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      startedWrite = resolve;
    });
    const write = h.api.storage.local.set.getMockImplementation()!;
    h.api.storage.local.set.mockImplementationOnce(async (value) => {
      startedWrite();
      await blockedWrite;
      await write(value);
    });
    const creating = h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "New",
    });
    await writing;
    const deletion = expect(
      h.service.handle({
        type: "delete-page",
        url: h.page().url,
        expectedNote: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    releaseWrite();
    await creating;
    await deletion;
    expect(await h.service.handle({ type: "load" })).toMatchObject({
      notes: [
        { id: note.id, markdown: "Newer", revision: 2 },
        { markdown: "New" },
      ],
      history: [{ url: note.url }],
    });
  });

  it("requires unlock and preserves encrypted data when deletion storage fails", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    await h.service.handle({ type: "visit", windowId: 1 });
    const before = await h.service.handle({ type: "load" });
    const disk = structuredClone(h.disk());
    const deleting = {
      type: "delete-page",
      url: h.page().url,
      expectedNote: null,
    };
    h.api.storage.local.set.mockRejectedValueOnce(new Error("Storage detail"));
    await expect(h.service.handle(deleting)).rejects.toMatchObject({
      code: "storage",
    });
    expect(h.disk()).toEqual(disk);
    expect(await h.service.handle({ type: "load" })).toEqual(before);
    await h.service.handle({ type: "lock" });
    await expect(h.service.handle(deleting)).rejects.toMatchObject({
      code: "locked",
    });
    expect(h.disk()).toEqual(disk);
    await h.service.handle({ type: "unlock", password });
    expect(await h.service.handle(deleting)).toMatchObject({
      notes: [],
      history: [],
      domains: [],
    });
  });

  it("derives shared origin from the active page and saves that identity after navigation", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const markdown =
      "```aic\n# Properties\nPassword *| synthetic-domain-secret\n```\n";
    const page = h.page();
    const domain = (await h.service.handle({
      type: "create-domain",
      page,
      markdown,
      origin: "https://forged.test",
    })) as BrowserDomain;
    expect(domain.origin).toBe("https://example.test");
    await expect(
      h.service.handle({ type: "create-domain", page, markdown }),
    ).rejects.toMatchObject({ code: "conflict" });
    h.change({ url: "https://other.test/" });
    await expect(
      h.service.handle({ type: "create-domain", page, markdown }),
    ).rejects.toThrow("active page changed");
    const saved = (await h.service.handle({
      type: "save-domain",
      id: domain.id,
      markdown,
      revision: 1,
    })) as BrowserDomain;
    expect(saved).toMatchObject({ origin: domain.origin, revision: 2 });
    await expect(
      h.service.handle({
        type: "save-domain",
        id: domain.id,
        markdown,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const library = (await h.service.handle({
      type: "load",
    })) as BrowserLibrary;
    expect(library.notes).toEqual([]);
    expect(library.domains).toEqual([saved]);
    expect(JSON.stringify(h.disk())).not.toContain("synthetic-domain-secret");
    expect(JSON.stringify(h.disk())).not.toContain(domain.origin);
    h.change({ incognito: true });
    await expect(
      h.service.handle({ type: "create-domain", page: h.page(), markdown }),
    ).rejects.toThrow("active page changed");
    await h.service.handle({ type: "lock" });
    await expect(
      h.service.handle({
        type: "save-domain",
        id: domain.id,
        markdown,
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: "locked" });
  });

  it("requires setup, restricts session access, creates and visits exact page without plaintext on disk", async () => {
    const h = harness();
    expect(await h.service.handle({ type: "status" })).toEqual({
      state: "setup",
    });
    await expect(h.service.handle({ type: "load" })).rejects.toMatchObject({
      code: "locked",
    });
    await h.service.handle({ type: "setup", password });
    const note = (await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "Synthetic secret value",
    })) as BrowserNote;
    expect(note.url).toBe(h.page().url);
    const visited = await h.service.handle({ type: "visit", windowId: 1 });
    expect(visited).toMatchObject({ history: [{ url: h.page().url }] });
    for (const text of [password, note.markdown, note.url, note.title])
      expect(JSON.stringify(h.disk())).not.toContain(text);
    expect(Object.keys(h.disk())).toEqual([LIBRARY_KEY]);
    expect(Object.keys(h.session())).toEqual([SESSION_KEY]);
    expect(h.api.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(h.api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    const restartedWorker = createBrowserService(
      h.api as unknown as BrowserApi,
    );
    expect(await restartedWorker.handle({ type: "status" })).toEqual({
      state: "unlocked",
    });
    await restartedWorker.handle({ type: "lock" });
    expect(h.session()).toEqual({});
    await expect(h.service.handle({ type: "load" })).rejects.toMatchObject({
      code: "locked",
    });
  });

  it("rejects stale page context, incognito pages and unknown navigation", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const page = h.page();
    h.change({ url: "https://other.test/" });
    await expect(
      h.service.handle({ type: "create", page, markdown: "Wrong page" }),
    ).rejects.toThrow("active page changed");
    await expect(
      h.service.handle({
        type: "navigate",
        windowId: 1,
        url: "https://unknown.test/",
      }),
    ).rejects.toThrow("not in your local");
    h.change({ incognito: true });
    expect(await h.service.handle({ type: "context", windowId: 1 })).toBeNull();
    expect(h.api.tabs.create).not.toHaveBeenCalled();
  });

  it("cancels pending capture when Lock happens, even if immediately unlocked again", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    let finish!: (value: any) => void;
    const pending = new Promise<any>((resolve) => {
      finish = resolve;
    });
    h.api.scripting.executeScript.mockReturnValueOnce(pending);
    const capturing = h.service.handle({
      type: "capture",
      page: h.page(),
      mode: "page",
    });
    const assertion = expect(capturing).rejects.toThrow("cancelled");
    await vi.waitFor(() =>
      expect(h.api.scripting.executeScript).toHaveBeenCalled(),
    );
    await h.service.handle({ type: "lock" });
    await h.service.handle({ type: "unlock", password });
    finish([
      {
        result: {
          url: h.page().url,
          title: "Old capture",
          html: "<p>stale</p>",
          truncated: false,
        },
      },
    ]);
    await assertion;
  });

  it("rejects capture if the active tab changes before or during injection", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const original = h.page();
    h.change({ id: 8 });
    await expect(
      h.service.handle({ type: "capture", page: original, mode: "page" }),
    ).rejects.toThrow("active page changed");
    expect(h.api.scripting.executeScript).not.toHaveBeenCalled();

    h.change({ id: original.tabId });
    let finish!: (value: any) => void;
    h.api.scripting.executeScript.mockReturnValueOnce(
      new Promise<any>((resolve) => {
        finish = resolve;
      }),
    );
    const capturing = h.service.handle({
      type: "capture",
      page: original,
      mode: "selection",
    });
    const assertion = expect(capturing).rejects.toThrow("active page changed");
    await vi.waitFor(() =>
      expect(h.api.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: original.tabId },
        func: expect.any(Function),
        args: ["selection"],
      }),
    );
    h.change({ url: "https://other.test/" });
    finish([
      {
        result: {
          url: original.url,
          title: original.title,
          html: "<p>Old page</p>",
          truncated: false,
        },
      },
    ]);
    await assertion;
  });

  it("opens known destinations without writing the source page or navigating while locked", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const url = h.page().url;
    await h.service.handle({ type: "visit", windowId: 1 });
    await h.service.handle({ type: "navigate", windowId: 1, url });
    expect(h.api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    h.change({ url: "https://other.test/" });
    await h.service.handle({ type: "navigate", windowId: 1, url });
    expect(h.api.tabs.create).toHaveBeenCalledWith({ url, windowId: 1 });
    await h.service.handle({ type: "lock" });
    await expect(
      h.service.handle({ type: "navigate", windowId: 1, url }),
    ).rejects.toMatchObject({ code: "locked" });
    expect(h.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("requires explicit private-window consent for context, capture, persistence and navigation", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    h.change({ incognito: true });
    expect(await h.service.handle({ type: "context", windowId: 1 })).toBeNull();
    expect(
      await h.service.handle({ type: "visit", windowId: 1 }),
    ).toMatchObject({ history: [] });
    await expect(
      h.service.handle({
        type: "create",
        page: h.page(),
        markdown: "Private synthetic note",
      }),
    ).rejects.toThrow("active page changed");
    await expect(
      h.service.handle({ type: "capture", page: h.page(), mode: "page" }),
    ).rejects.toThrow("active page changed");
    expect(h.api.scripting.executeScript).not.toHaveBeenCalled();
    expect(
      await h.service.handle({
        type: "context",
        windowId: 1,
        allowPrivate: true,
      }),
    ).toEqual(h.page());
    await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "Private synthetic note",
      allowPrivate: true,
    });
    expect(
      await h.service.handle({
        type: "visit",
        windowId: 1,
        allowPrivate: true,
      }),
    ).toMatchObject({ history: [{ url: h.page().url }] });
    expect(
      await h.service.handle({
        type: "capture",
        page: h.page(),
        mode: "page",
        allowPrivate: true,
      }),
    ).toMatchObject({ html: "<p>Synthetic</p>" });
    await expect(
      h.service.handle({ type: "navigate", windowId: 1, url: h.page().url }),
    ).rejects.toThrow("private window");
    expect(h.api.tabs.update).not.toHaveBeenCalled();
    await h.service.handle({
      type: "navigate",
      windowId: 1,
      url: h.page().url,
      allowPrivate: true,
    });
    expect(h.api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    // Consent is per request/panel, never a persisted blanket allowance.
    expect(await h.service.handle({ type: "context", windowId: 1 })).toBeNull();
    expect(JSON.stringify(h.disk())).not.toContain("Private synthetic note");
  });

  it("bounds page titles by Unicode characters before encrypting history", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    h.change({ title: "😀".repeat(2000) });
    const page = (await h.service.handle({
      type: "context",
      windowId: 1,
    })) as ActivePage;
    expect(Array.from(page.title)).toHaveLength(256);
    await expect(
      h.service.handle({ type: "visit", windowId: 1 }),
    ).resolves.toMatchObject({ history: [{ title: page.title }] });
  });

  it("atomically retains concurrent first imports and leaves empty Create idempotent", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    await Promise.all(
      ["First import", "Second import"].map((markdown) =>
        h.service.handle({ type: "create", page: h.page(), markdown }),
      ),
    );
    const note = await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "",
    });
    expect(note).toMatchObject({
      markdown: "First import\n\nSecond import",
      revision: 2,
    });
  });

  it("does not append a provisional draft onto a note created elsewhere", async () => {
    const h = harness();
    await h.service.handle({ type: "setup", password });
    const first = (await h.service.handle({
      type: "create",
      page: h.page(),
      markdown: "Existing",
    })) as BrowserNote;
    await expect(
      h.service.handle({
        type: "create",
        page: h.page(),
        markdown: "Unsaved local draft",
        ifAbsent: true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await h.service.handle({ type: "load" })).toMatchObject({
      notes: [first],
    });
  });
});
