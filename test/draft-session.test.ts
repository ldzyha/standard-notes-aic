import { describe, expect, it } from "vitest";
import {
  AIC_EDITOR_CORE_VERSION,
  DraftSession,
} from "../src/core/draft-session.js";

describe("shared draft core", () => {
  it("keeps local input until a commit boundary and preserves failed drafts", () => {
    const draft = new DraftSession();
    expect(AIC_EDITOR_CORE_VERSION).toBe("1.0.0");
    draft.hydrate("base", 3);
    draft.edit("base + local");
    expect(draft.external("remote", 4)).toBe(false);
    expect(draft.begin("blur")).toEqual({
      text: "base + local",
      generation: 3,
      reason: "blur",
    });
    expect(draft.begin("explicit")).toBeNull();
    draft.acknowledge({ text: "base + local", generation: 3, saved: false });
    expect(draft.dirty).toBe(true);
    const retry = draft.begin("explicit")!;
    draft.acknowledge({ ...retry, saved: true });
    expect(draft.dirty).toBe(false);
  });
});
