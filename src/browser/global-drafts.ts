import type { BrowserGlobal } from "./library";
import type {
  DraftState,
  SaveDocument,
  CreateDocument,
} from "./draft-coordinator";
import { SharedDrafts } from "./shared-drafts";

export interface GlobalContext {
  scope: "global";
  title: "Global";
}
export type GlobalDraft = DraftState<BrowserGlobal, GlobalContext>;
export const GLOBAL_CONTEXT: GlobalContext = {
  scope: "global",
  title: "Global",
};

export class GlobalDrafts extends SharedDrafts<BrowserGlobal, GlobalContext> {
  constructor(
    saveFn: SaveDocument<BrowserGlobal>,
    onChangeFn: (draft: GlobalDraft) => void = () => undefined,
    createFn?: CreateDocument<BrowserGlobal, GlobalContext>,
  ) {
    super(
      saveFn,
      {
        contextKey: (context) => context.scope,
        contextForRecord: (record) => ({
          scope: record.scope,
          title: "Global",
        }),
      },
      onChangeFn,
      createFn,
    );
  }
}
