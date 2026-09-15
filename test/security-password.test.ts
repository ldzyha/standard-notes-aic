import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  isPasswordField,
  type PasswordOptions,
} from "../src/core/security-password.js";
import {
  parseSecurityBlock,
  serializeSecurityBlock,
} from "../src/core/security-model.js";

const alphabets = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
};
const disabled = {
  uppercase: false,
  lowercase: false,
  numbers: false,
  symbols: false,
};

function byteStream(values: readonly number[]) {
  let offset = 0;
  const buffers: Uint8Array[] = [];
  const getRandomValues = vi.fn((buffer: Uint8Array) => {
    buffers.push(buffer);
    for (let index = 0; index < buffer.length; index++)
      buffer[index] = values[offset++ % values.length]!;
    return buffer;
  });
  return {
    crypto: { getRandomValues } as Pick<Crypto, "getRandomValues">,
    getRandomValues,
    buffers,
  };
}

describe("shared security password generation", () => {
  it("defaults to 24 random characters and every enabled class", () => {
    expect(DEFAULT_PASSWORD_OPTIONS).toEqual({
      length: 24,
      ...Object.fromEntries(Object.keys(alphabets).map((key) => [key, true])),
    });
    expect(Object.isFrozen(DEFAULT_PASSWORD_OPTIONS)).toBe(true);
    const rng = byteStream([0, 26, 52, 62]);
    const password = generatePassword({}, rng.crypto);
    expect(password).toBe("Aa0!".repeat(6));
    expect(rng.getRandomValues).toHaveBeenCalledTimes(1);
    expect(
      rng.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
    ).toBe(true);
  });

  it("honors all 15 nonempty class combinations at length boundaries", () => {
    const keys = Object.keys(alphabets) as (keyof typeof alphabets)[];
    for (let mask = 1; mask < 16; mask++) {
      const options = { ...disabled };
      for (const [index, key] of keys.entries())
        options[key] = Boolean(mask & (1 << index));
      const selected = keys
        .filter((key) => options[key])
        .map((key) => alphabets[key]);
      let start = 0;
      const indices = selected.map((characters) => {
        const index = start;
        start += characters.length;
        return index;
      });
      for (const length of [8, 24, 128]) {
        const password = generatePassword(
          { ...options, length },
          byteStream(indices).crypto,
        );
        expect(password).toHaveLength(length);
        expect(
          [...password].every((character) =>
            selected.join("").includes(character),
          ),
        ).toBe(true);
        for (const characters of selected)
          expect(
            [...password].some((character) => characters.includes(character)),
          ).toBe(true);
      }
    }
  });

  it("rejects cutoff bytes before modulo and accepts the last unbiased byte", () => {
    const rng = byteStream([
      250, 251, 252, 253, 254, 255, 249, 0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(
      generatePassword({ ...disabled, numbers: true, length: 8 }, rng.crypto),
    ).toBe("90123456");
    // With 94 symbols in the full alphabet, the cutoff is 188, not 256.
    const full = byteStream([188, 255, 0, 26, 52, 62, 187, 1, 27, 53]);
    expect(generatePassword({ length: 8 }, full.crypto)).toBe("Aa0!~Bb1");
  });

  it("retries entire candidates missing a required class", () => {
    const rng = byteStream([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 26, 52, 62, 1, 27, 53, 63,
    ]);
    expect(generatePassword({ length: 8 }, rng.crypto)).toBe('Aa0!Bb1"');
  });

  it("supports all printable ASCII punctuation and round-trips it through the line format", () => {
    const rng = byteStream(Array.from({ length: 32 }, (_, index) => index));
    const password = generatePassword(
      { ...disabled, symbols: true, length: 32 },
      rng.crypto,
    );
    expect(password).toBe(alphabets.symbols);
    const model = {
      sections: [
        {
          label: "Main",
          fields: [
            {
              label: "Password",
              parts: [{ value: password, kind: "secret" as const }],
            },
          ],
        },
      ],
    };
    expect(parseSecurityBlock(serializeSecurityBlock(model))).toEqual({
      ok: true,
      model,
    });
  });

  it("rejects invalid options before asking for entropy", () => {
    const rng = byteStream([0]);
    const invalid: unknown[] = [
      null,
      [],
      "24",
      { length: 7 },
      { length: 129 },
      { length: 8.5 },
      { length: NaN },
      { length: Infinity },
      { length: "24" },
      { uppercase: 1 },
      { symbols: undefined },
      { digits: true },
      disabled,
    ];
    for (const options of invalid)
      expect(() =>
        generatePassword(options as Partial<PasswordOptions>, rng.crypto),
      ).toThrow(TypeError);
    expect(rng.getRandomValues).not.toHaveBeenCalled();
  });

  it("fails closed on missing or failing WebCrypto without leaking provider errors", () => {
    expect(() => generatePassword({}, {} as Crypto)).toThrow(
      "WebCrypto random generation is unavailable",
    );
    expect(() => generatePassword({}, null as unknown as Crypto)).toThrow(
      "WebCrypto random generation is unavailable",
    );
    const provider = {
      getRandomValues: () => {
        throw new Error("PRIVATE_PROVIDER_DATA");
      },
    } as Pick<Crypto, "getRandomValues">;
    expect(() => generatePassword({}, provider)).toThrow(
      "Unable to generate password securely",
    );
    try {
      generatePassword({}, provider);
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_PROVIDER_DATA");
    }
  });

  it("bounds both byte rejection and whole-candidate rejection", () => {
    const rejectedBytes = byteStream([255]);
    expect(() => generatePassword({}, rejectedBytes.crypto)).toThrow(
      "Unable to generate password securely",
    );
    expect(rejectedBytes.getRandomValues).toHaveBeenCalledTimes(256);
    const missingClasses = byteStream([0]);
    expect(() =>
      generatePassword({ length: 8 }, missingClasses.crypto),
    ).toThrow("Unable to generate password securely");
    expect(missingClasses.getRandomValues).toHaveBeenCalledTimes(8);
    expect(
      missingClasses.buffers.every((buffer) =>
        buffer.every((byte) => byte === 0),
      ),
    ).toBe(true);
  });

  it("uses the platform WebCrypto by default", () => {
    const password = generatePassword();
    expect(password).toHaveLength(24);
    for (const characters of Object.values(alphabets))
      expect(
        [...password].some((character) => characters.includes(character)),
      ).toBe(true);
  });
});

describe("secret generation availability", () => {
  it("uses only the independent part type", () => {
    expect(isPasswordField({ kind: "secret" })).toBe(true);
    for (const kind of ["text", "totp", "card"] as const)
      expect(isPasswordField({ kind })).toBe(false);
    expect(isPasswordField({ label: "Password" } as never)).toBe(false);
    expect(isPasswordField(null as never)).toBe(false);
  });
});
