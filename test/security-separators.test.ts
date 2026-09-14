import { describe, expect, it } from "vitest";
import {
  SECURITY_FENCE_INFO,
  SECURITY_FIELD_OPTIONS,
} from "../src/core/field-syntax.js";
import {
  parseSecurityBlock,
  SECURITY_LIMITS,
  securityTemplate,
  serializeSecurityBlock,
  type SecurityModel,
} from "../src/core/security-model.js";

describe("Security separators", () => {
  it("publishes the canonical contract and limits", () => {
    expect(SECURITY_FENCE_INFO).toBe("aic");
    expect(SECURITY_FIELD_OPTIONS).toEqual({
      fieldSyntax: "pipes",
      sectionSyntax: "separators",
      allowEmptyLabel: true,
    });
    expect(Object.isFrozen(SECURITY_LIMITS)).toBe(true);
    expect(SECURITY_LIMITS).toEqual({
      maxSections: 16,
      maxFields: 64,
      maxBodyLength: 65536,
      maxValueLength: 16384,
    });
    expect(securityTemplate()).toMatch(/^```aic\nService:/u);
    expect(securityTemplate()).not.toMatch(/^##/mu);
  });

  it("round-trips titled and untitled sections with only --- boundaries", () => {
    const model: SecurityModel = {
      title: "Accounts",
      sections: [
        {
          label: "",
          fields: [{ label: "Service", value: "A", hide: false }],
        },
        {
          label: "Work",
          fields: [
            { label: "Password", value: "s|x", hide: true },
            {
              label: "Card",
              value: "4111111111111111",
              description: "09/28",
              additionalSecret: "123",
              hide: false,
              kind: "card",
            },
          ],
        },
        {
          label: "",
          fields: [{ label: "TOTP", value: "seed", hide: true, kind: "totp" }],
        },
      ],
    };
    const body = serializeSecurityBlock(model, SECURITY_FIELD_OPTIONS);
    expect(body).toBe(
      '# Accounts\nService: A\n---\n## Work\nPassword*: "s|x"\nCard_: 4111111111111111 | 09/28 | 123\n---\nTOTP#: seed\n',
    );
    expect(parseSecurityBlock(body, SECURITY_FIELD_OPTIONS)).toEqual({
      ok: true,
      model,
    });
    expect(
      parseSecurityBlock(body, {
        ...SECURITY_FIELD_OPTIONS,
        diagnostics: true,
      }),
    ).toMatchObject({
      ok: true,
      fieldRanges: [
        [{ from: body.indexOf("Service:"), to: body.indexOf("\n---") }],
        [
          { from: body.indexOf("Password*:"), to: body.indexOf("\nCard_:") },
          {
            from: body.indexOf("Card_:"),
            to: body.indexOf("\n---", body.indexOf("Card_:")),
          },
        ],
        [{ from: body.indexOf("TOTP#:"), to: body.lastIndexOf("\n") }],
      ],
    });
  });

  it("preserves empty sections and optional ## titles", () => {
    for (const model of [
      { sections: [{ label: "", fields: [] }] },
      {
        sections: [
          { label: "", fields: [] },
          { label: "", fields: [] },
        ],
      },
      {
        title: "",
        sections: [
          { label: "One", fields: [] },
          { label: "", fields: [] },
        ],
      },
    ] satisfies SecurityModel[]) {
      const body = serializeSecurityBlock(model, SECURITY_FIELD_OPTIONS);
      expect(parseSecurityBlock(body, SECURITY_FIELD_OPTIONS)).toEqual({
        ok: true,
        model,
      });
    }
    expect(
      parseSecurityBlock("Field: value\n", SECURITY_FIELD_OPTIONS),
    ).toEqual({
      ok: true,
      model: {
        sections: [
          {
            label: "",
            fields: [{ label: "Field", value: "value", hide: false }],
          },
        ],
      },
    });
  });

  it("rejects heading-only section boundaries without ---, regardless of options", () => {
    const old = "## First\nField: one\n## Second\nField: two\n";
    expect(parseSecurityBlock(old)).toMatchObject({ ok: false });
    expect(parseSecurityBlock(old, SECURITY_FIELD_OPTIONS)).toMatchObject({
      ok: false,
    });
    const model: SecurityModel = {
      sections: [
        { label: "", fields: [] },
        { label: "", fields: [] },
      ],
    };
    expect(serializeSecurityBlock(model)).toBe("---\n");
    expect(
      parseSecurityBlock("Field: value", SECURITY_FIELD_OPTIONS),
    ).toMatchObject({ ok: true });
    expect(parseSecurityBlock("Field: value")).toMatchObject({ ok: true });
  });

  it("rejects misplaced/duplicate titles and overflows without leaking source", () => {
    for (const [body, code] of [
      ["# One\n# Two\nField: secret-9031", "duplicate_title"],
      ["Field: secret-9031\n# Two", "misplaced_title"],
      ["Field: secret-9031\n## More", "misplaced_section_title"],
      ["## One\n## Two", "misplaced_section_title"],
      [`${"---\n".repeat(16)}Field: secret-9031`, "too_many_sections"],
      [`${"Field: x\n".repeat(64)}Extra: secret-9031`, "too_many_fields"],
    ] as const) {
      const parsed = parseSecurityBlock(body, {
        ...SECURITY_FIELD_OPTIONS,
        diagnostics: true,
      });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.diagnostic.code).toBe(code);
      expect(JSON.stringify(parsed.diagnostic)).not.toContain("secret-9031");
    }
  });

  it("accepts an exact-size body but rejects a noncanonical rewrite that adds a newline", () => {
    const body = `${`A: ${"x".repeat(16380)}\n`.repeat(3)}A: ${"x".repeat(16381)}`;
    expect(body.length).toBe(SECURITY_LIMITS.maxBodyLength);
    const parsed = parseSecurityBlock(body, SECURITY_FIELD_OPTIONS);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(() =>
        serializeSecurityBlock(parsed.model, SECURITY_FIELD_OPTIONS),
      ).toThrow("invalid security block");
  });
});
