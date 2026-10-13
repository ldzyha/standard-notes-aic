import type { BrowserNote, PageContext } from "./library";
import {
  AUTOSAVE_DELAY_MS,
  DraftCoordinator,
  type DraftState,
} from "./draft-coordinator";

export { AUTOSAVE_DELAY_MS };

export interface Draft {
  key: string;
  /** Names the note file in recovery copies: `file:<id>` and its path. */
  page: PageContext;
  note: BrowserNote;
  text: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

export type BrowserSaveFn = (
  id: string,
  markdown: string,
  expectedRevision: number,
) => Promise<BrowserNote>;

function browserDraft(state: DraftState<BrowserNote, PageContext>): Draft {
  return {
    key: state.key,
    page: state.context,
    note: state.record,
    text: state.text,
    dirty: state.dirty,
    saving: state.saving,
    error: state.error,
  };
}

/** The note file's draft over the shared autosave coordinator. */
export class BrowserDrafts {
  private readonly coordinator: DraftCoordinator<BrowserNote, PageContext>;

  constructor(
    saveFn: BrowserSaveFn,
    onChangeFn: (draft: Draft) => void = () => undefined,
  ) {
    this.coordinator = new DraftCoordinator(
      saveFn,
      {
        contextForRecord: (note) => ({
          url: `file:${note.id}`,
          title: note.filePath,
        }),
      },
      (state) => onChangeFn(browserDraft(state)),
    );
  }

  activate(note: BrowserNote): Draft {
    return browserDraft(this.coordinator.activate(note));
  }

  edit(key: string, text: string): Draft | undefined {
    const state = this.coordinator.edit(key, text);
    return state ? browserDraft(state) : undefined;
  }

  flush(key: string): Promise<boolean> {
    return this.coordinator.flush(key);
  }

  flushAll(): Promise<boolean> {
    return this.coordinator.flushAll();
  }

  get(key: string): Draft | undefined {
    const state = this.coordinator.get(key);
    return state ? browserDraft(state) : undefined;
  }

  dirtyDrafts(): Draft[] {
    return this.coordinator.dirtyDrafts().map(browserDraft);
  }

  pendingDrafts(): Draft[] {
    return this.coordinator.pendingDrafts().map(browserDraft);
  }

  hasPendingChanges(): boolean {
    return this.coordinator.hasPendingChanges();
  }

  dispose(): void {
    this.coordinator.dispose();
  }
}
