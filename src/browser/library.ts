import { parsePropertiesBody } from "../core/properties-model.js";
import { propertiesSyntax } from "../core/field-syntax.js";

/** Local-only browser notes. The extension's background worker must be the sole writer. */
export interface BrowserNote {
  id: string;
  url: string;
  title: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface PageVisit {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserLibrary {
  version: 2;
  notes: BrowserNote[];
  history: PageVisit[];
  domains: BrowserDomain[];
}

/** Shared Properties have their own identity and never own a page's Markdown. */
export interface BrowserDomain {
  id: string;
  origin: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface PageContext {
  url: string;
  title: string;
}

/** The exact note observed by the caller, or an observed history-only page. */
export type PageNoteExpectation = { id: string; revision: number } | null;

export interface LibraryPersistence {
  read(): Promise<unknown>;
  write(library: BrowserLibrary): Promise<void>;
}

export interface PathNode {
  segment: string;
  path: string;
  notes: BrowserNote[];
  children: PathNode[];
}

export interface DomainNode {
  host: string;
  notes: BrowserNote[];
  paths: PathNode[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  domainsCreated: number;
  domainsSkipped: number;
  library: BrowserLibrary;
}

export class LibraryError extends Error {
  constructor(
    public readonly code: "invalid" | "quota" | "conflict" | "storage",
    message: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

const MAX_NOTES = 500;
const MAX_DOMAINS = 500;
const MAX_HISTORY = 100;
const MAX_NOTE_BYTES = 512 * 1024;
// Leave room for the encrypted/base64 envelope in chrome.storage.local.
const MAX_LIBRARY_BYTES = 6 * 1024 * 1024;
const MAX_URL_BYTES = 8192;
const MAX_TITLE_BYTES = 1024;
const encoder = new TextEncoder();

const invalid = () =>
  new LibraryError("invalid", "Invalid browser library data.");
const quota = () =>
  new LibraryError("quota", "Browser library size limit reached.");
const storage = () =>
  new LibraryError("storage", "Browser library storage failed.");
const conflict = () =>
  new LibraryError(
    "conflict",
    "This note changed elsewhere. Reload it before saving.",
  );

function bytes(value: string): number {
  return encoder.encode(value).length;
}

function record(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function denseArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  )
    return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function stringWithin(value: unknown, maximum: number): value is string {
  return typeof value === "string" && bytes(value) <= maximum;
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function normalizePageUrl(input: string): string {
  if (
    typeof input !== "string" ||
    bytes(input) > MAX_URL_BYTES ||
    input !== input.trim()
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    bytes(url.href) > MAX_URL_BYTES
  )
    throw invalid();
  return url.href;
}

/** Domain sharing deliberately retains scheme, subdomain and non-default port. */
export function normalizeDomainOrigin(input: string): string {
  const origin = new URL(normalizePageUrl(input)).origin;
  if (input !== origin) throw invalid();
  return origin;
}

/** Persist only complete, supported Properties; incomplete source remains a draft. */
export function validateDomainProperties(markdown: string): string {
  if (typeof markdown !== "string") throw invalid();
  if (bytes(markdown) > MAX_NOTE_BYTES) throw quota();
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  if (!/^---[ \t]*$/u.test(lines[0] ?? "")) throw invalid();
  const closing = lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/u.test(line),
  );
  if (closing < 0 || lines.slice(closing + 1).some((line) => line.trim()))
    throw invalid();
  const body = lines.slice(1, closing).join("\n");
  const syntax = propertiesSyntax(body);
  if (syntax.unsupportedSyntax || !parsePropertiesBody(body, syntax).ok)
    throw invalid();
  return markdown;
}

function validDomain(value: unknown): BrowserDomain {
  if (
    !record(value, [
      "id",
      "origin",
      "markdown",
      "createdAt",
      "updatedAt",
      "revision",
    ])
  )
    throw invalid();
  // Reuse the same bounded identity, timestamps and revision rules as notes.
  const origin = normalizeDomainOrigin(value.origin as string);
  const note = validNote({
    id: value.id,
    url: `${origin}/`,
    title: "",
    markdown: value.markdown,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    revision: value.revision,
  });
  return {
    id: note.id,
    origin,
    markdown: validateDomainProperties(note.markdown),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    revision: note.revision,
  };
}

function validPage(value: unknown): PageContext {
  try {
    if (
      !record(value, ["url", "title"]) ||
      !stringWithin(value.title, MAX_TITLE_BYTES)
    )
      throw invalid();
    return { url: normalizePageUrl(value.url as string), title: value.title };
  } catch {
    throw invalid();
  }
}

function validNote(value: unknown): BrowserNote {
  if (
    !record(value, [
      "id",
      "url",
      "title",
      "markdown",
      "createdAt",
      "updatedAt",
      "revision",
    ])
  )
    throw invalid();
  if (
    !stringWithin(value.id, 128) ||
    !value.id ||
    [...value.id].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !stringWithin(value.title, MAX_TITLE_BYTES) ||
    !stringWithin(value.markdown, MAX_NOTE_BYTES) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1
  )
    throw invalid();
  const url = normalizePageUrl(value.url as string);
  if (url !== value.url) throw invalid();
  return {
    id: value.id,
    url,
    title: value.title,
    markdown: value.markdown,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    revision: value.revision as number,
  };
}

function validVisit(value: unknown): PageVisit {
  if (
    !record(value, ["url", "title", "visitedAt"]) ||
    !stringWithin(value.title, MAX_TITLE_BYTES) ||
    !timestamp(value.visitedAt)
  )
    throw invalid();
  const url = normalizePageUrl(value.url as string);
  if (url !== value.url) throw invalid();
  return { url, title: value.title, visitedAt: value.visitedAt };
}

/** Validate and copy decrypted or imported data before it enters the store. */
export function validateBrowserLibrary(value: unknown): BrowserLibrary {
  try {
    const legacy =
      record(value, ["version", "notes", "history"]) && value.version === 1;
    if (
      !(
        legacy ||
        (record(value, ["version", "notes", "history", "domains"]) &&
          value.version === 2)
      ) ||
      !denseArray(value.notes) ||
      !denseArray(value.history) ||
      value.notes.length > MAX_NOTES ||
      value.history.length > MAX_HISTORY ||
      (!legacy &&
        (!denseArray(value.domains) || value.domains.length > MAX_DOMAINS))
    )
      throw invalid();
    const notes = value.notes.map(validNote);
    const history = value.history.map(validVisit);
    const domains = legacy ? [] : (value.domains as unknown[]).map(validDomain);
    const ids = new Set([...notes, ...domains].map((item) => item.id));
    const urls = new Set(notes.map((note) => note.url));
    const origins = new Set(domains.map((domain) => domain.origin));
    if (
      ids.size !== notes.length + domains.length ||
      urls.size !== notes.length ||
      origins.size !== domains.length
    )
      throw invalid();
    const library: BrowserLibrary = { version: 2, notes, history, domains };
    if (bytes(JSON.stringify(library)) > MAX_LIBRARY_BYTES) throw quota();
    return library;
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    throw invalid();
  }
}

function snapshot(library: BrowserLibrary): BrowserLibrary {
  return {
    version: 2,
    notes: library.notes.map((note) => ({ ...note })),
    history: library.history.map((visit) => ({ ...visit })),
    domains: library.domains.map((domain) => ({ ...domain })),
  };
}

/** One instance should own all writes; the queue does not coordinate separate JS contexts. */
export class LibraryStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly persistence: LibraryPersistence) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async read(): Promise<BrowserLibrary> {
    let raw: unknown;
    try {
      raw = await this.persistence.read();
    } catch {
      throw storage();
    }
    return raw === null || raw === undefined
      ? { version: 2, notes: [], history: [], domains: [] }
      : validateBrowserLibrary(raw);
  }

  private async write(library: BrowserLibrary): Promise<void> {
    const validated = validateBrowserLibrary(library);
    try {
      await this.persistence.write(snapshot(validated));
    } catch {
      throw storage();
    }
  }

  load(): Promise<BrowserLibrary> {
    return this.queued(async () => snapshot(await this.read()));
  }

  visit(page: PageContext): Promise<BrowserLibrary> {
    return this.queued(async () => {
      const safePage = validPage(page);
      const current = await this.read();
      const now = Date.now();
      const latest = current.history[0];
      if (
        latest?.url === safePage.url &&
        latest.title === safePage.title &&
        now >= latest.visitedAt &&
        now - latest.visitedAt < 30_000 &&
        current.history.slice(1).every((visit) => visit.url !== safePage.url)
      )
        return snapshot(current);
      const next: BrowserLibrary = {
        ...current,
        history: [
          { ...safePage, visitedAt: now },
          ...current.history.filter((visit) => visit.url !== safePage.url),
        ].slice(0, MAX_HISTORY),
      };
      await this.write(next);
      return snapshot(next);
    });
  }

  create(
    page: PageContext,
    markdown = "",
    options: { ifAbsent?: boolean } = {},
  ): Promise<BrowserNote> {
    return this.queued(async () => {
      const safePage = validPage(page);
      if (!stringWithin(markdown, MAX_NOTE_BYTES)) throw quota();
      const current = await this.read();
      const existing = current.notes.find((note) => note.url === safePage.url);
      if (existing) {
        if (options.ifAbsent) throw conflict();
        return { ...existing };
      }
      if (current.notes.length >= MAX_NOTES) throw quota();
      const now = Date.now();
      const note: BrowserNote = {
        id: crypto.randomUUID(),
        url: safePage.url,
        title: safePage.title,
        markdown,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      await this.write({ ...current, notes: [...current.notes, note] });
      return { ...note };
    });
  }

  save(
    id: string,
    markdown: string,
    expectedRevision: number,
  ): Promise<BrowserNote> {
    return this.queued(async () => {
      if (
        typeof id !== "string" ||
        !id ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 1 ||
        typeof markdown !== "string"
      )
        throw invalid();
      if (bytes(markdown) > MAX_NOTE_BYTES) throw quota();
      const current = await this.read();
      const index = current.notes.findIndex((note) => note.id === id);
      if (index < 0) throw invalid();
      const original = current.notes[index]!;
      if (original.revision !== expectedRevision) throw conflict();
      const updated: BrowserNote = {
        ...original,
        markdown,
        updatedAt: Math.max(Date.now(), original.updatedAt),
        revision: original.revision + 1,
      };
      const notes = [...current.notes];
      notes[index] = updated;
      await this.write({ ...current, notes });
      return { ...updated };
    });
  }

  exportBackup(): Promise<string> {
    return this.queued(async () => JSON.stringify(await this.read(), null, 2));
  }

  deletePage(
    url: string,
    expectedNote: PageNoteExpectation,
  ): Promise<BrowserLibrary> {
    return this.queued(async () => {
      const safeUrl = normalizePageUrl(url);
      if (
        expectedNote !== null &&
        (!record(expectedNote, ["id", "revision"]) ||
          !stringWithin(expectedNote.id, 128) ||
          !expectedNote.id ||
          [...expectedNote.id].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          ) ||
          !Number.isSafeInteger(expectedNote.revision) ||
          expectedNote.revision < 1)
      )
        throw invalid();
      const current = await this.read();
      const note = current.notes.find((candidate) => candidate.url === safeUrl);
      if (
        expectedNote === null
          ? note !== undefined
          : !note ||
            note.id !== expectedNote.id ||
            note.revision !== expectedNote.revision
      )
        throw new LibraryError(
          "conflict",
          "This page changed elsewhere. Reload it before deleting.",
        );
      const next: BrowserLibrary = {
        ...current,
        notes: current.notes.filter((candidate) => candidate.url !== safeUrl),
        history: current.history.filter((visit) => visit.url !== safeUrl),
      };
      if (note || next.history.length !== current.history.length)
        await this.write(next);
      return snapshot(next);
    });
  }

  createDomain(origin: string, markdown: string): Promise<BrowserDomain> {
    return this.queued(async () => {
      const safeOrigin = normalizeDomainOrigin(origin);
      validateDomainProperties(markdown);
      const current = await this.read();
      if (current.domains.some((domain) => domain.origin === safeOrigin))
        throw conflict();
      if (current.domains.length >= MAX_DOMAINS) throw quota();
      const now = Date.now();
      const domain: BrowserDomain = {
        id: crypto.randomUUID(),
        origin: safeOrigin,
        markdown,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      await this.write({ ...current, domains: [...current.domains, domain] });
      return { ...domain };
    });
  }

  saveDomain(
    id: string,
    markdown: string,
    expectedRevision: number,
  ): Promise<BrowserDomain> {
    return this.queued(async () => {
      if (
        typeof id !== "string" ||
        !id ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 1
      )
        throw invalid();
      validateDomainProperties(markdown);
      const current = await this.read();
      const index = current.domains.findIndex((domain) => domain.id === id);
      if (index < 0) throw invalid();
      const original = current.domains[index]!;
      if (original.revision !== expectedRevision) throw conflict();
      const updated: BrowserDomain = {
        ...original,
        markdown,
        updatedAt: Math.max(Date.now(), original.updatedAt),
        revision: original.revision + 1,
      };
      const domains = [...current.domains];
      domains[index] = updated;
      await this.write({ ...current, domains });
      return { ...updated };
    });
  }

  importBackup(text: string): Promise<ImportResult> {
    return this.queued(async () => {
      if (typeof text !== "string" || bytes(text) > MAX_LIBRARY_BYTES)
        throw quota();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw invalid();
      }
      const incoming = validateBrowserLibrary(parsed);
      const current = await this.read();
      const urls = new Set(current.notes.map((note) => note.url));
      const ids = new Set(
        [...current.notes, ...current.domains].map((item) => item.id),
      );
      const additions: BrowserNote[] = [];
      let skipped = 0;
      for (const note of incoming.notes) {
        if (urls.has(note.url)) {
          skipped++;
          continue;
        }
        const imported = { ...note };
        if (ids.has(imported.id)) imported.id = crypto.randomUUID();
        urls.add(imported.url);
        ids.add(imported.id);
        additions.push(imported);
      }
      const origins = new Set(current.domains.map((domain) => domain.origin));
      const domainAdditions: BrowserDomain[] = [];
      let domainsSkipped = 0;
      for (const domain of incoming.domains) {
        if (origins.has(domain.origin)) {
          domainsSkipped++;
          continue;
        }
        const imported = { ...domain };
        if (ids.has(imported.id)) imported.id = crypto.randomUUID();
        origins.add(imported.origin);
        ids.add(imported.id);
        domainAdditions.push(imported);
      }
      const history = [...current.history];
      const visitKeys = new Set(
        history.map((visit) => `${visit.url}\u0000${visit.visitedAt}`),
      );
      for (const visit of incoming.history) {
        const key = `${visit.url}\u0000${visit.visitedAt}`;
        if (history.length >= MAX_HISTORY) break;
        if (!visitKeys.has(key)) {
          history.push({ ...visit });
          visitKeys.add(key);
        }
      }
      history.sort((a, b) => b.visitedAt - a.visitedAt);
      const merged = validateBrowserLibrary({
        version: 2,
        notes: [...current.notes, ...additions],
        history,
        domains: [...current.domains, ...domainAdditions],
      });
      if (
        additions.length ||
        domainAdditions.length ||
        history.length !== current.history.length
      )
        await this.write(merged);
      return {
        created: additions.length,
        skipped,
        domainsCreated: domainAdditions.length,
        domainsSkipped,
        library: snapshot(merged),
      };
    });
  }
}

/** URL path grouping only: it does not infer a site's own content hierarchy. */
export function buildDomainTree(notes: readonly BrowserNote[]): DomainNode[] {
  const domains = new Map<string, DomainNode>();
  for (const raw of notes) {
    const note = validNote(raw);
    const url = new URL(note.url);
    const host = url.host;
    let domain = domains.get(host);
    if (!domain) {
      domain = { host, notes: [], paths: [] };
      domains.set(host, domain);
    }
    if (url.pathname === "/") {
      domain.notes.push(note);
      continue;
    }
    // Empty segments matter: /a//b and /a/b are distinct URL paths.
    const segments = url.pathname.slice(1).split("/");
    const depth = Math.min(segments.length, 64);
    let paths = domain.paths;
    let path = "";
    for (let index = 0; index < depth; index++) {
      const collapsed = index === 63 && segments.length > 64;
      const rawSegment = segments[index]!;
      path = collapsed ? url.pathname : `${path}/${rawSegment}`;
      const segment = collapsed ? "…" : rawSegment || "/";
      let branch = paths.find((candidate) => candidate.path === path);
      if (!branch) {
        branch = { segment, path, notes: [], children: [] };
        paths.push(branch);
      }
      if (index === depth - 1) branch.notes.push(note);
      paths = branch.children;
    }
  }
  const sortNotes = (items: BrowserNote[]) =>
    items.sort((a, b) => a.url.localeCompare(b.url));
  const sortPaths = (items: PathNode[]): void => {
    items.sort((a, b) => a.segment.localeCompare(b.segment));
    for (const item of items) {
      sortNotes(item.notes);
      sortPaths(item.children);
    }
  };
  const result = [...domains.values()].sort((a, b) =>
    a.host.localeCompare(b.host),
  );
  for (const domain of result) {
    sortNotes(domain.notes);
    sortPaths(domain.paths);
  }
  return result;
}
