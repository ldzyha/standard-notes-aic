import { describe, expect, it } from "vitest";
import { NoteDraftRegistry } from "../src/note-draft-registry";

describe("working-note draft registry", () => {
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
