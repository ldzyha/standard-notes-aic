import { describe, expect, it } from "vitest";
import {
  AIC_EMPTY_DOCUMENT,
  isSecretPart,
  parseSecurityBlock,
  parseSecurityDocument,
  redactSecurityBlocks,
  safeSecurityUrl,
  SECURITY_LIMITS,
  securityTemplate,
  serializeSecurityBlock,
  type SecurityModel,
  type SecurityPart,
} from "../src/core/security-model.js";
import { SECURITY_FIELD_OPTIONS } from "../src/core/field-syntax.js";
const invalid = { ok: false, code: "invalid_security_block" };
function model(parts: readonly SecurityPart[], label = "Row"): SecurityModel {
  return { sections: [{ label: "", fields: [{ label, parts }] }] };
}
describe("Security typed-pipe model", () => {
  it("round-trips independently typed values in one row without shadow slots", () => {
    const body =
      "Card _| 4111111111111111 | 12/30 *| 123 #| JBSWY3DPEHPK3PXP 1| active 0| spent\n";
    const parsed = parseSecurityBlock(body);
    expect(parsed).toEqual({
      ok: true,
      model: model(
        [
          { kind: "card", value: "4111111111111111" },
          { kind: "text", value: "12/30" },
          { kind: "secret", value: "123" },
          { kind: "totp", value: "JBSWY3DPEHPK3PXP" },
          { kind: "one-time", value: "active" },
          { kind: "used", value: "spent" },
        ],
        "Card",
      ),
    });
    if (!parsed.ok) return;
    expect(serializeSecurityBlock(parsed.model)).toBe(body);
    expect(parseSecurityBlock(body, SECURITY_FIELD_OPTIONS)).toEqual(parsed);
    expect(Object.keys(parsed.model.sections[0]!.fields[0]!)).toEqual([
      "label",
      "parts",
    ]);
  });
  it("types follow separators, never labels, positions, or inferred card roles", () => {
    for (const label of [
      "Password",
      "Recovery codes",
      "Card",
      "TOTP",
      "Email",
    ]) {
      expect(parseSecurityBlock(label + " | arbitrary")).toEqual({
        ok: true,
        model: model([{ kind: "text", value: "arbitrary" }], label),
      });
    }
    expect(
      parseSecurityBlock("Anything | expiry *| cvv _| 4111111111111111").ok,
    ).toBe(true);
    expect(parseSecurityBlock("Anything _| invalid")).toEqual(invalid);
  });
  it("preserves optional labels, duplicates and explicitly empty typed values", () => {
    const body = "| value\n*|\n#|\n_|\n1|\n0|\n";
    const parsed = parseSecurityBlock(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      parsed.model.sections[0]!.fields.map((field) => field.label),
    ).toEqual(["", "", "", "", "", ""]);
    expect(serializeSecurityBlock(parsed.model)).toBe(body);
    expect(parseSecurityBlock("Same | a\nSame *| b").ok).toBe(true);
  });
  it("preserves quoted punctuation and heading-looking labels without old colon parsing", () => {
    for (const label of [
      "Colon: label",
      "Pipe | label",
      'Quote "label"',
      "# title",
      "## section",
      "---",
      "__proto__",
      "Ends*",
      "Ends0",
      "\\path",
    ]) {
      const source = model([{ kind: "text", value: "value" }], label);
      expect(parseSecurityBlock(serializeSecurityBlock(source))).toEqual({
        ok: true,
        model: source,
      });
    }
    for (const body of [
      "Password*: private",
      "Password: visible | note",
      "TOTP#: seed",
      "sections:\n  - label: Main",
    ]) {
      expect(parseSecurityBlock(body)).toEqual(invalid);
    }
  });
  it("round-trips JSON values with literal pipes, all modifiers, controls and whitespace", () => {
    const values = [
      "a|b*|c#|d_|e1|f0|g",
      '"quoted"',
      "  space  ",
      "\\path\n\r\t😀\u2028end",
      "suffix*",
      "suffix#",
      "suffix_",
      "suffix1",
      "suffix0",
    ];
    const source = model(values.map((value) => ({ kind: "secret", value })));
    const encoded = serializeSecurityBlock(source);
    expect(encoded.split("\n")).toHaveLength(2);
    expect(parseSecurityBlock(encoded)).toEqual({ ok: true, model: source });
  });
  it("preserves card titles and explicit/implicit sections", () => {
    const source: SecurityModel = {
      title: "Accounts: C:\\folder",
      sections: [
        {
          label: "",
          fields: [{ label: "Name", parts: [{ kind: "text", value: "one" }] }],
        },
        {
          label: "Secondary",
          fields: [
            { label: "Name", parts: [{ kind: "secret", value: "two" }] },
          ],
        },
        { label: "", fields: [] },
      ],
    };
    expect(parseSecurityBlock(serializeSecurityBlock(source))).toEqual({
      ok: true,
      model: source,
    });
    expect(parseSecurityBlock("\n#\r\n\r\n##\r\n")).toEqual({
      ok: true,
      model: { title: "", sections: [{ label: "", fields: [] }] },
    });
    expect(
      serializeSecurityBlock({ sections: [{ label: "", fields: [] }] }),
    ).toBe("\n");
    expect(parseSecurityBlock("# Only title")).toEqual({
      ok: true,
      model: { title: "Only title", sections: [{ label: "", fields: [] }] },
    });
  });
  it("rejects repeated, misplaced and malformed title headings", () => {
    for (const body of [
      "# \n",
      "# First\n# Second",
      "#  padded",
      "# trailing ",
      "# bad\\q",
      "## Main\n# misplaced",
      "### invalid",
      "# literal\tcontrol",
    ])
      expect(parseSecurityBlock(body)).toEqual(invalid);
    for (const title of [
      " padded",
      "trailing ",
      "line\nbreak",
      "\u0000",
      "\uD800",
    ])
      expect(() =>
        serializeSecurityBlock({
          title,
          sections: [{ label: "", fields: [] }],
        }),
      ).toThrow("invalid security block");
  });
  it("bounds parts, rows, sections and encoded bodies in both directions", () => {
    expect(SECURITY_LIMITS).toMatchObject({
      maxParts: 64,
      maxFields: 64,
      maxSections: 16,
      maxBodyLength: 65536,
      maxValueLength: 16384,
    });
    const part = { kind: "text" as const, value: "x" };
    expect(
      parseSecurityBlock(serializeSecurityBlock(model(Array(64).fill(part))))
        .ok,
    ).toBe(true);
    expect(() => serializeSecurityBlock(model(Array(65).fill(part)))).toThrow();
    expect(() =>
      serializeSecurityBlock(
        model([{ kind: "text", value: "x".repeat(16384) }]),
      ),
    ).toThrow();
    const row = { label: "", parts: [part] };
    expect(() =>
      serializeSecurityBlock({
        sections: [{ label: "", fields: Array(65).fill(row) }],
      }),
    ).toThrow();
    expect(() =>
      serializeSecurityBlock({
        sections: Array(17).fill({ label: "", fields: [] }),
      }),
    ).toThrow();
    expect(parseSecurityBlock("x".repeat(65537))).toEqual(invalid);
    expect(() =>
      serializeSecurityBlock({
        sections: [
          {
            label: "",
            fields: Array(8).fill({
              label: "",
              parts: [{ kind: "text", value: "x".repeat(10000) }],
            }),
          },
        ],
      }),
    ).toThrow();
  });
  it("rejects old and malformed model shapes rather than retaining compatibility shadows", () => {
    for (const field of [
      { label: "X", value: "secret", hide: true },
      { label: "X", parts: [] },
      { label: "X", parts: [{ kind: "unknown", value: "x" }] },
      { label: "X", parts: [{ kind: "secret", value: "x", hide: true }] },
    ]) {
      expect(() =>
        serializeSecurityBlock({
          sections: [{ label: "", fields: [field] }],
        } as never),
      ).toThrow("invalid security block");
    }
  });
  it("classifies every non-text part as confidential, including masked card numbers", () => {
    for (const kind of ["secret", "totp", "card", "one-time", "used"] as const)
      expect(isSecretPart({ kind })).toBe(true);
    expect(isSecretPart({ kind: "text" })).toBe(false);
  });
  it("emits a valid canonical template and validates complete fenced documents only", () => {
    const template = securityTemplate();
    expect(template).toContain(
      "Service |\n|\nEmail |\nURL |\nTOTP #|\nPassword *|\n",
    );
    expect(parseSecurityDocument(template).ok).toBe(true);
    expect(parseSecurityDocument(AIC_EMPTY_DOCUMENT).ok).toBe(true);
    expect(parseSecurityDocument("prose\n" + template)).toEqual(invalid);
    expect(parseSecurityDocument(template + "\nprose")).toEqual(invalid);
    expect(parseSecurityDocument(template.slice(0, -3))).toEqual(invalid);
  });
  it("accepts only HTTP(S) URLs without embedded credentials or controls", () => {
    expect(safeSecurityUrl(" https://example.test/a:b ")).toBe(
      "https://example.test/a:b",
    );
    for (const value of [
      "javascript:alert(1)",
      "file:///tmp/x",
      "https://user:pass@example.test/",
      "https://example.test/\nmalicious",
      "https://",
      5,
    ])
      expect(safeSecurityUrl(value)).toBe("");
  });

  it("redacts closed, malformed, and unclosed security fences", () => {
    const source = [
      "Before",
      "```aic",
      "current-secret",
      "```",
      "```aic-security",
      "not valid yaml: test-secret-one",
      "```",
      "Between",
      "~~~aic-security extra-info",
      "test-secret-two",
      "~~~~",
      "After",
      "```js",
      "const label = 'aic-security';",
      "```",
    ].join("\r\n");
    expect(redactSecurityBlocks(source)).toBe(
      [
        "Before",
        "Between",
        "After",
        "```js",
        "const label = 'aic-security';",
        "```",
      ].join("\r\n"),
    );
    expect(
      redactSecurityBlocks(
        "Visible\n```aic-security\nnever-closed-test-secret\nnext",
      ),
    ).toBe("Visible\n");
    expect(
      redactSecurityBlocks("```aic v3\nunsupported-secret\n```\nEnd"),
    ).toBe("End");
    expect(
      redactSecurityBlocks("```markdown\n```aic-security\nexample only\n```\n"),
    ).toBe("```markdown\n```aic-security\nexample only\n```\n");
  });

  it("redacts fences in Markdown containers without mistaking nested quotes for their close", () => {
    for (const [open, prefix, close] of [
      ["> ```aic-security", "> ", "> ```"],
      ["- ```aic-security", "  ", "  ```"],
      ["> 1. > ~~~aic-security", ">    > ", ">    > ~~~"],
    ]) {
      const source = [
        "Before",
        open,
        prefix + "## Main",
        prefix + "Password*: secret-value",
        close,
        "After",
      ].join("\n");
      expect(redactSecurityBlocks(source)).toBe("Before\nAfter");
    }
    expect(
      redactSecurityBlocks(
        "```aic-security\n> ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
    expect(
      redactSecurityBlocks(
        "```aic-security\n- ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
    expect(
      redactSecurityBlocks(
        "```aic-security\n    ```\nPassword*: secret-value\n```\nAfter",
      ),
    ).toBe("After");
  });

  it("does not let ended containers or invalid code-fence info suppress redaction", () => {
    for (const prefix of [
      "> ```text\n> example\n",
      "- ```text\n  example\n",
      "```not`a-fence\n",
    ]) {
      const result = redactSecurityBlocks(
        prefix +
          "```aic-security\n## Main\nPassword*: secret-value\n```\nAfter",
      );
      expect(result).not.toContain("secret-value");
      expect(result).toContain("After");
    }
  });
});
