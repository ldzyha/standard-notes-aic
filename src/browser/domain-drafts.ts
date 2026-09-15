import type { BrowserDomain } from "./library";
import type {
  DraftState,
  SaveDocument,
  CreateDocument,
} from "./draft-coordinator";
import { SharedDrafts } from "./shared-drafts";

export interface DomainContext {
  origin: string;
  title: string;
}
export type DomainDraft = DraftState<BrowserDomain, DomainContext>;
export type DomainSaveFn = SaveDocument<BrowserDomain>;
export type DomainCreateFn = CreateDocument<BrowserDomain, DomainContext>;

/** Origin adapter; global properties share the same draft protocol. */
export class DomainDrafts extends SharedDrafts<BrowserDomain, DomainContext> {
  constructor(
    saveFn: DomainSaveFn,
    onChangeFn: (draft: DomainDraft) => void = () => undefined,
    createFn?: DomainCreateFn,
  ) {
    super(
      saveFn,
      {
        contextKey: (context) => context.origin,
        contextForRecord: (record) => ({
          origin: record.origin,
          title: new URL(record.origin).host,
        }),
        pageChangedMessage:
          "Return to this domain to save your new Properties, or export the draft.",
      },
      onChangeFn,
      createFn,
    );
  }
}
