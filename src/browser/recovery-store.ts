import { BrowserFileError } from "./file-errors";
import { normalizeDomainOrigin, normalizePageUrl } from "./library";

export const RECOVERY_KEY = "aic-browser-markdown-draft-recovery";

type RecoveryRecord = { id: string; revision: number; markdown: string };
type RecoveryContent = {
  key: string;
  record: RecoveryRecord | null;
  text: string;
};
export type RecoveryDraft = RecoveryContent &
  (
    | { scope: "current"; context: { url: string; title: string } }
    | { scope: "shared"; context: { origin: string } }
    | { scope: "global"; context: Record<string, never> }
  );

export interface RecoverySnapshot {
  clientId: string;
  sourceId: string;
  sequence: number;
  updatedAt: number;
  entries: RecoveryDraft[];
  unavailable?: true;
}

interface StoredSnapshot {
  clientId: string;
  sourceId: string;
  sequence: number;
  updatedAt: number;
  entries: unknown;
}

interface RecoveryPersistence {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

const encoder = new TextEncoder();
const invalid = () =>
  new BrowserFileError("invalid", "The draft recovery data is invalid.");
const storage = () =>
  new BrowserFileError(
    "storage",
    "Could not keep a recovery copy of your draft. Keep AIC open until it is saved to disk, or export the draft.",
  );
const limit = () =>
  new BrowserFileError(
    "storage",
    "Draft recovery storage is full. Export and dismiss older recovery copies before closing AIC.",
  );

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, maxBytes: number, nonempty = false): string {
  if (
    typeof value !== "string" ||
    (nonempty && !value) ||
    value.length > maxBytes ||
    encoder.encode(value).length > maxBytes
  )
    throw invalid();
  return value;
}

function identifier(value: unknown, source = false): string {
  if (
    typeof value !== "string" ||
    !(
      source ? /^browser-[a-zA-Z0-9_-]{1,100}$/u : /^[a-zA-Z0-9_-]{1,128}$/u
    ).test(value)
  )
    throw invalid();
  return value;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw invalid();
  return value;
}

function entries(value: unknown): RecoveryDraft[] {
  if (!Array.isArray(value) || value.length > 50) throw invalid();
  const keys = new Set<string>();
  const result = value.map((raw): RecoveryDraft => {
    const entry = object(raw);
    const key = text(entry.key, 16 * 1024, true);
    const context = object(entry.context);
    const markdown = text(entry.text, 512 * 1024);
    const saved = entry.record === null ? null : object(entry.record);
    const record = saved && {
      id: text(saved.id, 256, true),
      revision: positive(saved.revision),
      markdown: text(saved.markdown, 512 * 1024),
    };
    const content = { key, record, text: markdown };
    let draft: RecoveryDraft;
    try {
      switch (entry.scope) {
        case "current":
          draft = {
            ...content,
            scope: "current",
            context: {
              url:
                typeof context.url === "string" &&
                record &&
                context.url === `file:${record.id}`
                  ? context.url
                  : normalizePageUrl(text(context.url, 8192, true)),
              title: text(context.title, 1024),
            },
          };
          break;
        case "shared":
          draft = {
            ...content,
            scope: "shared",
            context: {
              origin: normalizeDomainOrigin(text(context.origin, 8192, true)),
            },
          };
          break;
        case "global":
          if (Object.keys(context).length) throw invalid();
          draft = { ...content, scope: "global", context: {} };
          break;
        default:
          throw invalid();
      }
    } catch {
      throw invalid();
    }
    const identity = `${draft.scope}:${key}`;
    if (keys.has(identity)) throw invalid();
    keys.add(identity);
    return draft;
  });
  if (encoder.encode(JSON.stringify(result)).length > 2 * 1024 * 1024)
    throw limit();
  return result;
}

function stored(value: unknown): StoredSnapshot[] {
  if (value === undefined || value === null) return [];
  const data = object(value);
  if (
    data.version !== 2 ||
    !Array.isArray(data.snapshots) ||
    data.snapshots.length > 144
  )
    throw invalid();
  const keys = new Set<string>();
  return data.snapshots.map((raw): StoredSnapshot => {
    const item = object(raw);
    const result = {
      clientId: identifier(item.clientId),
      sourceId: identifier(item.sourceId, true),
      sequence: positive(item.sequence),
      updatedAt: positive(item.updatedAt),
      entries: item.entries,
    };
    const key = `${result.sourceId}:${result.clientId}`;
    if (keys.has(key)) throw invalid();
    keys.add(key);
    return result;
  });
}

