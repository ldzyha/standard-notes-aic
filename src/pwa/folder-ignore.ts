import ignore, { type Ignore } from "ignore";

type RuleFile = ".gitignore" | ".ignore";
type Scope = {
  files: Partial<Record<RuleFile, string>>;
  matcher: Ignore;
  evaluations: number;
};
const CACHE_EVALUATIONS = 256;

function safePath(path: string): string {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32) ||
    path.split("/").some((part) => part === "." || part === ".." || !part)
  )
    throw new Error("Ignore matching requires a safe root-relative path");
  return path;
}

function matcher(files: Scope["files"]): Ignore {
  return ignore({ ignorecase: false })
    .add(files[".gitignore"] ?? "")
    .add(files[".ignore"] ?? "");
}

/** Metadata directories are excluded even before any ignore files are loaded. */
export function isHardExcludedPath(
  relativePath: string,
  isDirectory = false,
): boolean {
  if (!relativePath) return false;
  const parts = safePath(relativePath).split("/");
  const directories = isDirectory ? parts : parts.slice(0, -1);
  return directories.some((part) => /^(?:\.git|node_modules)$/iu.test(part));
}

/** Scoped ignore rules for one selected folder; the chosen root is never excluded. */
export class FolderIgnore {
  private readonly scopes = new Map<string, Scope>();

  /** Load each directory's rules before inspecting its descendants. */
  addRules(scopePath: string, filename: RuleFile, text: string): void {
    if (scopePath) safePath(scopePath);
    if (filename !== ".gitignore" && filename !== ".ignore")
      throw new Error("Unsupported ignore rule file");
    const files = { ...this.scopes.get(scopePath)?.files, [filename]: text };
    this.scopes.set(scopePath, {
      files,
      matcher: matcher(files),
      evaluations: 0,
    });
  }

  /** Includes ancestor-directory pruning, also for a flattened FileList. */
  isIgnored(relativePath: string, isDirectory = false): boolean {
    if (!relativePath) return false;
    const parts = safePath(relativePath).split("/");
    if (isHardExcludedPath(relativePath, isDirectory)) return true;
    for (let length = 1; length < parts.length; length++) {
      if (this.matches(parts.slice(0, length).join("/"), true)) return true;
    }
    return this.matches(relativePath, isDirectory);
  }

  private matches(path: string, isDirectory: boolean): boolean {
    const parts = path.split("/");
    let ignored = false;
    for (let length = 0; length < parts.length; length++) {
      const scope = this.scopes.get(parts.slice(0, length).join("/"));
      if (!scope) continue;
      // ignore caches test paths internally. Reset regularly rather than retaining
      // every scanned path for every ancestor scope during a large folder scan.
      if (scope.evaluations >= CACHE_EVALUATIONS) {
        scope.matcher = matcher(scope.files);
        scope.evaluations = 0;
      }
      scope.evaluations++;
      const local = parts.slice(length).join("/") + (isDirectory ? "/" : "");
      const result = scope.matcher.test(local);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
}
