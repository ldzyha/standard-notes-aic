import type {
  BrowserMarkdownFile,
  BrowserMarkdownHandle,
  BrowserSourceBindings,
} from "../../src/browser/markdown-storage";

/** The one note file; `root` is its handle. Other paths are bystander files. */

export function markdownFixture(initial: Record<string, string> = {}) {
  const entries = new Map<
    string,
    {
      text: string;
      writes: number;
      closes: number;
      failClose: boolean;
      beforeClose?: () => Promise<void>;
    }
  >();
  const state = { allowed: true };
  const locks = new Set<string>();
  const absent = () =>
    new DOMException("Synthetic missing file", "NotFoundError");
  const put = (path: string, text: string) => {
    const current = entries.get(path);
    entries.set(
      path,
      current
        ? { ...current, text }
        : { text, writes: 0, closes: 0, failClose: false },
    );
  };
  const permissions = {
    async queryPermission(): Promise<PermissionState> {
      return state.allowed ? "granted" : "denied";
    },
    async requestPermission(): Promise<PermissionState> {
      state.allowed = true;
      return "granted";
    },
  };
  const file = (path: string): BrowserMarkdownFile => ({
    kind: "file",
    name: path.split("/").at(-1)!,
    ...permissions,
    async getFile() {
      const value = entries.get(path);
      if (!value) throw absent();
      const text = value.text;
      return {
        size: new TextEncoder().encode(text).length,
        text: async () => text,
        lastModified: 1,
      };
    },
    async createWritable(options) {
      const value = entries.get(path);
      if (!value) throw absent();
      if (options?.mode === "exclusive" && locks.has(path))
        throw new DOMException(
          "Synthetic writer already open",
          "NoModificationAllowedError",
        );
      locks.add(path);
      let pending = value.text;
      return {
        async write(text) {
          value.writes++;
          pending = text;
        },
        async close() {
          await value.beforeClose?.();
          if (value.failClose) {
            locks.delete(path);
            throw new Error("Synthetic disk full");
          }
          value.text = pending;
          value.closes++;
          locks.delete(path);
        },
        async abort() {
          locks.delete(path);
        },
      };
    },
  });
  for (const [path, text] of Object.entries({ "aic.md": "", ...initial }))
    put(path, text);
  const root = file("aic.md");
  const handles = new Map<string, BrowserMarkdownHandle>([
    ["browser-test", root],
  ]);
  const bindings: BrowserSourceBindings = {
    read: async (id) => handles.get(id) ?? null,
    write: async (id, handle) => {
      handles.set(id, handle);
    },
  };
  return {
    state,
    entries,
    root,
    file,
    handles,
    bindings,
    put,
    text: (path: string) => entries.get(path)?.text,
    remove: (path: string) => entries.delete(path),
  };
}
