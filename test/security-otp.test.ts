import { describe, expect, it } from "vitest";
import { parseTotpInput, totpAt } from "../src/core/security-otp.js";

const webcrypto = globalThis.crypto;

function base32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

const rfcSeeds = {
  SHA1: base32(new TextEncoder().encode("12345678901234567890")),
  SHA256: base32(new TextEncoder().encode("12345678901234567890123456789012")),
  SHA512: base32(
    new TextEncoder().encode(
      "1234567890123456789012345678901234567890123456789012345678901234",
    ),
  ),
};

describe("shared security TOTP", () => {
  it("matches the published RFC 6238 SHA-1/SHA-256/SHA-512 vectors", async () => {
    const vectors = [
      [59, "94287082", "46119246", "90693936"],
      [1_111_111_109, "07081804", "68084774", "25091201"],
      [1_111_111_111, "14050471", "67062674", "99943326"],
      [1_234_567_890, "89005924", "91819424", "93441116"],
      [2_000_000_000, "69279037", "90698825", "38618901"],
      [20_000_000_000, "65353130", "77737706", "47863826"],
    ] as const;
    for (const [seconds, sha1, sha256, sha512] of vectors) {
      for (const [algorithm, expected] of [
        ["SHA1", sha1],
        ["SHA256", sha256],
        ["SHA512", sha512],
      ] as const) {
        const actual = await totpAt(
          { secret: rfcSeeds[algorithm], algorithm, digits: 8, period: 30 },
          seconds * 1_000,
          webcrypto as Crypto,
        );
        expect(actual.code).toBe(expected);
      }
    }
  });

  it("parses a QR provisioning URI and preserves its service metadata", async () => {
    const uri = `otpauth://totp/Example%20Service%3Aalice%40example.test?secret=${rfcSeeds.SHA1}&issuer=Example%20Service&algorithm=SHA1&digits=6&period=30`;
    expect(parseTotpInput(uri)).toEqual({
      secret: rfcSeeds.SHA1,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      label: "Example Service:alice@example.test",
      issuer: "Example Service",
    });
    expect((await totpAt(uri, 59_000, webcrypto as Crypto)).code).toBe(
      "287082",
    );
  });

  it("accepts spaced or padded Base32 and computes countdown boundaries", async () => {
    const seed = "JBSW Y3DP EHPK 3PXP";
    expect(parseTotpInput(seed).secret).toBe("JBSWY3DPEHPK3PXP");
    expect(parseTotpInput("MY======").secret).toBe("MY");
    const value = await totpAt(seed, 29_999, webcrypto as Crypto);
    expect(value.code).toMatch(/^\d{6}$/u);
    expect(value.secondsRemaining).toBe(1);
    expect(
      (await totpAt(seed, 30_000, webcrypto as Crypto)).secondsRemaining,
    ).toBe(30);
  });

  it("rejects malformed or ambiguous inputs without echoing secrets", async () => {
    const invalid = [
      "JBSWY3DPEHPK3PX1",
      "MZ",
      "MY=====",
      "otpauth://hotp/Account?secret=JBSWY3DPEHPK3PXP&counter=1",
      "otpauth://totp/Account?secret=JBSWY3DPEHPK3PXP&secret=SECONDSECRET",
      "otpauth://totp/Account?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
      "otpauth://totp/Account?secret=JBSWY3DPEHPK3PXP&digits=9",
      "otpauth://totp/Account?secret=JBSWY3DPEHPK3PXP&period=14",
      "otpauth://totp/Account?secret=JBSWY3DPEHPK3PXP&period=30&period=60",
    ];
    for (const input of invalid) {
      expect(() => parseTotpInput(input)).toThrow();
      try {
        parseTotpInput(input);
      } catch (error) {
        expect(String(error)).not.toContain("JBSWY3DPEHPK3PXP");
        expect(String(error)).not.toContain("SECONDSECRET");
      }
    }
    await expect(
      totpAt(rfcSeeds.SHA1, -1, webcrypto as Crypto),
    ).rejects.toThrow("Invalid TOTP time");
    await expect(totpAt(rfcSeeds.SHA1, 0, {} as Crypto)).rejects.toThrow(
      "WebCrypto HMAC is unavailable",
    );
  });
});
