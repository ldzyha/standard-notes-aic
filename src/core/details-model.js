const OPEN_RE = /^>>>\|open\|[ \t]+(.+?)\s*$/u;
const CLOSED_RE = /^>>>[ \t]+(.+?)\s*$/u;
const CLOSE_RE = /^<<<[ \t]*$/u;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

// CodeMirror Text is immutable. All decoration layers share the same parse;
// selection-only transactions reuse it without retaining dead documents.
const documentBlocks = new WeakMap();
export function detailsForDocument(doc) {
  let blocks = documentBlocks.get(doc);
  if (!blocks) {
    blocks = parseDetailsBlocks(doc.toString());
    documentBlocks.set(doc, blocks);
  }
  return blocks;
}

function linesWithOffsets(value) {
  const text = String(value ?? "");
  const lines = [];
  let from = 0;
  while (from <= text.length) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline;
    lines.push({
      from,
      to,
      end: newline < 0 ? to : to + 1,
      text: text.slice(from, to),
    });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function header(line) {
  const opened = OPEN_RE.exec(line.text);
  if (opened) {
    const titleAt = line.text.indexOf(opened[1]);
    return { open: true, title: opened[1], titleFrom: line.from + titleAt };
  }
  const closed = CLOSED_RE.exec(line.text);
  if (!closed) return null;
  const titleAt = line.text.indexOf(closed[1]);
  return { open: false, title: closed[1], titleFrom: line.from + titleAt };
}

function summary(title) {
  const taskLink = /^- \[([ xX])\] \[(.*)\]\(([^()]*)\)$/u.exec(title);
  if (!taskLink)
    return { title, checked: null, label: title, href: "", taskOffset: -1 };
  return {
    title,
    checked: taskLink[1].toLowerCase() === "x",
    label: taskLink[2].replaceAll("\\]", "]").replaceAll("\\\\", "\\"),
    href: taskLink[3].trim(),
    taskOffset: title.indexOf(`[${taskLink[1]}]`) + 1,
  };
}

function fenceStart(value) {
  const match = FENCE_RE.exec(value);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

function closesFence(value, fence) {
  const match = FENCE_RE.exec(value);
  return Boolean(
    match &&
    match[1][0] === fence.char &&
    match[1].length >= fence.length &&
    value.slice(match[0].length).trim() === "",
  );
}

/** Parse non-nested, line-bound AIC details. Invalid structures remain ordinary source. */
export function parseDetailsBlocks(value) {
  const text = String(value ?? "");
  const lines = linesWithOffsets(text);
  const blocks = [];
  let start = null;
  let startLine = null;
  let fence = null;
  let invalid = false;
  for (const line of lines) {
    if (fence) {
      if (closesFence(line.text, fence)) fence = null;
      continue;
    }
    fence = fenceStart(line.text);
    if (fence) continue;
    const candidate = header(line);
    if (candidate) {
      if (start) invalid = true;
      else {
        start = candidate;
        startLine = line;
      }
      continue;
    }
    if (!start || !CLOSE_RE.test(line.text)) continue;
    if (!invalid)
      blocks.push({
        from: startLine.from,
        to: line.to,
        end: line.end,
        headerFrom: startLine.from,
        headerTo: startLine.to,
        contentFrom: startLine.end,
        contentTo: line.from,
        closeFrom: line.from,
        closeTo: line.to,
        open: start.open,
        title: start.title,
        titleFrom: start.titleFrom,
        summary: summary(start.title),
      });
    start = null;
    startLine = null;
    invalid = false;
  }
  return blocks;
}

/** Toggle one exact details header without changing its title bytes. */
export function toggleDetailsMarker(value) {
  const line = String(value ?? "");
  const opened = OPEN_RE.exec(line);
  if (opened) return `>>> ${opened[1]}`;
  const closed = CLOSED_RE.exec(line);
  if (closed) return `>>>|open| ${closed[1]}`;
  return null;
}
