import type {
  BrowserMarkdownDirectory,
  BrowserMarkdownFile,
  BrowserMarkdownHandle,
  BrowserSourceBindings,
} from "../../src/browser/markdown-storage";

export function markdownFixture(initial: Record<string, string> = {}) {
  const entries = new Map<
    string,
    {
      kind: "file" | "directory";
      text: string;
      writes: number;
      closes: number;
      failClose: boolean;
      beforeClose?: () => Promise<void>;
    }
  >();
  entries.set("", {
    kind: "directory",
    text: "",
    writes: 0,
    closes: 0,
    failClose: false,
  });
  const state = { allowed: true, scans: 0 };
  const locks = new Set<string>();
  const absent = () =>
    new DOMException("Synthetic missing file", "NotFoundError");
  const put = (path: string, text: string) => {
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end++) {
      const parent = parts.slice(0, end).join("/");
      if (!entries.has(parent))
        entries.set(parent, {
          kind: "directory",
          text: "",
          writes: 0,
          closes: 0,
          failClose: false,
        });
    }
    const current = entries.get(path);
    entries.set(
      path,
      current
        ? { ...current, text }
        : { kind: "file", text, writes: 0, closes: 0, failClose: false },
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
      if (!value || value.kind !== "file") throw absent();
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
  const directory = (path: string): BrowserMarkdownDirectory => ({
    kind: "directory",
    name: path.split("/").at(-1) || "notes",
    ...permissions,
    async getFileHandle(name, options = {}) {
      const full = path ? `${path}/${name}` : name;
      const value = entries.get(full);
      if (!value && options.create) put(full, "");
      else if (!value) throw absent();
      else if (value.kind !== "file")
        throw new DOMException("Type mismatch", "TypeMismatchError");
      return file(full);
    },
    async getDirectoryHandle(name, options = {}) {
      const full = path ? `${path}/${name}` : name;
      const value = entries.get(full);
      if (!value && options.create)
        entries.set(full, {
          kind: "directory",
          text: "",
          writes: 0,
          closes: 0,
          failClose: false,
        });
      else if (!value) throw absent();
      else if (value.kind !== "directory")
        throw new DOMException("Type mismatch", "TypeMismatchError");
      return directory(full);
    },
    async *values() {
      if (!entries.has(path)) throw absent();
      state.scans++;
      const prefix = path ? `${path}/` : "";
      for (const [name, value] of entries) {
        if (
          name &&
          name.startsWith(prefix) &&
          !name.slice(prefix.length).includes("/")
        )
          yield value.kind === "file" ? file(name) : directory(name);
      }
    },
    async removeEntry(name) {
      const full = path ? `${path}/${name}` : name;
      if (!entries.delete(full)) throw absent();
    },
  });
  for (const [path, text] of Object.entries(initial)) put(path, text);
  const root = directory("");
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
    directory,
    handles,
    bindings,
    put,
    text: (path: string) => entries.get(path)?.text,
    remove: (path: string) => entries.delete(path),
  };
}
