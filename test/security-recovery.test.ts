import { describe, expect, it } from "vitest";
import {
  isRecoveryField,
  parseRecoveryCodes,
  parseRecoveryCodesPaste,
  serializeRecoveryCodes,
  type RecoveryCode,
} from "../src/core/security-recovery.js";

const invalid = { ok: false, code: "invalid_recovery_codes" };
const tooLarge = { ok: false, code: "recovery_codes_too_large" };
describe("shared recovery-code codec", () => {
  it("recognizes only exact hidden recovery-code labels", () => {
    for (const label of ["Recovery codes", "recovery CODES", "Backup codes"])
      expect(isRecoveryField({ label, hide: true })).toBe(true);
    for (const label of [
      "Recovery code",
      "Recovery codes ",
      " Recovery codes",
      "Backup codes extra",
      "Recovery-codes",
    ])
      expect(isRecoveryField({ label, hide: true })).toBe(false);
    expect(isRecoveryField({ label: "Recovery codes", hide: false })).toBe(
      false,
    );
    expect(isRecoveryField({ label: "Recovery codes", hide: 1 } as never)).toBe(
      false,
    );
    expect(isRecoveryField(null as never)).toBe(false);
  });

  it("splits all newline formats, ignores blank lines and preserves values exactly", () => {
    expect(
      parseRecoveryCodesPaste("  first code  \r\n\nsecond\r\r   \nsecond"),
    ).toEqual({
      ok: true,
      codes: [
        { value: "  first code  ", used: false },
        { value: "second", used: false },
        { value: "second", used: false },
      ],
    });
    expect(parseRecoveryCodesPaste("\r\n  \r\n")).toEqual({
      ok: true,
      codes: [],
    });
    expect(parseRecoveryCodes("raw one\nraw two")).toEqual({
      ok: true,
      codes: [
        { value: "raw one", used: false },
        { value: "raw two", used: false },
      ],
    });
  });

  it("preserves numbering, bullets and literal checklist prefixes when pasting", () => {
    const parsed = parseRecoveryCodesPaste(
      "1. abc\n- def\n- [x] already-looking-used\n- [ ] unused-looking",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.codes.every((code) => !code.used)).toBe(true);
    const stored = serializeRecoveryCodes(parsed.codes);
    expect(stored).toBe(
      "- [ ] 1. abc\n- [ ] - def\n- [ ] - [x] already-looking-used\n- [ ] - [ ] unused-looking",
    );
    expect(parseRecoveryCodes(stored)).toEqual(parsed);
  });

  it("roundtrips reversible used flags, duplicates, Unicode and edge spaces", () => {
    const codes = [
      { value: "  identical code  ", used: true },
      { value: "  identical code  ", used: false },
      { value: "код🔐", used: false },
    ];
    expect(parseRecoveryCodes(serializeRecoveryCodes(codes))).toEqual({
      ok: true,
      codes,
    });
    codes[0]!.used = false;
    expect(parseRecoveryCodes(serializeRecoveryCodes(codes))).toEqual({
      ok: true,
      codes,
    });
    expect(serializeRecoveryCodes([])).toBe("");
    expect(parseRecoveryCodes("")).toEqual({ ok: true, codes: [] });
  });

  it("rejects mixed or malformed stored checklists without guessing", () => {
    for (const raw of [
      "- [ ] a\nraw",
      "raw\n- [x] a",
      "- [X] a",
      "- [y] a",
      "- [ ]a",
      " - [ ] a",
      "- [ ] ",
      "- [x]    ",
      "- [ a",
    ])
      expect(parseRecoveryCodes(raw)).toEqual(invalid);
    expect(parseRecoveryCodes("- [ ] a\n\n- [x] b\n")).toEqual({
      ok: true,
      codes: [
        { value: "a", used: false },
        { value: "b", used: true },
      ],
    });
  });

  it("enforces exact code and count limits, counting UTF16 code units", () => {
    expect(parseRecoveryCodesPaste("a".repeat(256)).ok).toBe(true);
    expect(parseRecoveryCodesPaste("a".repeat(257))).toEqual(tooLarge);
    expect(parseRecoveryCodesPaste("🔐".repeat(128)).ok).toBe(true);
    expect(parseRecoveryCodesPaste("🔐".repeat(129))).toEqual(tooLarge);
    expect(parseRecoveryCodesPaste(Array(256).fill("a").join("\n")).ok).toBe(
      true,
    );
    expect(parseRecoveryCodesPaste(Array(257).fill("a").join("\n"))).toEqual(
      tooLarge,
    );
  });

  it("bounds both raw input and final canonical storage at 16 KiB", () => {
    const codes = Array.from({ length: 63 }, () => ({
      value: "a".repeat(253),
      used: false,
    }));
    // 62 * 260 + (259 + 5) = 16384 characters, including line separators.
    codes[0]!.value = "a".repeat(256);
    codes[1]!.value = "a".repeat(255);
    const stored = serializeRecoveryCodes(codes);
    expect(stored).toHaveLength(16 * 1024);
    expect(parseRecoveryCodes(stored)).toEqual({ ok: true, codes });
    const larger = codes.map((code) => ({ ...code }));
    larger[2]!.value += "x";
    expect(() => serializeRecoveryCodes(larger)).toThrow(RangeError);
    expect(
      parseRecoveryCodesPaste(larger.map((code) => code.value).join("\n")),
    ).toEqual(tooLarge);
    expect(parseRecoveryCodes(stored + "\n")).toEqual(tooLarge);
    expect(parseRecoveryCodesPaste(" ".repeat(16 * 1024 + 1))).toEqual(
      tooLarge,
    );
  });

  it("rejects controls and malformed types with fixed failures", () => {
    for (const character of [
      "\0",
      "\t",
      "\u007f",
      "\u200b",
      "\u2028",
      "\u2029",
      "\ud800",
    ])
      for (const parse of [parseRecoveryCodes, parseRecoveryCodesPaste])
        expect(parse("fixture" + character + "value")).toEqual(invalid);
    for (const parse of [parseRecoveryCodes, parseRecoveryCodesPaste]) {
      expect(parse(false as never)).toEqual(invalid);
      expect(parse(null as never)).toEqual(invalid);
    }
    for (const codes of [
      null,
      {},
      [{ value: "fixture", used: "false" }],
      [{ value: "fixture", used: 0 }],
      [{ value: "fixture\nvalue", used: false }],
      [{ value: "   ", used: false }],
    ])
      expect(() => serializeRecoveryCodes(codes as RecoveryCode[])).toThrow(
        "Invalid recovery codes",
      );
    expect(() =>
      serializeRecoveryCodes([{ value: "fixture".repeat(50), used: false }]),
    ).toThrow("Recovery codes exceed supported limits");
  });
});
