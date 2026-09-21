import { describe, expect, it } from "vitest";
import {
  createSecurityRowTemplate,
  SECURITY_ROW_TEMPLATES,
} from "../src/core/security-templates.js";
import {
  parseSecurityBlock,
  serializeSecurityBlock,
} from "../src/core/security-model.js";

describe("ordinary row usage templates", () => {
  it.each(SECURITY_ROW_TEMPLATES)(
    "creates editable, serializer-valid $label",
    ({ id }) => {
      const row = createSecurityRowTemplate(id);
      const model = { sections: [{ label: "", fields: [row] }] };
      expect(parseSecurityBlock(serializeSecurityBlock(model))).toEqual({
        ok: true,
        model,
      });
      expect(row.parts.every((part) => part.value === "")).toBe(true);
      expect(createSecurityRowTemplate(id)).not.toBe(row);
      expect(createSecurityRowTemplate(id).parts).not.toBe(row.parts);
    },
  );
  it("defines independent card/date/CVV types and rejects unknown presets", () => {
    expect(SECURITY_ROW_TEMPLATES.map(({ id }) => id)).not.toContain("account");
    expect(() => createSecurityRowTemplate("account" as "blank")).toThrow(
      "Unknown row template",
    );
    expect(
      createSecurityRowTemplate("card").parts.map((part) => part.kind),
    ).toEqual(["card", "text", "secret"]);
    expect(() => createSecurityRowTemplate("unknown" as "blank")).toThrow(
      "Unknown row template",
    );
  });
});
