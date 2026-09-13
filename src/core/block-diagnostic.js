/** Location-only metadata. Callers supply fixed codes/advice, never source text. */
export function blockDiagnostic(body, code, message, from = 0, to = from) {
  const source = typeof body === "string" ? body : "";
  const clamp = (offset) =>
    Math.min(
      source.length,
      Math.max(0, Number.isFinite(offset) ? Math.trunc(offset) : 0),
    );
  const start = clamp(from);
  const end = Math.max(start, clamp(to));
  let line = 1;
  let lineStart = 0;
  const breaks = /\r\n|\r|\n/gu;
  for (const match of source.matchAll(breaks)) {
    const next = match.index + match[0].length;
    if (next > start) break;
    line += 1;
    lineStart = next;
  }
  return Object.freeze({
    code,
    message,
    from: start,
    to: end,
    line,
    column: start - lineStart + 1,
  });
}
