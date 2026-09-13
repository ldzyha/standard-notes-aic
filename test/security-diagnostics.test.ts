import { describe, expect, it } from "vitest";
import { parseSecurityBlock } from "../src/core/security-model.js";

const pipes = { fieldSyntax: "pipes", diagnostics: true } as const;

function failure(
  body: string,
  options: { fieldSyntax?: "pipes"; diagnostics: true } = { diagnostics: true },
) {
  const result = parseSecurityBlock(body, options);
  expect(result.ok).toBe(false);
  if (result.ok || !result.diagnostic) throw new Error("Missing diagnostic");
  expect(result.code).toBe("invalid_security_block");
  expect(result.diagnostic.from).toBeGreaterThanOrEqual(0);
  expect(result.diagnostic.to).toBeLessThanOrEqual(body.length);
  expect(result.diagnostic.line).toBeGreaterThan(0);
  expect(result.diagnostic.column).toBeGreaterThan(0);
  return result.diagnostic;
}

describe("Security parser diagnostics", () => {
  it("keeps default results unchanged and maps valid fields in UTF-16 offsets", () => {
    const body =
      "# Cards\r\n## Main\r\n😀: one\r\nCard_: 4111111111111111 | 09/28 | 123\r\n";
    const plain = parseSecurityBlock(body, { fieldSyntax: "pipes" });
    const detailed = parseSecurityBlock(body, pipes);
    expect(plain).toEqual({
      ok: true,
      model: detailed.ok ? detailed.model : undefined,
    });
    expect(detailed.ok).toBe(true);
    if (!detailed.ok) return;
    expect(detailed.fieldRanges).toEqual([
      [
        {
          from: body.indexOf("😀:"),
          to: body.indexOf("\r\nCard_"),
        },
        {
          from: body.indexOf("Card_:"),
          to: body.lastIndexOf("\r\n"),
        },
      ],
    ]);
  });

  it("points to repeated or misplaced card titles after a merge", () => {
    const duplicate = "# First\n# Second\n## Main\n";
    expect(failure(duplicate).code).toBe("duplicate_title");
    const merged =
      "# First\r\n## Main\r\nPassword*: synthetic-private\r\n# Second\r\n## Other\r\n";
    const diagnostic = failure(merged);
    expect(diagnostic).toMatchObject({
      code: "misplaced_title",
      from: merged.indexOf("# Second"),
      line: 4,
      column: 1,
    });
    expect(diagnostic.message).toMatch(/## section|fence/u);
    expect(JSON.stringify(diagnostic)).not.toContain("synthetic-private");
    const fence =
      "## Main\nPassword*: synthetic-private\n```aic-security v2\n## More\n";
    expect(failure(fence).code).toBe("nested_fence");
  });

  it("locates missing headings, labels, colon, space, escapes and pipe bounds", () => {
    expect(failure("Token: synthetic-private").code).toBe("missing_section");
    expect(failure("## \nToken: synthetic-private").code).toBe(
      "invalid_section_label",
    );
    expect(failure("## Main\nBad**: synthetic-private").code).toBe(
      "invalid_field_label",
    );
    expect(failure("## Main\nToken synthetic-private").code).toBe(
      "missing_field_colon",
    );
    expect(failure("## Main\nToken:synthetic-private").code).toBe(
      "missing_value_space",
    );
    const escaped = "## Main\r\n😀: syn\\@synthetic-private\r\n";
    expect(failure(escaped, pipes)).toMatchObject({
      code: "invalid_escape",
      from: escaped.indexOf("\\@"),
      line: 2,
      column: 8,
    });
    const parts = "## Main\nToken: one | two | three | synthetic-private";
    expect(failure(parts, pipes)).toMatchObject({
      code: "too_many_parts",
      from: parts.lastIndexOf("|"),
    });
  });

  it("uses card-part validation to identify number, date, and CVV", () => {
    for (const [body, code, needle] of [
      ["Card_: 123 | 09/28 | 123", "invalid_card_number", "123 |"],
      ["Card_: 4111111111111111 | 13/28 | 123", "invalid_card_date", "13/28"],
      ["Card_: 4111111111111111 | 09/28 | 12", "invalid_card_cvv", "12"],
    ] as const) {
      const source = `## Main\n${body}`;
      const diagnostic = failure(source, pipes);
      expect(diagnostic.code).toBe(code);
      expect(source.slice(diagnostic.from, diagnostic.to)).toContain(
        needle.trim().split(" ")[0],
      );
    }
  });

  it("locates section, field, title and body limits", () => {
    const sections = `${"## A\n".repeat(16)}## Over`;
    expect(failure(sections)).toMatchObject({
      code: "too_many_sections",
      from: sections.indexOf("## Over"),
    });
    const fields = `## Main\n${"A: x\n".repeat(64)}Over: x`;
    expect(failure(fields)).toMatchObject({
      code: "too_many_fields",
      from: fields.indexOf("Over: x"),
    });
    expect(failure(`# ${"x".repeat(257)}\n## Main`).code).toBe("invalid_title");
    expect(failure("x".repeat(64 * 1024 + 1)).code).toBe("body_too_long");
  });

  it("keeps authored labels and values out of every diagnostic", () => {
    const secret = "unique-private-credential-9081";
    const inputs = [
      `## Main\n${secret}:bad`,
      `## Main\nBad**: ${secret}`,
      `## Main\nToken: bad\\@${secret}`,
      `service: ${secret}\nservice: duplicate\nlogin: x\nannotation: x\nfields: []`,
      `service: &shared ${secret}\nlogin: *shared\nannotation: x\nfields: []`,
    ];
    for (const body of inputs) {
      const diagnostic = failure(body, pipes);
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
      expect(diagnostic.message).not.toContain(secret);
    }
  });

  it("positions legacy YAML errors and maps exact scalar fields where possible", () => {
    const bad =
      "service: one\nservice: two\nlogin: x\nannotation: x\nfields: []";
    expect(failure(bad).code).toBe("invalid_yaml");
    const good =
      "service: Example\nlogin: alice\nannotation: ''\nfields:\n  - label: Password\n    type: secret\n    value: hidden\n";
    const parsed = parseSecurityBlock(good, { diagnostics: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fieldRanges?.[0]).toEqual([
      { from: good.indexOf("Example"), to: good.indexOf("Example") + 7 },
      { from: good.indexOf("alice"), to: good.indexOf("alice") + 5 },
      { from: good.indexOf("hidden"), to: good.indexOf("hidden") + 6 },
    ]);
  });
});
