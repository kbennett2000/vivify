// Balloon word-wrap (pure). Wraps text to at most `charsPerLine` columns; if
// `maxLines` is given, caps the line count and ellipsizes the last kept line.
// Long words are hard-broken at the column width.

export function wrapText(text: string, charsPerLine: number, maxLines?: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (charsPerLine <= 0) return [trimmed];

  const lines: string[] = [];
  let line = '';
  const flush = (): void => {
    if (line) {
      lines.push(line);
      line = '';
    }
  };

  for (const rawWord of trimmed.split(/\s+/)) {
    let word = rawWord;
    // Hard-break words longer than a full line.
    while (word.length > charsPerLine) {
      flush();
      lines.push(word.slice(0, charsPerLine));
      word = word.slice(charsPerLine);
    }
    if (word.length === 0) continue;
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= charsPerLine) {
      line += ` ${word}`;
    } else {
      flush();
      line = word;
    }
  }
  flush();

  if (maxLines !== undefined && maxLines > 0 && lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const lastIdx = maxLines - 1;
    const last = kept[lastIdx]!;
    kept[lastIdx] =
      last.length >= charsPerLine ? `${last.slice(0, Math.max(0, charsPerLine - 1))}…` : `${last}…`;
    return kept;
  }
  return lines;
}
