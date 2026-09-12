import { DraftSession } from "./core/draft-session.js";

export type ActiveDraft = Readonly<{
  id: string;
  text: string;
  dirty: boolean;
  pending: boolean;
}>;

export type DraftCommit = Readonly<{
  id: string;
  operationId: number;
  text: string;
  generation: number;
  reason: string;
}>;

export class NoteDraftRegistry {
  private readonly sessions = new Map<string, DraftSession>();
  private activeId: string | null = null;
  private operationId = 0;
  private readonly pending = new Map<string, DraftCommit>();

  private prune(id: string) {
    const session = this.sessions.get(id);
    if (
      id !== this.activeId &&
      session &&
      !session.dirty &&
      !this.pending.has(id)
    )
      this.sessions.delete(id);
  }

  get current(): ActiveDraft | null {
    return this.activeId ? this.snapshot(this.activeId) : null;
  }

  snapshot(id: string): ActiveDraft | null {
    const session = this.sessions.get(id);
    return session
      ? {
          id,
          text: session.current,
          dirty: session.dirty,
          pending: this.pending.has(id),
        }
      : null;
  }

  activate(id: string, text: string, generation = 0): ActiveDraft {
    const previousId = this.activeId;
    this.activeId = id;
    if (previousId) this.prune(previousId);

    let session = this.sessions.get(id);
    if (!session) {
      session = new DraftSession();
      session.hydrate(text, generation, { discardLocal: true });
      this.sessions.set(id, session);
    } else if (!session.dirty && !this.pending.has(id)) {
      session.external(text, generation);
    }
    return {
      id,
      text: session.current,
      dirty: session.dirty,
      pending: this.pending.has(id),
    };
  }

  edit(text: string): boolean {
    const session = this.activeId
      ? this.sessions.get(this.activeId)
      : undefined;
    return session?.edit(text) ?? false;
  }

  begin(reason = "explicit"): DraftCommit | null {
    return this.activeId ? this.beginFor(this.activeId, reason) : null;
  }

  beginFor(id: string, reason = "explicit"): DraftCommit | null {
    const session = this.sessions.get(id);
    if (this.pending.has(id)) return null;
    const draft = session?.begin(reason);
    if (!draft) return null;
    const commit = Object.freeze({
      ...draft,
      id,
      operationId: ++this.operationId,
    });
    this.pending.set(id, commit);
    return commit;
  }

  acknowledge(commit: DraftCommit & { saved: boolean }): boolean {
    const pending = this.pending.get(commit.id);
    if (
      !pending ||
      pending.operationId !== commit.operationId ||
      pending.text !== commit.text
    )
      return false;
    this.pending.delete(commit.id);
    const session = this.sessions.get(commit.id);
    const accepted = session?.acknowledge(commit) ?? false;
    this.prune(commit.id);
    return accepted;
  }
}
