import { Annotation } from "@codemirror/state";

// The shared editor reports intent; each host's parent manager owns persistence,
// note identity, serialization, acknowledgement and retry. Typing is not a save.
export const saveAction = Annotation.define();

export function isSaveAction(update) {
  return (
    update.docChanged &&
    update.transactions.some(
      (transaction) => transaction.annotation(saveAction) === true,
    )
  );
}

/** Save when leaving the whole editing surface, not between its child controls. */
export function wireSaveBoundary(root, onSave) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  let disposed = false;
  const request = () => {
    if (!disposed && root.isConnected) onSave();
  };
  const leave = (event) => {
    const next = event.relatedTarget;
    if (next && typeof next.nodeType === "number" && root.contains(next))
      return;
    request();
  };
  const windowBlur = () => {
    if (root.contains(document.activeElement)) request();
  };
  root.addEventListener("focusout", leave);
  window?.addEventListener("blur", windowBlur);
  return () => {
    if (disposed) return;
    disposed = true;
    root.removeEventListener("focusout", leave);
    window?.removeEventListener("blur", windowBlur);
  };
}
