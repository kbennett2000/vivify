// Cycle 3 — balloon word-wrap (pure). See docs/cycles/cycle-3-renderer.md.

import { describe, it, expect } from 'vitest';
import { wrapText } from '../src/wrap.js';

describe('wrapText', () => {
  it('wraps multiple words to at most charsPerLine columns', () => {
    const lines = wrapText('the quick brown fox', 10);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
    expect(lines).toEqual(['the quick', 'brown fox']);
  });

  it('hard-breaks a word longer than charsPerLine', () => {
    const lines = wrapText('antidisestablishment', 5);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(5);
    expect(lines).toEqual(['antid', 'isest', 'ablis', 'hment']);
  });

  it('caps to maxLines and ellipsizes the last kept line', () => {
    const lines = wrapText('one two three four five six', 4, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(4);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(wrapText('', 10)).toEqual([]);
    expect(wrapText('   ', 10)).toEqual([]);
    expect(wrapText('\t\n ', 10)).toEqual([]);
  });

  it('keeps a single short line as one line', () => {
    expect(wrapText('hello', 10)).toEqual(['hello']);
  });
});
