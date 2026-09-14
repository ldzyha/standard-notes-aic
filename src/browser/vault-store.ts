import {
  LibraryStore,
  validateBrowserLibrary,
  type BrowserLibrary,
} from "./library";
import {
  createVault,
  unlockVault,
  openVault,
  sealVault,
  validateEnvelope,
  type VaultEnvelope,
  type VaultSession,
} from "./vault-crypto";

export type VaultStatus = { state: "setup" | "locked" | "unlocked" };
export interface VaultPersistence {
  readLocal(): Promise<unknown>;
  writeLocal(envelope: VaultEnvelope): Promise<void>;
  readSession(): Promise<unknown>;
  writeSession(session: VaultSession): Promise<void>;
  clearSession(): Promise<void>;
}

export class VaultStateError extends Error {
  constructor(
    public readonly code:
      "locked" | "exists" | "missing" | "storage" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "VaultStateError";
  }
}

const locked = () =>
  new VaultStateError("locked", "Unlock your local notes first.");
const storageFailure = () =>
  new VaultStateError(
    "storage",
    "The browser could not store this change. Retry before closing AIC.",
  );
function parseLibrary(text: string): BrowserLibrary {
  try {
    return validateBrowserLibrary(JSON.parse(text));
  } catch {
    throw new VaultStateError(
      "invalid",
      "This backup does not contain a valid AIC library.",
    );
  }
}

/** Single worker owner: locking, setup, restores and writes share one transaction queue. */
export class BrowserVault {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly persistence: VaultPersistence) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }

  private async envelope(): Promise<VaultEnvelope | null> {
    let value: unknown;
    try {
      value = await this.persistence.readLocal();
    } catch {
      throw storageFailure();
    }
    // Never replace unknown/plaintext/corrupted storage with an empty library.
    return value === undefined || value === null
      ? null
      : validateEnvelope(value);
  }

  private async unlocked(): Promise<{
    envelope: VaultEnvelope;
    session: VaultSession;
    library: BrowserLibrary;
  }> {
    const envelope = await this.envelope();
    if (!envelope) throw locked();
    let session: unknown;
    try {
      session = await this.persistence.readSession();
    } catch {
      throw storageFailure();
    }
    if (!session) throw locked();
    try {
      const library = parseLibrary(
        await openVault(envelope, session as VaultSession),
      );
      return { envelope, session: session as VaultSession, library };
    } catch {
      throw locked();
    }
  }

  status(): Promise<VaultStatus> {
    return this.queued(async () => {
      const envelope = await this.envelope();
      if (!envelope) return { state: "setup" };
      try {
        await this.unlocked();
        return { state: "unlocked" };
      } catch {
        return { state: "locked" };
      }
    });
  }

  setup(password: string): Promise<VaultStatus> {
    return this.queued(async () => {
      if (await this.envelope())
        throw new VaultStateError(
          "exists",
          "Local notes already exist. Unlock them instead.",
        );
      const { envelope, session } = await createVault(
        password,
        JSON.stringify({ version: 2, notes: [], history: [], domains: [] }),
      );
      try {
        await this.persistence.writeLocal(envelope);
        await this.persistence.writeSession(session);
      } catch {
        throw storageFailure();
      }
      return { state: "unlocked" };
    });
  }

  unlock(password: string): Promise<VaultStatus> {
    return this.queued(async () => {
      const envelope = await this.envelope();
      if (!envelope)
        throw new VaultStateError(
          "missing",
          "Create your local notes password first.",
        );
      const { plaintext, session } = await unlockVault(envelope, password);
      parseLibrary(plaintext);
      try {
        await this.persistence.writeSession(session);
      } catch {
        throw storageFailure();
      }
      return { state: "unlocked" };
    });
  }

  lock(): Promise<VaultStatus> {
    return this.queued(async () => {
      try {
        await this.persistence.clearSession();
      } catch {
        throw storageFailure();
      }
      return { state: (await this.envelope()) ? "locked" : "setup" };
    });
  }

  run<T>(operation: (store: LibraryStore) => Promise<T>): Promise<T> {
    return this.queued(async () => {
      const { session, library } = await this.unlocked();
      let current = library;
      const store = new LibraryStore({
        async read() {
          return current;
        },
        write: async (next) => {
          const envelope = await sealVault(JSON.stringify(next), session);
          try {
            await this.persistence.writeLocal(envelope);
          } catch {
            throw storageFailure();
          }
          current = next;
        },
      });
      return operation(store);
    });
  }

  /** Encrypted backup is safe to export while locked; never silently export plaintext. */
  exportBackup(): Promise<string> {
    return this.queued(async () => {
      const envelope = await this.envelope();
      if (!envelope)
        throw new VaultStateError(
          "missing",
          "There are no local notes to export yet.",
        );
      return JSON.stringify(envelope);
    });
  }

  importBackup(
    text: string,
    password: string,
  ): Promise<{
    created: number;
    skipped: number;
    domainsCreated: number;
    domainsSkipped: number;
    restored: boolean;
  }> {
    return this.queued(async () => {
      // Bound raw JSON before parsing, then authenticate before inspecting content.
      if (typeof text !== "string" || text.length > 9 * 1024 * 1024)
        throw new VaultStateError(
          "invalid",
          "This backup is too large or invalid.",
        );
      let incoming: VaultEnvelope;
      try {
        incoming = validateEnvelope(JSON.parse(text));
      } catch {
        throw new VaultStateError(
          "invalid",
          "Choose an encrypted AIC backup file.",
        );
      }
      const local = await this.envelope();
      // If an existing vault is locked, never replace it with another backup.
      const current = local ? await this.unlocked() : null;
      const opened = await unlockVault(incoming, password);
      const library = parseLibrary(opened.plaintext);
      if (!current) {
        try {
          await this.persistence.writeLocal(incoming);
          await this.persistence.writeSession(opened.session);
        } catch {
          throw storageFailure();
        }
        return {
          created: library.notes.length,
          skipped: 0,
          domainsCreated: library.domains.length,
          domainsSkipped: 0,
          restored: true,
        };
      }
      const store = new LibraryStore({
        async read() {
          return current.library;
        },
        write: async (merged) => {
          const envelope = await sealVault(
            JSON.stringify(merged),
            current.session,
          );
          try {
            await this.persistence.writeLocal(envelope);
          } catch {
            throw storageFailure();
          }
        },
      });
      const result = await store.importBackup(JSON.stringify(library));
      return {
        created: result.created,
        skipped: result.skipped,
        domainsCreated: result.domainsCreated,
        domainsSkipped: result.domainsSkipped,
        restored: false,
      };
    });
  }
}
