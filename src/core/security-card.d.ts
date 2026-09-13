export type CardPart = "number" | "cvv" | "date";
export type CardValue = Readonly<{
  number: string;
  date: string;
  cvv: string;
}>;
export type CardParseResult =
  | Readonly<{ ok: true; card: CardValue }>
  | Readonly<{ ok: false; code: "invalid_card_field" }>;
export type CardField = Readonly<{
  kind: "card";
  value: string;
  description?: string;
  additionalSecret?: string;
}>;

/** The explicit underscore card kind; labels remain arbitrary. */
export function isCardField(field: unknown): boolean;
/** Validate PAN, expiry, CVV logical slots without exposing malformed values. */
export function parseCardField(field: CardField | unknown): CardParseResult;
/** Accept a raw clipboard part, preserving internal number separators. */
export function normalizeCardPart(part: CardPart, value: unknown): string;
