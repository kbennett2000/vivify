import { describe, it, expect } from 'vitest';
import type { BuiltinCharacter } from '../src/characters.js';
import { parseBuiltinIndex, builtinManifestUrl, isAcsFile } from '../src/characters.js';

// Tied to Cycle 4 (docs/cycles/cycle-4-mash.md): the MASH demo's built-in
// character index must be parsed safely (ids can't escape /characters/<id>/),
// manifest URLs must resolve, and the upload guard must recognize .acs files.

describe('parseBuiltinIndex', () => {
  it('maps a valid array of entries, round-tripping id and label', () => {
    const result = parseBuiltinIndex([
      { id: 'genie', label: 'Genie' },
      { id: 'merlin', label: 'Merlin' },
    ]);
    expect(result).toEqual([
      { id: 'genie', label: 'Genie' },
      { id: 'merlin', label: 'Merlin' },
    ]);
  });

  it('falls back to id when label is missing', () => {
    expect(parseBuiltinIndex([{ id: 'rover' }])).toEqual([{ id: 'rover', label: 'rover' }]);
  });

  it('falls back to id when label is an empty string', () => {
    expect(parseBuiltinIndex([{ id: 'x', label: '' }])).toEqual([{ id: 'x', label: 'x' }]);
  });

  it('keeps ids made of [A-Za-z0-9_-]', () => {
    const result = parseBuiltinIndex([{ id: 'Genie_2' }, { id: 'merlin-v1' }, { id: 'ABC123' }]);
    expect(result).toEqual([
      { id: 'Genie_2', label: 'Genie_2' },
      { id: 'merlin-v1', label: 'merlin-v1' },
      { id: 'ABC123', label: 'ABC123' },
    ]);
  });

  it('drops entries whose id contains path-traversal or whitespace chars', () => {
    const result = parseBuiltinIndex([{ id: '../evil' }, { id: 'a/b' }, { id: 'a b' }, { id: '' }]);
    expect(result).toEqual([]);
  });

  it('drops entries with a non-string id', () => {
    const result = parseBuiltinIndex([
      { id: 42 },
      { id: null },
      { id: undefined },
      { id: ['genie'] },
      { id: { toString: () => 'genie' } },
      {},
    ]);
    expect(result).toEqual([]);
  });

  it('keeps only the valid entries in a mixed array', () => {
    const result = parseBuiltinIndex([
      { id: 'genie', label: 'Genie' },
      { id: '../evil' },
      { id: 'merlin' },
      { id: 'bad id' },
      { id: 99 },
    ]);
    expect(result).toEqual([
      { id: 'genie', label: 'Genie' },
      { id: 'merlin', label: 'merlin' },
    ]);
  });

  it('returns [] for non-array / junk inputs without throwing', () => {
    const junk: unknown[] = [null, undefined, {}, 42, 'str'];
    for (const input of junk) {
      expect(() => parseBuiltinIndex(input)).not.toThrow();
      expect(parseBuiltinIndex(input)).toEqual([]);
    }
  });

  it('returns [] for an array containing no valid entries', () => {
    expect(parseBuiltinIndex([1, 'x', null, {}])).toEqual([]);
  });
});

describe('builtinManifestUrl', () => {
  it('builds the manifest path for a plain id', () => {
    expect(builtinManifestUrl('genie')).toBe('/characters/genie/manifest.json');
  });
});

describe('isAcsFile', () => {
  it('is true for a .acs filename', () => {
    expect(isAcsFile({ name: 'Genie.acs' })).toBe(true);
  });

  it('is true regardless of extension case', () => {
    expect(isAcsFile({ name: 'x.ACS' })).toBe(true);
  });

  it('is false for non-.acs extensions', () => {
    expect(isAcsFile({ name: 'genie.acd' })).toBe(false);
  });

  it('is false when .acs is not the final extension', () => {
    expect(isAcsFile({ name: 'genie.acs.txt' })).toBe(false);
  });

  it('is false for a name with no extension', () => {
    expect(isAcsFile({ name: 'noext' })).toBe(false);
  });

  it('is false when a trailing space follows the extension', () => {
    expect(isAcsFile({ name: '.acs ' })).toBe(false);
  });
});

// Compile-time guard: parseBuiltinIndex returns the public BuiltinCharacter[].
const _typecheck: BuiltinCharacter[] = parseBuiltinIndex([]);
void _typecheck;
