import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createVault,
  MAX_VAULT_CIPHERTEXT_BASE64_LENGTH,
  MAX_VAULT_PLAINTEXT_BYTES,
  openVault,
  sealVault,
  unlockVault,
  validateEnvelope,
  VaultError,
  type VaultEnvelope,
  type VaultSession,
} from "../src/browser/vault-crypto.js";

// Keep the shared DOM setup, but exercise the platform's actual cryptography.
const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const password = "  Пароль e\u0301 🔑 synthetic  ";
const source = '\ufeff# Синтетична нотатка\r\n  пароль: "🔐 e\u0301"\n';
let fixture: { envelope: VaultEnvelope; session: VaultSession };

function mutate64(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  fixture = await createVault(password, source);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe("browser vault native cryptography", () => {
  it("round-trips exact Unicode, BOM, whitespace, source and session key", async () => {
    expect(await openVault(fixture.envelope, fixture.session)).toBe(source);
    const unlocked = await unlockVault(fixture.envelope, password);
    expect(unlocked).toEqual({ plaintext: source, session: fixture.session });
    await expect(
      unlockVault(fixture.envelope, password.trim()),
    ).rejects.toMatchObject({
      code: "password",
    });
    await expect(
      unlockVault(fixture.envelope, password.normalize()),
    ).rejects.toMatchObject({
      code: "password",
    });
  });

  it("generates fresh salts per vault and fresh IVs per write", async () => {
    const another = await createVault(password, source);
    const resealed = await sealVault(source, fixture.session);
    expect(another.envelope.kdf.salt).not.toBe(fixture.envelope.kdf.salt);
    expect(another.session.key).not.toBe(fixture.session.key);
    expect(resealed.cipher.iv).not.toBe(fixture.envelope.cipher.iv);
    expect(resealed.cipher.data).not.toBe(fixture.envelope.cipher.data);
    expect(await openVault(resealed, fixture.session)).toBe(source);
    expect(
      await openVault(await sealVault("", fixture.session), fixture.session),
    ).toBe("");
  });

  it("exposes only the cryptographic envelope, without note metadata or key", async () => {
    const notes = JSON.stringify({
      notes: [
        {
          title: "Synthetic private title",
          url: "https://example.test/private",
          text: source,
        },
      ],
      domainIndex: { "example.test": ["synthetic-note-id"] },
      history: ["synthetic-private-history"],
    });
    const envelope = await sealVault(notes, fixture.session);
    const exported = JSON.stringify(envelope);
    for (const secret of [
      "Synthetic private title",
      "example.test",
      "synthetic-note-id",
      "synthetic-private-history",
      fixture.session.key,
      password,
    ]) {
      expect(exported).not.toContain(secret);
    }
    expect(Object.keys(envelope)).toEqual([
      "format",
      "version",
      "kdf",
      "cipher",
    ]);
    expect(await openVault(JSON.parse(exported), fixture.session)).toBe(notes);
  });

  it("uses the same safe authentication error for wrong passphrase and tampering", async () => {
    const wrongPassword = await unlockVault(
      fixture.envelope,
      "wrong synthetic passphrase",
    ).catch((error: unknown) => error);
    expect(wrongPassword).toBeInstanceOf(VaultError);
    const tamperedData = structuredClone(fixture.envelope);
    tamperedData.cipher.data = mutate64(tamperedData.cipher.data);
    const tamperedIv = structuredClone(fixture.envelope);
    tamperedIv.cipher.iv = mutate64(tamperedIv.cipher.iv);
    for (const envelope of [tamperedData, tamperedIv]) {
      await expect(openVault(envelope, fixture.session)).rejects.toEqual(
        wrongPassword,
      );
    }
    const wrongKey = { ...fixture.session, key: mutate64(fixture.session.key) };
    await expect(openVault(fixture.envelope, wrongKey)).rejects.toEqual(
      wrongPassword,
    );
  });

  it("authenticates the salt even if the session header is changed to match", async () => {
    const envelope = structuredClone(fixture.envelope);
    envelope.kdf.salt = mutate64(envelope.kdf.salt);
    await expect(openVault(envelope, fixture.session)).rejects.toMatchObject({
      code: "password",
    });
    await expect(
      openVault(envelope, { ...fixture.session, kdf: envelope.kdf }),
    ).rejects.toMatchObject({ code: "password" });
    await expect(unlockVault(envelope, password)).rejects.toMatchObject({
      code: "password",
    });
  });

  it("rejects unsupported schemas, algorithms and sizes before deriving a key", async () => {
    const derive = vi.spyOn(webcrypto.subtle, "deriveBits");
    const candidates: unknown[] = [
      null,
      [],
      { ...fixture.envelope, extra: "untrusted" },
      { ...fixture.envelope, version: 2 },
      { ...fixture.envelope, format: "other" },
      { ...fixture.envelope, kdf: { ...fixture.envelope.kdf, iterations: 1 } },
      {
        ...fixture.envelope,
        kdf: { ...fixture.envelope.kdf, iterations: 600001 },
      },
      { ...fixture.envelope, kdf: { ...fixture.envelope.kdf, hash: "SHA-1" } },
      { ...fixture.envelope, kdf: { ...fixture.envelope.kdf, name: "scrypt" } },
      { ...fixture.envelope, kdf: { ...fixture.envelope.kdf, salt: "AAAA" } },
      {
        ...fixture.envelope,
        cipher: { ...fixture.envelope.cipher, name: "AES-CBC" },
      },
      {
        ...fixture.envelope,
        cipher: { ...fixture.envelope.cipher, iv: "AAAA" },
      },
      {
        ...fixture.envelope,
        cipher: { ...fixture.envelope.cipher, data: "AAAA" },
      },
      {
        ...fixture.envelope,
        cipher: {
          ...fixture.envelope.cipher,
          data: "A".repeat(MAX_VAULT_CIPHERTEXT_BASE64_LENGTH + 4),
        },
      },
    ];
    for (const candidate of candidates) {
      await expect(unlockVault(candidate, password)).rejects.toBeInstanceOf(
        VaultError,
      );
    }
    await expect(
      createVault(password, "x".repeat(MAX_VAULT_PLAINTEXT_BYTES + 1)),
    ).rejects.toMatchObject({ code: "limit" });
    await expect(
      createVault(password, "🔐".repeat(MAX_VAULT_PLAINTEXT_BYTES / 4 + 1)),
    ).rejects.toMatchObject({ code: "limit" });
    expect(derive).not.toHaveBeenCalled();
  });

  it("requires exact canonical base64 and rejects accessors without running them", () => {
    const salt = fixture.envelope.kdf.salt;
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const last = alphabet.indexOf(salt[salt.length - 2]!);
    const noncanonical = `${salt.slice(0, -2)}${alphabet[last + 1]}=`;
    expect(atob(noncanonical)).toBe(atob(salt));
    for (const candidate of [
      salt.replace(/=$/, ""),
      `${salt}\n`,
      noncanonical,
    ]) {
      expect(() =>
        validateEnvelope({
          ...fixture.envelope,
          kdf: { ...fixture.envelope.kdf, salt: candidate },
        }),
      ).toThrow(VaultError);
    }
    const getter = vi.fn(() => fixture.envelope.kdf);
    const candidate = { ...fixture.envelope };
    Object.defineProperty(candidate, "kdf", { get: getter });
    expect(() => validateEnvelope(candidate)).toThrow(VaultError);
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      validateEnvelope(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error("secret");
            },
          },
        ),
      ),
    ).toThrow("Invalid or unsupported encrypted vault.");
  });

  it("returns an independent validated copy and rejects missing or malformed sessions", async () => {
    const copy = validateEnvelope(fixture.envelope);
    copy.kdf.salt = mutate64(copy.kdf.salt);
    expect(copy.kdf.salt).not.toBe(fixture.envelope.kdf.salt);
    for (const session of [
      null,
      {},
      { ...fixture.session, key: "AAAA" },
      { ...fixture.session, extra: true },
    ]) {
      await expect(
        openVault(fixture.envelope, session as VaultSession),
      ).rejects.toMatchObject({ code: "locked" });
    }
  });

  it("enforces codepoint and UTF-8 passphrase limits without silently changing input", async () => {
    const derive = vi.spyOn(webcrypto.subtle, "deriveBits");
    for (const value of [
      "short",
      "🔐".repeat(11),
      "é".repeat(513),
      "x".repeat(1025),
      `twelve chars\ud800`,
    ]) {
      await expect(createVault(value, source)).rejects.toMatchObject({
        code: "password",
      });
    }
    expect(derive).not.toHaveBeenCalled();
    const unicodePassword = "🔐".repeat(12);
    const created = await createVault(unicodePassword, source);
    expect(
      (await unlockVault(created.envelope, unicodePassword)).plaintext,
    ).toBe(source);
  });

  it("uses native nonextractable AES-256 keys with 128-bit authentication tags", async () => {
    const encrypt = vi.spyOn(webcrypto.subtle, "encrypt");
    const decrypt = vi.spyOn(webcrypto.subtle, "decrypt");
    const sealed = await sealVault(source, fixture.session);
    await openVault(sealed, fixture.session);
    const encryption = encrypt.mock.calls[0]!;
    const decryption = decrypt.mock.calls[0]!;
    for (const operation of [encryption, decryption]) {
      expect(operation[0]).toMatchObject({ name: "AES-GCM", tagLength: 128 });
      const key = operation[1];
      expect(key.extractable).toBe(false);
      expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
      await expect(webcrypto.subtle.exportKey("raw", key)).rejects.toThrow();
      const algorithm = operation[0] as AesGcmParams;
      expect(
        JSON.parse(new TextDecoder().decode(algorithm.additionalData)),
      ).toEqual({
        format: sealed.format,
        version: sealed.version,
        kdf: sealed.kdf,
        cipher: { name: "AES-GCM", iv: sealed.cipher.iv },
      });
    }
  });
});
