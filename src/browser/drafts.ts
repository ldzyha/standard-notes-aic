import type { BrowserNote, PageContext } from "./library";
import {
  AUTOSAVE_DELAY_MS,
  DraftCoordinator,
  type DraftState,
} from "./draft-coordinator";

export { AUTOSAVE_DELAY_MS };

export interface Draft {
  key: string;
  page: PageContext;
  note: BrowserNote | null;
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
export type BrowserCreateFn = (
  page: PageContext,
  markdown: string,
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

/** Backward-compatible page-note draft surface over the shared coordinator. */
export class BrowserDrafts {
  private readonly coordinator: DraftCoordinator<BrowserNote, PageContext>;

  constructor(
    saveFn: BrowserSaveFn,
    onChangeFn: (draft: Draft) => void = () => undefined,
    createFn?: BrowserCreateFn,
  ) {
    this.coordinator = new DraftCoordinator(
      saveFn,
      {
        contextKey: (page) => page.url,
        contextForRecord: (note) => ({ url: note.url, title: note.title }),
      },
      (state) => onChangeFn(browserDraft(state)),
      createFn,
    );
  }

  activate(note: BrowserNote): Draft {
    return browserDraft(this.coordinator.activate(note));
  }

  activatePlaceholder(page: PageContext, seed: string): Draft {
    return browserDraft(this.coordinator.activatePlaceholder(page, seed));
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

  hasPendingChanges(): boolean {
    return this.coordinator.hasPendingChanges();
  }

  dispose(): void {
    this.coordinator.dispose();
  }
}
