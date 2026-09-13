import { describe, expect, it } from "vitest";
import { parsePropertiesBody } from "../src/core/properties-model.js";

const v2 = "# aic-fields: v2\n";

function failure(body: string) {
  const result = parsePropertiesBody(body, { diagnostics: true });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Synthetic invalid properties parsed");
  expect(result.diagnostic.from).toBeGreaterThanOrEqual(0);
  expect(result.diagnostic.to).toBeLessThanOrEqual(body.length);
  expect(result.diagnostic.to).toBeGreaterThanOrEqual(result.diagnostic.from);
  return result.diagnostic;
}

describe("Properties diagnostics", () => {
  it("keeps the default result shape unchanged", () => {
    const valid = parsePropertiesBody("x: y");
    expect(valid).toEqual({
      ok: true,
      model: {
        sections: [
          { label: "Properties", fields: [], readOnly: true, allowAdd: false },
          {
            label: "Fields",
            fields: [{ label: "x", value: "y", hide: false }],
            allowAdd: true,
          },
        ],
      },
    });
    expect(parsePropertiesBody("x: [")).toEqual({
      ok: false,
      code: "invalid_properties_block",
    });
    const located = parsePropertiesBody("x: y", { diagnostics: true });
    expect(located.ok).toBe(true);
    if (!located.ok) return;
    expect(located.model).toEqual(valid.ok && valid.model);
    expect(located.fieldRanges).toEqual([[], [{ from: 3, to: 4 }]]);
  });

  it("tracks nested YAML field ranges through CRLF and UTF-16 text", () => {
    const body =
      "file: note.md\r\nemoji: 😀\r\nprivate*:\r\n  credential*: 🔒\r\n  list:\r\n    - value\r\n";
    const result = parsePropertiesBody(body, { diagnostics: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.model.sections.map((section) => section.fields.length),
    ).toEqual([1, 1, 1, 1]);
    expect(result.fieldRanges).toEqual([
      [{ from: body.indexOf("note.md"), to: body.indexOf("note.md") + 7 }],
      [{ from: body.indexOf("😀"), to: body.indexOf("😀") + 2 }],
      [{ from: body.indexOf("🔒"), to: body.indexOf("🔒") + 2 }],
      [{ from: body.indexOf("value"), to: body.indexOf("value") + 5 }],
    ]);
  });

  it("locates a nested duplicate key and YAML syntax error without copying parser text", () => {
    const body = "group:\r\n  x: first\r\n  x: second\r\n";
    expect(failure(body)).toEqual({
      code: "duplicate_key",
      message: "Remove or rename the duplicate YAML key.",
      from: body.lastIndexOf("x:"),
      to: body.lastIndexOf("x:") + 1,
      line: 3,
      column: 3,
    });
    const broken = "group:\n  x: [";
    const diagnostic = failure(broken);
    expect(diagnostic.code).toBe("yaml_syntax");
    expect(diagnostic.line).toBe(2);
    expect(diagnostic.from).toBe(broken.length);
  });

  it.each([
    [v2 + 'Card_: "synthetic-secret | 09/28 | 123"', "invalid_card_number"],
    [v2 + 'Card_: "4111111111111111 | 19/28 | 123"', "invalid_card_date"],
    [v2 + 'Card_: "4111111111111111 | 09/28 | abc"', "invalid_card_cvv"],
    [v2 + "Token: first | second | third | fourth", "invalid_field_parts"],
    [v2 + "Token: synthetic-secret\\q", "invalid_field_parts"],
    [v2 + "Password*#: synthetic-secret", "invalid_field_label"],
    ["# aic-fields: v3\nToken: synthetic-secret", "unsupported_version"],
    ["# aic-fields: v2\rToken: synthetic-secret\r", "cr_only_input"],
    ["Token: &id synthetic-secret", "unsupported_anchor"],
    ["Token: !foo synthetic-secret", "unsupported_tag"],
    ["Token: 1.0000000000000000001", "imprecise_number"],
  ])("uses fixed, source-free advice for %s", (body, code) => {
    const diagnostic = failure(body);
    expect(diagnostic.code).toBe(code);
    expect(JSON.stringify(diagnostic)).not.toContain("synthetic-secret");
    expect(JSON.stringify(diagnostic)).not.toContain("4111111111111111");
    expect(JSON.stringify(diagnostic)).not.toContain("09/28");
  });

  it("falls back to the full scalar for a decoded quoted value", () => {
    const body = v2 + 'Card_: "4111111111111111 | 09/28 | 12\\n"';
    const diagnostic = failure(body);
    expect(diagnostic.code).toBe("invalid_card_cvv");
    expect(diagnostic.from).toBe(body.indexOf('"'));
    expect(diagnostic.to).toBe(body.length);
  });

  it("identifies names, aliases, size limits, and excessive nesting", () => {
    expect(failure('"": value').code).toBe("invalid_name");
    expect(failure("x: *missing").code).toBe("unsupported_alias");
    expect(failure("*missing").code).toBe("unsupported_alias");
    expect(failure(`x: ${"s".repeat(16 * 1024 + 1)}`).code).toBe(
      "value_too_large",
    );
    expect(failure(`x: ${"s".repeat(64 * 1024)}`).code).toBe("body_too_large");
    const deep = [
      ...Array.from(
        { length: 17 },
        (_, index) => `${"  ".repeat(index)}group${index}:`,
      ),
      `${"  ".repeat(17)}leaf: value`,
    ].join("\n");
    expect(failure(deep).code).toBe("nesting_too_deep");
  });
});
