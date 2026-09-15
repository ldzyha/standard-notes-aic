import { describe, expect, it } from "vitest";
import {
  FIELD_PARTS_MAX_COUNT,
  FIELD_PARTS_MAX_LENGTH,
  parseFieldParts,
  scanFieldParts,
  serializeFieldParts,
} from "../src/core/field-parts.js";
import {
  parseFieldLabel,
  scanFieldLabel,
  serializeFieldLabel,
} from "../src/core/field-label.js";

describe("typed pipe parts", () => {
  it("binds each delimiter to the NEXT value, independently of spacing", () => {
    expect(parseFieldParts("|a*|b#|c_|4111111111111111 |12/30 *|123")).toEqual([
      { kind: "text", value: "a" },
      { kind: "secret", value: "b" },
      { kind: "totp", value: "c" },
      { kind: "card", value: "4111111111111111" },
      { kind: "text", value: "12/30" },
      { kind: "secret", value: "123" },
    ]);
    expect(parseFieldParts("1|active0|spent")).toEqual([
      { kind: "one-time", value: "active" },
      { kind: "used", value: "spent" },
    ]);
    expect(parseFieldParts("|value1|next")).toEqual([
      { kind: "text", value: "value" },
      { kind: "one-time", value: "next" },
    ]);
    expect(parseFieldParts("|value1 |next")).toEqual([
      { kind: "text", value: "value1" },
      { kind: "text", value: "next" },
    ]);
  });
  it("retains empty parts, trims syntax spaces, and treats backslashes literally outside quotes", () => {
    expect(parseFieldParts(" |  first  *| #|  |last  ")).toEqual([
      { kind: "text", value: "first" },
      { kind: "secret", value: "" },
      { kind: "totp", value: "" },
      { kind: "text", value: "last" },
    ]);
    expect(parseFieldParts("| a\\|b")).toEqual([
      { kind: "text", value: "a\\" },
      { kind: "text", value: "b" },
    ]);
    expect(parseFieldParts("|* |# |_ |1 |0")).toEqual(
      ["*", "#", "_", "1", "0"].map((value) => ({ kind: "text", value })),
    );
  });
  it("protects literal modifiers, pipes, escapes and significant spaces with JSON strings", () => {
    const values = [
      "a|b*|c#|d_|e1|f0|g",
      'say "hello"',
      "  padded  ",
      "\\folder\n\tend",
      "trailing*",
      "1",
      "0",
      "😀\u2028x",
    ];
    const parts = values.map((value) => ({ kind: "secret" as const, value }));
    expect(parseFieldParts(serializeFieldParts(parts))).toEqual(parts);
    expect(parseFieldParts('| "a\\"b\\\\c" *|"line\\nnext"')).toEqual([
      { kind: "text", value: 'a"b\\c' },
      { kind: "secret", value: "line\nnext" },
    ]);
  });
  it("returns precise value and separator offsets including empty quoted values", () => {
    const raw = ' *| "a|b"0|"" | tail ';
    expect(
      scanFieldParts(raw).map((part) => ({
        kind: part.kind,
        value: raw.slice(part.from, part.to),
        separator: raw.slice(part.separatorFrom, part.separatorTo),
      })),
    ).toEqual([
      { kind: "secret", value: '"a|b"', separator: "*|" },
      { kind: "used", value: '""', separator: "0|" },
      { kind: "text", value: "tail", separator: "|" },
    ]);
  });
  it.each([
    "text without separator",
    '| "unclosed',
    '| "closed" junk',
    '| "bad\\q"',
    '| "bad\\u00xx"',
    '| partial"quote',
    "| actual\u0000control",
  ])("rejects malformed input with fixed non-leaking errors: %s", (raw) => {
    expect(() => parseFieldParts(raw)).toThrow("Invalid field parts");
    try {
      parseFieldParts(raw);
    } catch (error) {
      expect(String(error)).not.toContain(raw);
    }
  });
  it("bounds encoded rows and part counts in both directions", () => {
    expect(parseFieldParts("|".repeat(FIELD_PARTS_MAX_COUNT))).toHaveLength(64);
    expect(() => parseFieldParts("|".repeat(65))).toThrow();
    expect(() =>
      parseFieldParts("|" + "x".repeat(FIELD_PARTS_MAX_LENGTH)),
    ).toThrow();
    expect(() =>
      serializeFieldParts(
        Array.from({ length: 65 }, () => ({ kind: "text", value: "" })),
      ),
    ).toThrow();
    expect(() =>
      serializeFieldParts([{ kind: "unknown", value: "" }] as never),
    ).toThrow();
    expect(() =>
      serializeFieldParts([{ kind: "text", value: "", hide: true }] as never),
    ).toThrow();
  });
});

describe("type-free field labels", () => {
  it("quotes punctuation or heading syntax without modifying authored names", () => {
    for (const label of [
      "Login: primary",
      "a|b",
      'a"b',
      "# Heading",
      "## section",
      "---",
      "\\folder",
      "__proto__",
      "trailing*",
      "Account1",
    ]) {
      const encoded = serializeFieldLabel({ label });
      expect(parseFieldLabel(encoded)).toEqual({ label });
      expect(scanFieldLabel(encoded + " | value")).toMatchObject({ label });
    }
    expect(scanFieldLabel('"a|b: c"1|active')).toEqual({
      label: "a|b: c",
      separatorFrom: 8,
    });
    expect(scanFieldLabel(" *| secret", { allowEmptyLabel: true })).toEqual({
      label: "",
      separatorFrom: 1,
    });
  });
  it("rejects old colon labels and malformed quoted labels", () => {
    for (const line of [
      "Password*: old | suffix",
      '"bad"junk|',
      '"unclosed | secret',
    ]) {
      expect(() => scanFieldLabel(line, { allowEmptyLabel: true })).toThrow(
        "Invalid field label",
      );
    }
    expect(() => serializeFieldLabel({ label: " padded" })).toThrow();
    expect(() => parseFieldLabel('"\\n"')).toThrow();
    expect(scanFieldLabel("no delimiter")).toBeNull();
  });
});