function decodedSnapshot(item: StoredSnapshot): RecoverySnapshot {
  return {
    sourceId: item.sourceId,
    clientId: item.clientId,
    sequence: item.sequence,
    updatedAt: item.updatedAt,
    entries: entries(item.entries),
  };
}

/** Independent worker queue: a slow source write must never block draft durability. */
export class BrowserDraftRecovery {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly persistence: RecoveryPersistence) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }

  private async read(): Promise<StoredSnapshot[]> {
    let data: unknown;
    try {
      data = (await this.persistence.get(RECOVERY_KEY))[RECOVERY_KEY];
    } catch {
      throw storage();
    }
    return stored(data);
  }

  private async write(snapshots: StoredSnapshot[]): Promise<void> {
    const active = snapshots.filter((item) => item.entries !== null);
    if (active.length > 16) throw limit();
    // Retain sequence tombstones against delayed messages, without growing forever.
    const cleared = snapshots
      .filter((item) => item.entries === null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 128);
    const data = { version: 2, snapshots: [...active, ...cleared] };
    if (encoder.encode(JSON.stringify(data)).length > 4 * 1024 * 1024)
      throw limit();
    try {
      await this.persistence.set({ [RECOVERY_KEY]: data });
    } catch {
      throw storage();
    }
  }

  checkpoint(
    sourceId: string,
    clientId: string,
    sequence: number,
    drafts: RecoveryDraft[],
  ): Promise<{ sequence: number }> {
    return this.queued(() =>
      this.writeCheckpoint(sourceId, clientId, sequence, drafts),
    );
  }

  private async writeCheckpoint(
    sourceId: string,
    clientId: string,
    sequence: number,
    drafts: RecoveryDraft[],
  ): Promise<{ sequence: number }> {
    identifier(sourceId, true);
    identifier(clientId);
    positive(sequence);
    const validated = entries(drafts);
    const snapshots = await this.read();
    const previous = snapshots.find(
      (item) => item.sourceId === sourceId && item.clientId === clientId,
    );
    if (previous && previous.sequence >= sequence)
      return { sequence: previous.sequence };
    const updatedAt = Date.now();
    await this.write([
      ...snapshots.filter((item) => item !== previous),
      {
        sourceId,
        clientId,
        sequence,
        updatedAt,
        entries: validated.length ? validated : null,
      },
    ]);
    return { sequence };
  }

  list(sourceId: string): Promise<RecoverySnapshot[]> {
    return this.queued(() => this.readSnapshots(sourceId));
  }

  private async readSnapshots(sourceId: string): Promise<RecoverySnapshot[]> {
    identifier(sourceId, true);
    const snapshots = (await this.read()).filter(
      (item) => item.sourceId === sourceId && item.entries !== null,
    );
    const result: RecoverySnapshot[] = [];
    for (const item of snapshots) {
      const metadata = {
        sourceId: item.sourceId,
        clientId: item.clientId,
        sequence: item.sequence,
        updatedAt: item.updatedAt,
      };
      try {
        result.push(decodedSnapshot(item));
      } catch {
        // One damaged snapshot must not hide other recoverable drafts.
        result.push({ ...metadata, entries: [], unavailable: true });
      }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  dismiss(sourceId: string, clientId: string, sequence: number): Promise<void> {
    return this.queued(() => this.removeSnapshot(sourceId, clientId, sequence));
  }

  private async removeSnapshot(
    sourceId: string,
    clientId: string,
    sequence: number,
  ): Promise<void> {
    identifier(sourceId, true);
    identifier(clientId);
    positive(sequence);
    const snapshots = await this.read();
    const existing = snapshots.find(
      (item) => item.sourceId === sourceId && item.clientId === clientId,
    );
    if (existing && existing.sequence !== sequence)
      throw new BrowserFileError(
        "conflict",
        "This recovery copy changed in another panel. Review the latest copy before dismissing it.",
      );
    await this.write(
      snapshots.map((item) =>
        item.sourceId === sourceId && item.clientId === clientId
          ? {
              ...item,
              entries: null,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  }
}
