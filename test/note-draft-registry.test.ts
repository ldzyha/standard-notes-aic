import { describe, expect, it } from "vitest";
import { NoteDraftRegistry } from "../src/note-draft-registry";

describe("working-note draft registry", () => {
  it("keeps a pending draft dirty until the matching operation is acknowledged", () => {
    const drafts = new NoteDraftRegistry();
    drafts.activate("a", "Original", 1);
    drafts.edit("Changed");
    const first = drafts.begin()!;
    expect(drafts.current).toMatchObject({ dirty: true, pending: true });
    expect(drafts.begin()).toBeNull();
    expect(drafts.activate("a", "Changed", 2)).toMatchObject({
      dirty: true,
      pending: true,
    });
    expect(drafts.activate("a", "Original", 3)).toMatchObject({
      text: "Changed",
      dirty: true,
    });
    drafts.edit("Newer");
    drafts.activate("b", "B", 4);
    drafts.edit("B edit");
    expect(
      drafts.acknowledge({
        ...first,
        operationId: first.operationId + 1,
        saved: true,
      }),
    ).toBe(false);
    drafts.acknowledge({ ...first, saved: true });
    expect(drafts.current).toMatchObject({
      id: "b",
      text: "B edit",
      dirty: true,
    });
    expect(drafts.activate("a", "Changed", 5)).toMatchObject({
      text: "Newer",
      dirty: true,
      pending: false,
    });
    const second = drafts.begin()!;
    drafts.acknowledge({ ...first, saved: false });
    expect(drafts.current?.pending).toBe(true);
    drafts.acknowledge({ ...second, saved: false });
    expect(drafts.current).toMatchObject({ dirty: true, pending: false });
  });

  it("keeps dirty drafts attached to their note and prunes clean sessions", () => {
    const drafts = new NoteDraftRegistry();
    drafts.activate("a", "A", 1);
    drafts.edit("A local");

    expect(drafts.activate("a", "A remote", 2)).toMatchObject({
      id: "a",
      text: "A local",
      dirty: true,
    });
    expect(drafts.activate("b", "B", 1)).toMatchObject({
      id: "b",
      text: "B",
      dirty: false,
    });
    expect(drafts.activate("a", "A", 3)).toMatchObject({
      id: "a",
      text: "A local",
      dirty: true,
    });

    const commit = drafts.begin("explicit")!;
    drafts.acknowledge({ ...commit, saved: true });
    expect(drafts.current).toMatchObject({ text: "A local", dirty: false });
    expect(drafts.activate("a", "A synced", 4)).toMatchObject({
      text: "A synced",
      dirty: false,
    });
  });
});
