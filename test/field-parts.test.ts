import { describe, expect, it } from "vitest";
import {
  escapePipePart,
  joinFieldParts,
  parseFieldParts,
  serializeFieldParts,
  splitFieldParts,
  unescapePipePart,
} from "../src/core/field-parts.js";

describe("opt-in pipe field parts", () => {
  it("splits any unescaped pipe and preserves sparse empty slots", () => {
    expect(splitFieldParts("value|description|secret")).toEqual([
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
    expect(parseFieldParts("Password|")).toEqual({
      value: "Password",
      description: "",
    });
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
    expect(splitFieldParts(String.raw`one\|two|three`)).toEqual([
      String.raw`one\|two`,
      "three",
    ]);
    expect(splitFieldParts(String.raw`one\\|two`)).toEqual([
      String.raw`one\\`,
      "two",
    ]);
    expect(splitFieldParts(String.raw`line\n|date`)).toEqual([
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
    for (const source of ["a|b|c|d", "a\\", "x".repeat(16 * 1024 + 1)])
      expect(() => splitFieldParts(source)).toThrowError(
        new TypeError("Invalid field parts"),
      );
    expect(() => parseFieldParts(String.raw`bad\q`)).toThrowError(
      new TypeError("Invalid field parts"),
    );
    expect(() => joinFieldParts(["a", "b", "c", "d"])).toThrowError(
      new TypeError("Invalid field parts"),
    );
  });
});
