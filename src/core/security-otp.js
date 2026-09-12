// TOTP belongs to the shared editor core, not to the Standard Notes account
// sign-in flow. It has no storage, network, DOM, or host dependencies.

const ALGORITHMS = Object.freeze({
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
});

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_INPUT_LENGTH = 8_192;

function invalid(message) {
  return new TypeError(message);
}

function normalizeSecret(value) {
  if (typeof value !== "string" || value.length > MAX_INPUT_LENGTH)
    throw invalid("Invalid TOTP secret");
  const compact = value.replace(/[\s-]/gu, "").toUpperCase();
  const match = /^([A-Z2-7]+)(=*)$/u.exec(compact);
  if (!match) throw invalid("Invalid TOTP secret");
  const secret = match[1];
  const padding = match[2];
  const remainder = secret.length % 8;
  const expectedPadding = { 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 }[remainder];
  if (
    expectedPadding === undefined ||
    (padding.length > 0 &&
      (padding.length !== expectedPadding || compact.length % 8 !== 0))
  )
    throw invalid("Invalid TOTP secret");

  let bits = 0;
  let accumulator = 0;
  let count = 0;
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      count += 1;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (count === 0 || accumulator !== 0) throw invalid("Invalid TOTP secret");
  return secret;
}

function decodeSecret(secret) {
  const bytes = new Uint8Array(Math.floor((secret.length * 5) / 8));
  let bits = 0;
  let accumulator = 0;
  let index = 0;
  for (const character of secret) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (accumulator >>> bits) & 0xff;
      accumulator &= (1 << bits) - 1;
    }
  }
  return bytes;
}

function algorithm(value) {
  const normalized = String(value ?? "SHA1")
    .trim()
    .toUpperCase()
    .replaceAll("-", "");
  if (!Object.hasOwn(ALGORITHMS, normalized))
    throw invalid("Unsupported TOTP algorithm");
  return normalized;
}

function numberParameter(value, minimum, maximum, message) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^[1-9]\d*$/u.test(text))
    throw invalid(message);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw invalid(message);
  return parsed;
}

function uniqueParameter(url, name, required = false) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1 || (required && values.length !== 1))
    throw invalid("Invalid TOTP URI");
  return values[0];
}

function parsedConfig(secret, options = {}) {
  return Object.freeze({
    secret: normalizeSecret(secret),
    algorithm: algorithm(options.algorithm),
    digits: numberParameter(options.digits ?? 6, 6, 8, "Invalid TOTP digits"),
    period: numberParameter(
      options.period ?? 30,
      15,
      120,
      "Invalid TOTP period",
    ),
    label: String(options.label ?? ""),
    issuer: String(options.issuer ?? ""),
  });
}

/** Parse a Base32 seed or standard otpauth://totp provisioning URI. */
export function parseTotpInput(input) {
  if (input && typeof input === "object" && !Array.isArray(input))
    return parsedConfig(input.secret, input);
  if (typeof input !== "string" || input.length > MAX_INPUT_LENGTH)
    throw invalid("Invalid TOTP input");
  const source = input.trim();
  if (!/^otpauth:/iu.test(source)) return parsedConfig(source);

  let url;
  try {
    url = new URL(source);
  } catch {
    throw invalid("Invalid TOTP URI");
  }
  if (url.protocol !== "otpauth:") throw invalid("Invalid TOTP URI");
  if (url.hostname === "hotp") throw invalid("HOTP is not supported");
  if (
    url.hostname !== "totp" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw invalid("Invalid TOTP URI");
  const secret = uniqueParameter(url, "secret", true);
  const configuredAlgorithm = uniqueParameter(url, "algorithm");
  const digits = uniqueParameter(url, "digits");
  const period = uniqueParameter(url, "period");
  const issuer = uniqueParameter(url, "issuer");
  let label;
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    throw invalid("Invalid TOTP URI");
  }
  return parsedConfig(secret, {
    algorithm: configuredAlgorithm ?? undefined,
    digits: digits ?? undefined,
    period: period ?? undefined,
    label,
    issuer: issuer ?? "",
  });
}

/** RFC 6238 TOTP using RFC 4226 dynamic truncation and WebCrypto HMAC. */
export async function totpAt(
  input,
  now = Date.now(),
  crypto = globalThis.crypto,
) {
  const config = parseTotpInput(input);
  if (!Number.isSafeInteger(now) || now < 0) throw invalid("Invalid TOTP time");
  if (!crypto?.subtle?.importKey || !crypto?.subtle?.sign)
    throw invalid("WebCrypto HMAC is unavailable");

  const counter = Math.floor(now / (config.period * 1_000));
  const message = new Uint8Array(8);
  let remainingCounter = BigInt(counter);
  for (let index = 7; index >= 0; index--) {
    message[index] = Number(remainingCounter & 0xffn);
    remainingCounter >>= 8n;
  }
  const secretBytes = decodeSecret(config.secret);
  let signature;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: ALGORITHMS[config.algorithm] },
      false,
      ["sign"],
    );
    signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  } catch {
    throw invalid("Unable to generate TOTP code");
  } finally {
    secretBytes.fill(0);
    message.fill(0);
  }
  if (signature.length < 20) throw invalid("Unable to generate TOTP code");
  const offset = signature[signature.length - 1] & 0x0f;
  const value =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  const code = String(value % 10 ** config.digits).padStart(config.digits, "0");
  signature.fill(0);
  return Object.freeze({
    code,
    secondsRemaining: config.period - (Math.floor(now / 1_000) % config.period),
    period: config.period,
  });
}
