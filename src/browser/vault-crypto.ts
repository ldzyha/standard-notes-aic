/** Native WebCrypto envelope shared by local storage and portable backups. */
export const MAX_VAULT_PLAINTEXT_BYTES = 6 * 1024 * 1024;
export const MAX_VAULT_CIPHERTEXT_BASE64_LENGTH =
  4 * Math.ceil((MAX_VAULT_PLAINTEXT_BYTES + 16) / 3);

export interface VaultKdf {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: 600000;
  salt: string;
}

export interface VaultEnvelope {
  format: "aic-browser-vault";
  version: 1;
  kdf: VaultKdf;
  cipher: { name: "AES-GCM"; iv: string; data: string };
}

/** The encoded key is secret: store only in trusted browser session memory. */
export interface VaultSession {
  key: string;
  kdf: VaultKdf;
}

export type VaultErrorCode =
  "invalid" | "locked" | "password" | "crypto" | "limit";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

const encoder = new TextEncoder();
const AUTH_FAILURE =
  "Unable to unlock the vault. Check the passphrase or backup.";

function invalid(): never {
  throw new VaultError("invalid", "Invalid or unsupported encrypted vault.");
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(value).length !== keys.length
  ) {
    return invalid();
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property)) return invalid();
    result[key] = property.value;
  }
  return result;
}

function encode64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decode64(value: unknown, minBytes: number, maxBytes = minBytes) {
  if (typeof value !== "string") return invalid();
  if (value.length > 4 * Math.ceil(maxBytes / 3)) {
    throw new VaultError(
      "limit",
      "Encrypted vault exceeds the supported size.",
    );
  }
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return invalid();
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return invalid();
  }
  if (binary.length < minBytes || binary.length > maxBytes) return invalid();
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  // atob accepts nonzero padding bits; only the canonical spelling is allowed.
  if (encode64(bytes) !== value) return invalid();
  return bytes;
}

function validateKdf(value: unknown): VaultKdf {
  const kdf = record(value, ["name", "hash", "iterations", "salt"]);
  if (
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    kdf.iterations !== 600000
  ) {
    return invalid();
  }
  decode64(kdf.salt, 32);
  return {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600000,
    salt: kdf.salt as string,
  };
}

export function validateEnvelope(value: unknown): VaultEnvelope {
  try {
    const envelope = record(value, ["format", "version", "kdf", "cipher"]);
    if (envelope.format !== "aic-browser-vault" || envelope.version !== 1) {
      return invalid();
    }
    const kdf = validateKdf(envelope.kdf);
    const cipher = record(envelope.cipher, ["name", "iv", "data"]);
    if (cipher.name !== "AES-GCM") return invalid();
    decode64(cipher.iv, 12);
    decode64(cipher.data, 16, MAX_VAULT_PLAINTEXT_BYTES + 16);
    return {
      format: "aic-browser-vault",
      version: 1,
      kdf,
      cipher: {
        name: "AES-GCM",
        iv: cipher.iv as string,
        data: cipher.data as string,
      },
    };
  } catch (error) {
    if (error instanceof VaultError) throw error;
    return invalid();
  }
}

function validateSession(value: unknown): VaultSession {
  try {
    const session = record(value, ["key", "kdf"]);
    decode64(session.key, 32);
    return { key: session.key as string, kdf: validateKdf(session.kdf) };
  } catch {
    throw new VaultError("locked", "Unlock the vault to continue.");
  }
}

function cryptoProvider(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new VaultError(
      "crypto",
      "Secure browser cryptography is unavailable.",
    );
  }
  return globalThis.crypto;
}

function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  if (typeof password !== "string" || password.length > 1024) {
    throw new VaultError(
      "password",
      "Use 12 or more characters, up to 1024 UTF-8 bytes.",
    );
  }
  const bytes = encoder.encode(password);
  if (
    [...password].length < 12 ||
    bytes.length > 1024 ||
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== password
  ) {
    bytes.fill(0);
    throw new VaultError(
      "password",
      "Use 12 or more characters, up to 1024 UTF-8 bytes.",
    );
  }
  return bytes;
}

