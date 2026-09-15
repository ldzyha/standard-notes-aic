import { describe, expect, it } from "vitest";
import { parseRecoveryCodesPaste } from "../src/core/security-recovery.js";
import {
  parseFieldParts,
  serializeFieldParts,
} from "../src/core/field-parts.js";
const invalid = { ok: false, code: "invalid_recovery_codes" };
const tooLarge = { ok: false, code: "recovery_codes_too_large" };

describe("literal explicit one-time paste", () => {
  it("splits all newline formats while preserving duplicates and significant spaces", () => {
    expect(
      parseRecoveryCodesPaste("  first code  \r\n\nsecond\r\r   \nsecond"),
    ).toEqual({
      ok: true,
      codes: [
        { value: "  first code  " },
        { value: "second" },
        { value: "second" },
      ],
    });
    expect(parseRecoveryCodesPaste("\r\n  \r\n")).toEqual({
      ok: true,
      codes: [],
    });
  });
  it("keeps numbering, checklist prefixes and typed-pipe text literal", () => {
    const values = [
      "1. abc",
      "- def",
      "- [x] already-looking-used",
      "- [ ] unused-looking",
      "1|active0|used",
      'a"b\\c',
      "код🔐",
    ];
    const parsed = parseRecoveryCodesPaste(values.join("\n"));
    expect(parsed).toEqual({
      ok: true,
      codes: values.map((value) => ({ value })),
    });
    if (!parsed.ok) return;
    const parts = parsed.codes.map(({ value }) => ({
      value,
      kind: "one-time" as const,
    }));
    expect(parseFieldParts(serializeFieldParts(parts))).toEqual(parts);
    expect(
      parsed.codes.every((code) => Object.keys(code).join() === "value"),
    ).toBe(true);
  });
  it("bounds code lengths and batches by the current shared row capacity", () => {
    expect(parseRecoveryCodesPaste("a".repeat(256)).ok).toBe(true);
    expect(parseRecoveryCodesPaste("a".repeat(257))).toEqual(tooLarge);
    expect(parseRecoveryCodesPaste("🔐".repeat(128)).ok).toBe(true);
    expect(parseRecoveryCodesPaste("🔐".repeat(129))).toEqual(tooLarge);
    expect(parseRecoveryCodesPaste(Array(64).fill("a").join("\n")).ok).toBe(
      true,
    );
    expect(parseRecoveryCodesPaste(Array(65).fill("a").join("\n"))).toEqual(
      tooLarge,
    );
  });
  it("bounds raw input and the actual typed encoding, including quoted escapes", () => {
    expect(parseRecoveryCodesPaste(" ".repeat(16384))).toEqual({
      ok: true,
      codes: [],
    });
    expect(parseRecoveryCodesPaste(" ".repeat(16385))).toEqual(tooLarge);
    const values = Array(64).fill("a".repeat(252)) as string[];
    expect(parseRecoveryCodesPaste(values.join("\n")).ok).toBe(true);
    values[0] += "a";
    expect(
      serializeFieldParts(values.map((value) => ({ kind: "one-time", value }))),
    ).toHaveLength(16384);
    expect(parseRecoveryCodesPaste(values.join("\n")).ok).toBe(true);
    values[1] += "a";
    expect(parseRecoveryCodesPaste(values.join("\n"))).toEqual(tooLarge);
    expect(
      parseRecoveryCodesPaste(Array(64).fill("\\".repeat(128)).join("\n")),
    ).toEqual(tooLarge);
  });
  it("returns fixed failures for control characters and malformed types", () => {
    for (const character of [
      "\0",
      "\t",
      "\u007f",
      "\u200b",
      "\u2028",
      "\u2029",
      "\ud800",
    ])
      expect(
        parseRecoveryCodesPaste("private-fixture" + character + "value"),
      ).toEqual(invalid);
    for (const raw of [false, null, 5, {}])
      expect(parseRecoveryCodesPaste(raw as never)).toEqual(invalid);
    expect(
      JSON.stringify(parseRecoveryCodesPaste("private-fixture\0")),
    ).not.toContain("private-fixture");
  });
});
