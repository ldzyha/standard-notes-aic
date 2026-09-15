import { describe, expect, it } from "vitest";
import { parseSecurityBlock } from "../src/core/security-model.js";
function failure(body: string) {
  const result = parseSecurityBlock(body, { diagnostics: true });
  if (result.ok) throw new Error("Expected fixed diagnostic");
  expect(result.diagnostic.from).toBeGreaterThanOrEqual(0);
  expect(result.diagnostic.to).toBeLessThanOrEqual(body.length);
  return result.diagnostic;
}
describe("typed Security diagnostics", () => {
  it("maps whole fields and each typed value in UTF-16/CRLF coordinates", () => {
    const body =
      '# Cards\r\n## Main\r\n😀 | one\r\n"Card | label" _| 4111111111111111 | 12/30 *| "123"\r\n---\r\n1| active0| used\r\n';
    const parsed = parseSecurityBlock(body, { diagnostics: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parseSecurityBlock(body)).toEqual({ ok: true, model: parsed.model });
    expect(
      parsed.fieldRanges.map((section) =>
        section.map((range) => body.slice(range.from, range.to)),
      ),
    ).toEqual([
      ["😀 | one", '"Card | label" _| 4111111111111111 | 12/30 *| "123"'],
      ["1| active0| used"],
    ]);
    expect(
      parsed.partRanges.map((section) =>
        section.map((field) =>
          field.map((range) => ({
            value: body.slice(range.from, range.to),
            separator: body.slice(range.separatorFrom, range.separatorTo),
          })),
        ),
      ),
    ).toEqual([
      [
        [{ value: "one", separator: "|" }],
        [
          { value: "4111111111111111", separator: "_|" },
          { value: "12/30", separator: "|" },
          { value: '"123"', separator: "*|" },
        ],
      ],
      [
        [
          { value: "active", separator: "1|" },
          { value: "used", separator: "0|" },
        ],
      ],
    ]);
  });
  it("keeps invalid old source opaque rather than converting colon fields", () => {
    expect(failure("Password*: private").code).toBe("missing_field_separator");
    expect(failure("Password*: private | note").code).toBe(
      "invalid_field_label",
    );
  });
  it("points to invalid card numbers only, with no expiry or CVV slot inference", () => {
    const body = "Card _| 123 | arbitrary expiry *| arbitrary secret";
    expect(failure(body)).toMatchObject({
      code: "invalid_card_number",
      from: 8,
      to: 11,
    });
    expect(
      parseSecurityBlock(
        "Card _| 4111111111111111 | arbitrary expiry *| arbitrary secret",
      ).ok,
    ).toBe(true);
  });
  it("locates malformed quotes and excess independent parts", () => {
    const body = '😀 *| "synthetic\\q"';
    expect(failure(body)).toMatchObject({
      code: "invalid_escape",
      from: body.indexOf("\\q"),
      line: 1,
    });
    expect(failure('| "unfinished').code).toBe("unterminated_quote");
    expect(failure('| "closed" junk').code).toBe("unexpected_after_quote");
    expect(failure("|".repeat(65))).toMatchObject({
      code: "too_many_parts",
      from: 64,
    });
  });
  it("retains title/section/fence diagnostics", () => {
    expect(failure("# First\n# Second\n").code).toBe("duplicate_title");
    expect(failure("Token *| synthetic\n# Second").code).toBe(
      "misplaced_title",
    );
    expect(
      failure("Token *| synthetic\n" + String.fromCharCode(96).repeat(3)).code,
    ).toBe("nested_fence");
    expect(failure("## First\n|value\n## Second").code).toBe(
      "misplaced_section_title",
    );
    expect(failure("## \n").code).toBe("invalid_section_label");
  });
  it("locates all capacity boundaries without authored text in advice", () => {
    expect(failure("---\n".repeat(16)).code).toBe("too_many_sections");
    expect(failure("|value\n".repeat(65)).code).toBe("too_many_fields");
    expect(failure("# " + "x".repeat(257)).code).toBe("invalid_title");
    expect(failure("x".repeat(65537)).code).toBe("body_too_long");
    expect(failure("|" + "x".repeat(16384)).code).toBe("value_too_long");
    for (const body of [
      "secret-label: synthetic-private",
      "Card _| synthetic-private",
      'Token *| "synthetic-private\\q"',
    ]) {
      expect(JSON.stringify(failure(body))).not.toMatch(
        /synthetic-private|secret-label/u,
      );
    }
  });
  it("rejects unsupported options without exposing source", () => {
    const result = parseSecurityBlock("Token *| synthetic-private", {
      fieldSyntax: "legacy" as never,
      diagnostics: true,
    });
    expect(result.ok || result.diagnostic.code).toBe(
      "unsupported_field_syntax",
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  });
});