function plaintextBytes(plaintext: string): Uint8Array<ArrayBuffer> {
  if (typeof plaintext !== "string") return invalid();
  if (plaintext.length > MAX_VAULT_PLAINTEXT_BYTES) {
    throw new VaultError("limit", "Vault data exceeds the supported size.");
  }
  const bytes = encoder.encode(plaintext);
  if (bytes.length > MAX_VAULT_PLAINTEXT_BYTES) {
    bytes.fill(0);
    throw new VaultError("limit", "Vault data exceeds the supported size.");
  }
  if (
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== plaintext
  ) {
    bytes.fill(0);
    return invalid();
  }
  return bytes;
}

function authenticatedHeader(envelope: VaultEnvelope): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      kdf: envelope.kdf,
      cipher: { name: envelope.cipher.name, iv: envelope.cipher.iv },
    }),
  );
}

async function deriveSession(
  password: string,
  kdf: VaultKdf,
): Promise<VaultSession> {
  const bytes = passwordBytes(password);
  try {
    const crypto = cryptoProvider();
    const material = await crypto.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          iterations: 600000,
          salt: decode64(kdf.salt, 32),
        },
        material,
        256,
      ),
    );
    try {
      return { key: encode64(bits), kdf: { ...kdf } };
    } finally {
      bits.fill(0);
    }
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError("crypto", "Unable to initialize secure cryptography.");
  } finally {
    bytes.fill(0);
  }
}

async function importSessionKey(session: VaultSession): Promise<CryptoKey> {
  const bytes = decode64(session.key, 32);
  try {
    return await cryptoProvider().subtle.importKey(
      "raw",
      bytes,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}

export async function createVault(
  password: string,
  plaintext: string,
): Promise<{ envelope: VaultEnvelope; session: VaultSession }> {
  // Validate size before performing the deliberately expensive password KDF.
  plaintextBytes(plaintext).fill(0);
  const kdf: VaultKdf = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600000,
    salt: "",
  };
  try {
    kdf.salt = encode64(cryptoProvider().getRandomValues(new Uint8Array(32)));
    const session = await deriveSession(password, kdf);
    return { envelope: await sealVault(plaintext, session), session };
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError("crypto", "Unable to create the encrypted vault.");
  }
}

export async function unlockVault(
  value: unknown,
  password: string,
): Promise<{ plaintext: string; session: VaultSession }> {
  const envelope = validateEnvelope(value);
  const session = await deriveSession(password, envelope.kdf);
  return { plaintext: await openVault(envelope, session), session };
}

export async function sealVault(
  plaintext: string,
  value: VaultSession,
): Promise<VaultEnvelope> {
  const session = validateSession(value);
  const bytes = plaintextBytes(plaintext);
  try {
    const crypto = cryptoProvider();
    const envelope: VaultEnvelope = {
      format: "aic-browser-vault",
      version: 1,
      kdf: session.kdf,
      cipher: {
        name: "AES-GCM",
        iv: encode64(crypto.getRandomValues(new Uint8Array(12))),
        data: "",
      },
    };
    const key = await importSessionKey(session);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: decode64(envelope.cipher.iv, 12),
        additionalData: authenticatedHeader(envelope),
        tagLength: 128,
      },
      key,
      bytes,
    );
    envelope.cipher.data = encode64(new Uint8Array(ciphertext));
    return envelope;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError("crypto", "Unable to encrypt the vault.");
  } finally {
    bytes.fill(0);
  }
}

export async function openVault(
  value: unknown,
  sessionValue: VaultSession,
): Promise<string> {
  const envelope = validateEnvelope(value);
  const session = validateSession(sessionValue);
  if (session.kdf.salt !== envelope.kdf.salt) {
    throw new VaultError("password", AUTH_FAILURE);
  }
  let key: CryptoKey;
  try {
    key = await importSessionKey(session);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError("crypto", "Unable to initialize secure cryptography.");
  }
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = new Uint8Array(
      await cryptoProvider().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode64(envelope.cipher.iv, 12),
          additionalData: authenticatedHeader(envelope),
          tagLength: 128,
        },
        key,
        decode64(envelope.cipher.data, 16, MAX_VAULT_PLAINTEXT_BYTES + 16),
      ),
    );
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      plaintext,
    );
  } catch {
    // Wrong passwords, damaged ciphertext and authenticated-header edits match.
    throw new VaultError("password", AUTH_FAILURE);
  } finally {
    plaintext?.fill(0);
  }
}
