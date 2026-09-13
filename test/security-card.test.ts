import { describe, expect, it } from "vitest";
import {
  isCardField,
  normalizeCardPart,
  parseCardField,
} from "../src/core/security-card.js";

const number = "4242 4242 4242 4242"; // Synthetic test number only.

describe("explicit card kind", () => {
  it("uses the marker-derived kind, never the display label or PAN shape", () => {
    expect(isCardField({ kind: "card", label: "Bank account" })).toBe(true);
    expect(isCardField({ kind: "plain", label: "Card" })).toBe(false);
    expect(isCardField({ label: "Card" })).toBe(false);
    expect(isCardField(null)).toBe(false);
  });

  it("accepts empty or sparse typed card parts without inferring a CVV", () => {
    expect(parseCardField({ kind: "card", value: "" })).toEqual({
      ok: true,
      card: { number: "", date: "", cvv: "" },
    });
    expect(parseCardField({ kind: "card", value: number })).toEqual({
      ok: true,
      card: { number, date: "", cvv: "" },
    });
    expect(
      parseCardField({
        kind: "card",
        value: "",
        description: "",
        additionalSecret: "000",
      }),
    ).toEqual({
      ok: true,
      card: { number: "", date: "", cvv: "000" },
    });
    expect(
      parseCardField({
        kind: "card",
        value: "4242-4242-4242-4242",
        description: "01/2030",
        additionalSecret: "0000",
      }),
    ).toEqual({
      ok: true,
      card: { number: "4242-4242-4242-4242", date: "01/2030", cvv: "0000" },
    });
    for (const length of [12, 19])
      expect(
        parseCardField({ kind: "card", value: "0".repeat(length) }).ok,
      ).toBe(true);
  });

  it("rejects malformed marked card parts with fixed, non-revealing results", () => {
    const invalid = [
      { kind: "plain", value: number },
      { kind: "card", value: "4242" },
      { kind: "card", value: "0".repeat(11) },
      { kind: "card", value: "0".repeat(20) },
      { kind: "card", value: number, description: "00/30" },
      { kind: "card", value: number, description: "13/2030" },
      { kind: "card", value: number, additionalSecret: "00" },
      { kind: "card", value: number, additionalSecret: "*000*" },
      { kind: "card", value: number, additionalSecret: "00000" },
      { kind: "card", value: number, description: null },
      { kind: "card", value: number, additionalSecret: 123 },
      { kind: "card", value: "0".repeat(129) },
      null,
    ];
    for (const field of invalid)
      expect(parseCardField(field)).toEqual({
        ok: false,
        code: "invalid_card_field",
      });
  });

  it("normalizes only validated raw clipboard parts", () => {
    expect(normalizeCardPart("number", `  ${number}  `)).toBe(number);
    expect(normalizeCardPart("number", "4242  4242--4242 4242")).toBe(
      "4242  4242--4242 4242",
    );
    expect(normalizeCardPart("cvv", " 000 ")).toBe("000");
    expect(normalizeCardPart("date", " 12/2030 ")).toBe("12/2030");
    expect(normalizeCardPart("cvv", " ")).toBe("");
    for (const [part, value] of [
      ["cvv", "*000*"],
      ["date", "[12/30]"],
      ["number", "4242\n4242"],
      ["number", `${number}|000`],
    ] as const)
      expect(() => normalizeCardPart(part, value)).toThrowError(
        new TypeError("Invalid card field"),
      );
  });
});
