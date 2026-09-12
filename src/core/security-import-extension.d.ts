import type { Extension, StateEffectType } from "@codemirror/state";

export const securityImportSaved: StateEffectType<null>;

/** The host must return true only after acknowledging the current saved draft. */
export type SecurityImportOptions = {
  onSave?: () => boolean | Promise<boolean>;
};

/** Converts explicitly; save-capable hosts commit through their normal manager. */
export function makeSecurityImportExtension(
  options?: SecurityImportOptions,
): Extension;
