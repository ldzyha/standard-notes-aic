import { DraftSession } from "./core/draft-session.js";

export type ActiveDraft = Readonly<{
  id: string;
  text: string;
  dirty: boolean;
}>;

export class NoteDraftRegistry {
  private readonly sessions = new Map<string, DraftSession>();
  private activeId: string | null = null;

  get current(): ActiveDraft | null {
    if (!this.activeId) return null;
    const session = this.sessions.get(this.activeId);
    return session
      ? { id: this.activeId, text: session.current, dirty: session.dirty }
      : null;
  }

  activate(id: string, text: string, generation = 0): ActiveDraft {
    const previousId = this.activeId;
    if (previousId && previousId !== id) {
      const previous = this.sessions.get(previousId);
      if (previous && !previous.dirty) this.sessions.delete(previousId);
    }

    let session = this.sessions.get(id);
    if (!session) {
      session = new DraftSession();
      session.hydrate(text, generation, { discardLocal: true });
      this.sessions.set(id, session);
    } else {
      session.external(text, generation);
    }
    this.activeId = id;
    return { id, text: session.current, dirty: session.dirty };
  }

  edit(text: string): boolean {
    const session = this.activeId
      ? this.sessions.get(this.activeId)
      : undefined;
    return session?.edit(text) ?? false;
  }

  begin(reason = "explicit") {
    const session = this.activeId
      ? this.sessions.get(this.activeId)
      : undefined;
    return session?.begin(reason) ?? null;
  }

  acknowledge(commit: {
    text?: string;
    generation?: number;
    saved?: boolean;
  }): boolean {
    const session = this.activeId
      ? this.sessions.get(this.activeId)
      : undefined;
    return session?.acknowledge(commit) ?? false;
  }
}
