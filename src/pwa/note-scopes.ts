import type { PwaFile, PwaPayload } from "./model";
export type NoteScope = "current" | "shared" | "global";
export interface ScopedNote {
  id: string;
  title: string;
  markdown?: string;
  file?: PwaFile;
}
const key = (path: string) => path.normalize("NFC").toLowerCase();
/** Existing sibling folder sidecars and project sidecars; labels are never identities. */
export function fileScopeNotes(
  files: readonly PwaFile[],
  selectedId: string,
): Partial<Record<NoteScope, ScopedNote>> {
  const current = files.find((file) => file.id === selectedId);
  if (!current) return {};
  const byPath = new Map(files.map((file) => [key(file.path), file]));
  const note = (file: PwaFile | undefined): ScopedNote | undefined =>
    file ? { id: file.id, title: file.path, file } : undefined;
  const parts = current.path.split("/");
  const root = parts.length > 1 ? parts[0]! : null;
  const global = root ? byPath.get(key(`${root}/${root}.note.md`)) : undefined;
  let shared: PwaFile | undefined;
  for (let depth = parts.length - 1; depth > 1; depth--) {
    const candidate = byPath.get(
      key(`${parts.slice(0, depth).join("/")}.note.md`),
    );
    if (
      candidate &&
      candidate.id !== current.id &&
      candidate.id !== global?.id
    ) {
      shared = candidate;
      break;
    }
  }
  return {
    current: note(current),
    shared: note(shared),
    global: global?.id === current.id ? undefined : note(global),
  };
}
export function scopedNotes(
  payload: PwaPayload,
  selectedId: string,
): Partial<Record<NoteScope, ScopedNote>> {
  return fileScopeNotes(payload.files, selectedId);
}
