export type CardPart = "number";
export type CardValue = Readonly<{
  number: string;
}>;
export type CardParseResult =
  | Readonly<{ ok: true; card: CardValue }>
  | Readonly<{ ok: false; code: "invalid_card_field" }>;
export type CardField = Readonly<{
  kind: "card";
  value: string;
}>;

/** The explicit underscore card kind; labels remain arbitrary. */
export function isCardField(field: unknown): boolean;
/** Validate one typed card number without interpreting adjacent values. */
export function parseCardField(field: CardField | unknown): CardParseResult;
/** Accept a raw clipboard part, preserving internal number separators. */
export function normalizeCardPart(part: CardPart, value: unknown): string;
