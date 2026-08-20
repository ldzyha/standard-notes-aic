export const MERMAID_LIMITS = Object.freeze({
  characters: 50_000,
  lines: 10_000,
  documentCharacters: 2_097_152,
  candidates: 128,
});

export type MermaidCandidate = Readonly<{
  from: number;
  to: number;
  decorationTo: number;
  textFrom: number;
  textTo: number;
  source: string;
  closed: boolean;
  line: number;
}>;

export function mermaidFenceText(source = ""): string {
  const text = String(source ?? "");
  let longest = 0;
  for (const line of text.split("\n")) {
    const match = line.match(/^[ \t]*(`+)/u);
    if (match?.[1]) longest = Math.max(longest, match[1].length);
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}mermaid\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

export function planMermaidFenceInsertion({
  doc = "",
  from = 0,
  to = from,
  source: explicitSource,
}: {
  doc?: string;
  from?: number;
  to?: number;
  source?: string;
} = {}) {
  const start = Math.max(
    0,
    Math.min(doc.length, Number.isSafeInteger(from) ? from : 0),
  );
  const end = Math.max(
    start,
    Math.min(doc.length, Number.isSafeInteger(to) ? to : start),
  );
  const selected = doc.slice(start, end);
  const source =
    explicitSource == null
      ? selected || "flowchart TD\n  "
      : String(explicitSource);
  const before = start > 0 && doc[start - 1] !== "\n" ? "\n" : "";
  const after = end < doc.length && doc[end] !== "\n" ? "\n" : "";
  const artifact = mermaidFenceText(source);
  const openingEnd = artifact.indexOf("\n") + 1;
  const textFrom = start + before.length + openingEnd;
  const insert = `${before}${artifact}${after}`;
  return {
    source,
    textFrom,
    changes: { from: start, to: end, insert },
    selection: { anchor: textFrom + source.length },
  };
}

function afterLineBreak(text: string, index: number): number {
  return index < text.length && text[index] === "\n" ? index + 1 : index;
}

export function mermaidFences(
  document = "",
  { maxFences = Number.MAX_SAFE_INTEGER }: { maxFences?: number } = {},
): MermaidCandidate[] {
  const text = String(document ?? "");
  const fences: MermaidCandidate[] = [];
  const limit = Math.max(
    0,
    Number.isSafeInteger(maxFences) ? maxFences : Number.MAX_SAFE_INTEGER,
  );
  if (limit === 0 || !text) return fences;

  const openingPattern =
    /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid(?:[ \t]+[^\r\n]*)?[ \t]*\r?$/gimu;
  let line = 1;
  let lineCursor = 0;
  for (
    let opening = openingPattern.exec(text);
    opening;
    opening = openingPattern.exec(text)
  ) {
    while (true) {
      const newline = text.indexOf("\n", lineCursor);
      if (newline < 0 || newline >= opening.index) break;
      line++;
      lineCursor = newline + 1;
    }
    const openingFence = opening[1];
    if (!openingFence) continue;
    const marker = openingFence[0];
    const openingRawTo = opening.index + opening[0].length;
    const textFrom = afterLineBreak(text, openingRawTo);
    const closingPattern = new RegExp(
      `^[ \\t]{0,3}${marker}{${openingFence.length},}[ \\t]*\\r?$`,
      "gmu",
    );
    closingPattern.lastIndex = textFrom;
    const closing = closingPattern.exec(text);
    const textTo = closing?.index ?? text.length;
    const closingRawTo = closing
      ? closing.index + closing[0].length
      : text.length;
    const closingTo = closingRawTo - (closing?.[0].endsWith("\r") ? 1 : 0);
    fences.push(
      Object.freeze({
        from: opening.index,
        to: closingTo,
        decorationTo: afterLineBreak(text, closingRawTo),
        textFrom,
        textTo,
        source: text.slice(textFrom, textTo),
        closed: Boolean(closing),
        line,
      }),
    );
    if (fences.length >= limit || !closing) break;
    openingPattern.lastIndex = closingRawTo;
  }
  return fences;
}

export type MermaidScan = Readonly<{
  limited: boolean;
  reason?: "documentCharacters" | "candidates";
  candidates: readonly MermaidCandidate[];
}>;

export function scanMermaidCandidates(document: string): MermaidScan {
  if (document.length > MERMAID_LIMITS.documentCharacters) {
    return Object.freeze({
      limited: true,
      reason: "documentCharacters",
      candidates: Object.freeze([]),
    });
  }
  const found = mermaidFences(document, {
    maxFences: MERMAID_LIMITS.candidates + 1,
  });
  const limited = found.length > MERMAID_LIMITS.candidates;
  const candidates = found
    .slice(0, MERMAID_LIMITS.candidates)
    .filter(
      (candidate) => candidate.closed && candidate.source.trim().length > 0,
    );
  return Object.freeze({
    limited,
    ...(limited ? { reason: "candidates" as const } : {}),
    candidates: Object.freeze(candidates),
  });
}

export function mermaidLimitError(source: string): Error | null {
  if (source.length > MERMAID_LIMITS.characters) {
    return new Error(
      `Mermaid is limited to ${MERMAID_LIMITS.characters.toLocaleString("en-US")} characters; this source has ${source.length.toLocaleString("en-US")}.`,
    );
  }
  const lines = source.length ? source.split(/\r?\n/u).length : 1;
  if (lines > MERMAID_LIMITS.lines) {
    return new Error(
      `Mermaid is limited to ${MERMAID_LIMITS.lines.toLocaleString("en-US")} lines; this source has ${lines.toLocaleString("en-US")}.`,
    );
  }
  return null;
}
