import { describe, expect, it } from "vitest";
import {
  escapePipePart,
  joinFieldParts,
  parseFieldParts,
  serializeFieldParts,
  scanFieldParts,
  splitFieldParts,
  unescapePipePart,
} from "../src/core/field-parts.js";

describe("opt-in pipe field parts", () => {
  it("splits only spaced pipes and preserves sparse empty slots", () => {
    expect(splitFieldParts("value | description | secret")).toEqual([
      "value",
      "description",
      "secret",
    ]);
    expect(splitFieldParts("value |  | secret")).toEqual([
      "value",
      "",
      "secret",
    ]);
    expect(parseFieldParts("value |  | secret")).toEqual({
      value: "value",
      description: "",
      additionalSecret: "secret",
    });
    expect(parseFieldParts("Password")).toEqual({ value: "Password" });
    expect(parseFieldParts("Password | ")).toEqual({
      value: "Password",
      description: "",
    });
    for (const value of [
      "value|description|secret",
      "a|b|c|d",
      "a |b",
      "a| b",
      "|",
      "a\t|\tb",
      "a\u00a0|\u00a0b",
    ])
      expect(parseFieldParts(value)).toEqual({ value });
  });

  it("round-trips real boundary spaces, tabs, URL colons, newline, and marker characters", () => {
    const field = {
      value: "  pass*#_ | with\\slash ",
      description: " https://example.invalid:8443/a|b\nsecond line",
      additionalSecret: "\t000 ",
    };
    expect(parseFieldParts(serializeFieldParts(field))).toEqual(field);
    expect(serializeFieldParts({ value: "x ", description: " y" })).toBe(
      "x  |  y",
    );
    expect(parseFieldParts("x  |  y")).toEqual({
      value: "x ",
      description: " y",
    });
  });

  it("uses backslash parity and leaves host escapes intact for Security", () => {
    expect(splitFieldParts(String.raw`one\|two | three`)).toEqual([
      String.raw`one\|two`,
      "three",
    ]);
    expect(splitFieldParts(String.raw`one\\ | two`)).toEqual([
      String.raw`one\\`,
      "two",
    ]);
    expect(splitFieldParts(String.raw`line\n | date`)).toEqual([
      String.raw`line\n`,
      "date",
    ]);
    expect(unescapePipePart(String.raw`one\|two\\three`)).toBe(
      "one|two\\three",
    );
    expect(escapePipePart("one|two\\three")).toBe(String.raw`one\|two\\three`);
    expect(joinFieldParts(["one", "", "three"])).toBe("one |  | three");
  });

  it("rejects more than three slots and malformed escapes without echoing input", () => {
    for (const source of ["a | b | c | d", "a\\", "x".repeat(16 * 1024 + 1)])
      expect(() => splitFieldParts(source)).toThrowError("Invalid field parts");
    expect(() => parseFieldParts(String.raw`bad\q`)).toThrowError(
      new TypeError("Invalid field parts"),
    );
    expect(() => joinFieldParts(["a", "b", "c", "d"])).toThrowError(
      new TypeError("Invalid field parts"),
    );
  });

  it("keeps source ranges and JSON quote errors in the shared scanner", () => {
    const raw = '"a | b" | "" | "c|d"';
    expect(scanFieldParts(raw)).toEqual([
      { encoded: '"a | b"', from: 0, to: 7, quoted: true },
      { encoded: '""', from: 10, to: 12, quoted: true },
      { encoded: '"c|d"', from: 15, to: 20, quoted: true },
    ]);
    for (const [source, code, offset] of [
      ['"private', "unterminated_quote", 0],
      ['"private"junk', "unexpected_after_quote", 9],
      ['"private\\q"', "invalid_escape", 8],
      ['"private\\u12Q4"', "invalid_escape", 8],
      ['"private\t"', "control_character", 8],
      ['"a | b" | "c | d" | "e" | "private"', "too_many_parts", 24],
    ] as const) {
      try {
        scanFieldParts(source);
        expect.unreachable("Malformed quoted source must fail");
      } catch (error) {
        expect(error).toMatchObject({
          message: "Invalid field parts",
          code,
          offset,
        });
        expect(JSON.stringify(error)).not.toContain("private");
      }
    }
  });

  it("round-trips every combination of literal syntax characters in all slots", () => {
    const values = [
      "",
      "normal",
      "a|b",
      "a | b",
      '"quoted"',
      'a"b',
      "\\",
      " | ",
      " a ",
      "\t\n",
      "😀",
      'x\\" | y',
    ];
    for (const value of values) {
      for (const description of values) {
        for (const additionalSecret of values) {
          const field = { value, description, additionalSecret };
          expect(parseFieldParts(serializeFieldParts(field))).toEqual(field);
        }
      }
    }
  });
});
