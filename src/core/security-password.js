// Password generation belongs to the shared editor core. It has no storage,
// network, DOM, host, or account dependencies.

export const DEFAULT_PASSWORD_OPTIONS = Object.freeze({
  length: 24,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
});

const CHARACTER_CLASSES = Object.freeze({
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  // Every printable ASCII punctuation character; no whitespace or controls.
  symbols: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
});
const MAX_CANDIDATES = 256;
const MAX_RANDOM_BYTES = 65_536;
const RANDOM_BATCH_SIZE = 256;

function generationError() {
  return new TypeError("Unable to generate password securely");
}

function configuredOptions(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !Object.hasOwn(DEFAULT_PASSWORD_OPTIONS, key),
    )
  )
    throw new TypeError("Invalid password options");
  const result = { ...DEFAULT_PASSWORD_OPTIONS, ...options };
  if (
    !Number.isInteger(result.length) ||
    result.length < 8 ||
    result.length > 128 ||
    Object.keys(CHARACTER_CLASSES).some(
      (key) => typeof result[key] !== "boolean",
    )
  )
    throw new TypeError("Invalid password options");
  if (!Object.keys(CHARACTER_CLASSES).some((key) => result[key]))
    throw new TypeError("Select at least one password character class");
  return result;
}

/** Uniformly sample passwords satisfying the enabled character classes. */
export function generatePassword(options = {}, crypto = globalThis.crypto) {
  const config = configuredOptions(options);
  if (typeof crypto?.getRandomValues !== "function")
    throw new TypeError("WebCrypto random generation is unavailable");
  const classes = Object.entries(CHARACTER_CLASSES)
    .filter(([key]) => config[key])
    .map(([, characters]) => characters);
  const alphabet = classes.join("");
  // Restrict byte values to an exact multiple of the alphabet size before %.
  // Each alphabet index then has the same number of possible byte preimages.
  const cutoff = 256 - (256 % alphabet.length);
  const bytes = new Uint8Array(RANDOM_BATCH_SIZE);
  let offset = bytes.length;
  let requestedBytes = 0;
  const nextByte = () => {
    if (offset === bytes.length) {
      if (requestedBytes >= MAX_RANDOM_BYTES) throw generationError();
      requestedBytes += bytes.length;
      try {
        crypto.getRandomValues(bytes);
      } catch {
        // Do not expose an injected provider's error text or partial output.
        throw generationError();
      }
      offset = 0;
    }
    return bytes[offset++];
  };

  try {
    for (let attempt = 0; attempt < MAX_CANDIDATES; attempt++) {
      let candidate = "";
      while (candidate.length < config.length) {
        const byte = nextByte();
        if (byte < cutoff) candidate += alphabet[byte % alphabet.length];
      }
      // Reject complete candidates instead of inserting mandatory characters:
      // this preserves uniformity over all strings satisfying the options.
      if (
        classes.every((characters) =>
          [...candidate].some((character) => characters.includes(character)),
        )
      )
        return candidate;
    }
    throw generationError();
  } finally {
    bytes.fill(0);
  }
}

/** A hidden field is not necessarily a password (e.g. TOTP or an API key). */
export function isPasswordField(field) {
  if (field?.hide !== true || typeof field.label !== "string") return false;
  // The line format has no password type. Keep inference to explicit labels
  // and familiar service qualifiers; never infer from arbitrary secret labels.
  const label = field.label.trim().replace(/\s+/gu, " ");
  return /^(?:(?:webdav|account|login|app|application|admin|master|smtp|imap|pop3|ftp|sftp|ssh|database|db|wi-?fi|vpn) )?(?:password|pwd|пароль)$/iu.test(
    label,
  );
}
