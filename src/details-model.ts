const OPEN_RE = /^>>>\|open\|[ \t]+(.+?)\s*$/u;
const CLOSED_RE = /^>>>[ \t]+(.+?)\s*$/u;
const CLOSE_RE = /^<<<[ \t]*$/u;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

export type DetailsSummary = Readonly<{
  title: string;
  checked: boolean | null;
  label: string;
  href: string;
  taskOffset: number;
}>;

export type DetailsBlock = Readonly<{
  from: number;
  to: number;
  end: number;
  headerFrom: number;
  headerTo: number;
  contentFrom: number;
  contentTo: number;
  closeFrom: number;
  closeTo: number;
  open: boolean;
  title: string;
  titleFrom: number;
  summary: DetailsSummary;
}>;

type OffsetLine = Readonly<{
  from: number;
  to: number;
  end: number;
  text: string;
}>;

function linesWithOffsets(value: string): OffsetLine[] {
  const lines: OffsetLine[] = [];
  let from = 0;
  while (from <= value.length) {
    const newline = value.indexOf("\n", from);
    const to = newline < 0 ? value.length : newline;
    lines.push({
      from,
      to,
      end: newline < 0 ? to : to + 1,
      text: value.slice(from, to),
    });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function header(line: OffsetLine) {
  const opened = OPEN_RE.exec(line.text);
  if (opened?.[1]) {
    return {
      open: true,
      title: opened[1],
      titleFrom: line.from + line.text.indexOf(opened[1]),
    };
  }
  const closed = CLOSED_RE.exec(line.text);
  if (!closed?.[1]) return null;
  return {
    open: false,
    title: closed[1],
    titleFrom: line.from + line.text.indexOf(closed[1]),
  };
}

function summary(title: string): DetailsSummary {
  const taskLink = /^- \[([ xX])\] \[(.*)\]\(([^()]*)\)$/u.exec(title);
  if (!taskLink?.[1]) {
    return { title, checked: null, label: title, href: "", taskOffset: -1 };
  }
  return {
    title,
    checked: taskLink[1].toLowerCase() === "x",
    label: (taskLink[2] ?? "").replaceAll("\\]", "]").replaceAll("\\\\", "\\"),
    href: (taskLink[3] ?? "").trim(),
    taskOffset: title.indexOf(`[${taskLink[1]}]`) + 1,
  };
}

function fenceStart(value: string) {
  const match = FENCE_RE.exec(value);
  return match?.[1] ? { char: match[1][0], length: match[1].length } : null;
}

function closesFence(
  value: string,
  fence: { char: string | undefined; length: number },
) {
  const match = FENCE_RE.exec(value);
  return Boolean(
    match?.[1] &&
    match[1][0] === fence.char &&
    match[1].length >= fence.length &&
    value.slice(match[0].length).trim() === "",
  );
}

export function parseDetailsBlocks(value: string): DetailsBlock[] {
  const text = String(value ?? "");
  const lines = linesWithOffsets(text);
  const blocks: DetailsBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    const startLine = lines[index];
    if (!startLine) continue;
    const start = header(startLine);
    if (!start) continue;
    let fence: { char: string | undefined; length: number } | null = null;
    let invalid = false;
    let closeIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (!line) continue;
      if (fence) {
        if (closesFence(line.text, fence)) fence = null;
        continue;
      }
      fence = fenceStart(line.text);
      if (fence) continue;
      if (header(line)) {
        invalid = true;
        continue;
      }
      if (CLOSE_RE.test(line.text)) {
        closeIndex = cursor;
        break;
      }
    }
    if (invalid || closeIndex < 0) {
      if (closeIndex >= 0) index = closeIndex;
      continue;
    }
    const closeLine = lines[closeIndex];
    if (!closeLine) continue;
    blocks.push({
      from: startLine.from,
      to: closeLine.to,
      end: closeLine.end,
      headerFrom: startLine.from,
      headerTo: startLine.to,
      contentFrom: startLine.end,
      contentTo: closeLine.from,
      closeFrom: closeLine.from,
      closeTo: closeLine.to,
      open: start.open,
      title: start.title,
      titleFrom: start.titleFrom,
      summary: summary(start.title),
    });
    index = closeIndex;
  }
  return blocks;
}

export function toggleDetailsMarker(value: string): string | null {
  const line = String(value ?? "");
  const opened = OPEN_RE.exec(line);
  if (opened?.[1]) return `>>> ${opened[1]}`;
  const closed = CLOSED_RE.exec(line);
  if (closed?.[1]) return `>>>|open| ${closed[1]}`;
  return null;
}
