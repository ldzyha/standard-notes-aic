import {
  appendPageText,
  notePages,
  pageForTarget,
} from "../core/note-pages.js";
import type { BrowserNote, PageContext } from "./library";
import {
  AUTOSAVE_DELAY_MS,
  DraftCoordinator,
  type DraftState,
} from "./draft-coordinator";

export { AUTOSAVE_DELAY_MS };

const pageOf = (text: string, target: string) => {
  const pages = notePages(text);
  const index = pageForTarget(pages, target);
  const page = pages[index];
  if (!page) return null;
  const whole = text.slice(page.content, page.to);
  const body = whole.replace(/[ \t\r\n]+$/u, "");
  return {
    last: index === pages.length - 1,
    before: text.slice(0, page.content),
    body,
    // Blank lines that keep the next separator a separator belong to the file.
    gap: whole.slice(body.length),
    after: text.slice(page.to),
  };
};

/**
 * Carry a draft that changed only the page of `target` onto note text that
 * changed on disk since the draft started from `base`. Every byte of `disk`
 * outside that page is kept. Returns null, changing nothing, when the page
 * itself differs on disk, when the draft touched anything else, or when the
 * result would not read back as that page.
 */
export function rebaseFocusedPage(
  base: string,
  draft: string,
  disk: string,
  target: string | null,
): string | null {
  if (target === null) return null;
  const mine = pageOf(draft, target);
  if (!mine) return null;
  const was = pageOf(base, target);
  const now = pageOf(disk, target);
  let merged: string;
  if (!was) {
    // The draft appended the page: append it to the disk text the same way.
    const added = appendPageText(base, target);
    const tail = mine.body + mine.gap;
    if (now || !added || !mine.last || draft !== base + added + tail)
      return null;
    const start = appendPageText(disk, target);
    if (!start) return null;
    merged = disk + start + tail;
  } else {
    if (
      !now ||
      now.body !== was.body ||
      mine.before !== was.before ||
      mine.after !== was.after
    )
      return null;
    merged = now.before + mine.body + now.gap + now.after;
  }
  const result = pageOf(merged, target);
  return result && result.body === mine.body ? merged : null;
}

export interface Draft {
  key: string;
  /** Names the note file in recovery copies: `file:<id>` and its path. */
  page: PageContext;
  note: BrowserNote;
  text: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** The last save found other text on disk. */
  conflict: boolean;
}

/** How a draft is carried onto a note file that changed on disk. */
export interface BrowserConflictRecovery {
  reload(id: string): Promise<BrowserNote>;
  rebase(
    baseText: string,
    draftText: string,
    stored: BrowserNote,
  ): string | null;
  adopted(draft: Draft): void;
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
    conflict: state.conflict,
  };
}

/** The note file's draft over the shared autosave coordinator. */
export class BrowserDrafts {
  private readonly coordinator: DraftCoordinator<BrowserNote, PageContext>;

  constructor(
    saveFn: BrowserSaveFn,
    onChangeFn: (draft: Draft) => void = () => undefined,
    recovery: BrowserConflictRecovery | null = null,
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
      recovery && {
        reload: (id) => recovery.reload(id),
        rebase: (base, text, stored) => recovery.rebase(base, text, stored),
        adopted: (state) => recovery.adopted(browserDraft(state)),
      },
    );
  }

  activate(note: BrowserNote): Draft {
    return browserDraft(this.coordinator.activate(note));
  }

  edit(key: string, text: string): Draft | undefined {
    const state = this.coordinator.edit(key, text);
    return state ? browserDraft(state) : undefined;
  }

  /** Drop the draft and take `note` as read from disk; writes nothing. */
  discard(key: string, note: BrowserNote): Draft | undefined {
    const state = this.coordinator.discard(key, note);
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
