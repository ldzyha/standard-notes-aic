import { describe, expect, it, vi } from "vitest";
import {
  StandardNotesHost,
  type StandardNotesApi,
} from "../src/standard-notes-host";

describe("Standard Notes host adapter", () => {
  it("fails closed when the working-note identity changes", () => {
    let text = "";
    let preview = "";
    let subscriber: ((text: string, meta: unknown) => void) | null = null;
    const api = {
      initialize: vi.fn(),
      subscribe: vi.fn((callback: (text: string, meta: unknown) => void) => {
        subscriber = callback;
        return vi.fn();
      }),
      locked: false,
      lastStreamedItem: { uuid: "note-a" },
      get text() {
        return text;
      },
      set text(value: string) {
        text = value;
      },
      get preview() {
        return preview;
      },
      set preview(value: string) {
        preview = value;
      },
    };
    const host = new StandardNotesHost(api as StandardNotesApi);
    host.initialize();
    const snapshot = vi.fn();
    host.subscribe(snapshot);
    const emit = subscriber as ((text: string, meta: unknown) => void) | null;
    if (!emit) throw new Error("Standard Notes subscriber was not registered");
    emit("A", {});

    expect(api.initialize).toHaveBeenCalledWith({ debounceSave: 0 });
    expect(snapshot).toHaveBeenCalledWith({
      id: "note-a",
      text: "A",
      locked: false,
    });
    expect(host.save("note-a", "saved", "preview")).toBe(true);
    expect({ text, preview }).toEqual({ text: "saved", preview: "preview" });

    api.lastStreamedItem = { uuid: "note-b" };
    expect(host.save("note-a", "wrong", "wrong")).toBe(false);
    expect({ text, preview }).toEqual({ text: "saved", preview: "preview" });
  });
});
