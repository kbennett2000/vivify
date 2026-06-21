// Cycle 5 acceptance (docs/cycles/cycle-5-voice.md → "What is verified where",
// CI bullet): "timeline→MouthEvent[] parsing". parseTimeline is the tolerant
// normalizer from the bridge's timeline JSON to the engine-facing MouthEvent[].
// It must keep only {timeMs, shape} when both are finite numbers, drop junk
// entries, ignore extra fields, and return [] for anything malformed.

import { describe, it, expect } from 'vitest';
import type { MouthEvent } from '@vivify/types';
import { parseTimeline } from '../src/timeline.js';

describe('parseTimeline', () => {
  it('maps valid events to MouthEvent[] keeping only timeMs + shape', () => {
    const raw = {
      events: [
        { timeMs: 0, shape: 0, phoneme: 0, mouth: { height: 0 } },
        { timeMs: 50, shape: 5, phoneme: 65, mouth: { height: 5 } },
        { timeMs: 120, shape: 2 },
      ],
    };
    const expected: MouthEvent[] = [
      { timeMs: 0, shape: 0 },
      { timeMs: 50, shape: 5 },
      { timeMs: 120, shape: 2 },
    ];
    expect(parseTimeline(raw)).toEqual(expected);
  });

  it('ignores extra fields (phoneme/mouth) on otherwise-valid entries', () => {
    const result = parseTimeline({
      events: [{ timeMs: 10, shape: 3, phoneme: 'AA', mouth: { height: 7, width: 2 } }],
    });
    expect(result).toEqual([{ timeMs: 10, shape: 3 }]);
    // Confirm the extras really are stripped, not merely deep-equal-ignored.
    expect(Object.keys(result[0] as object).sort()).toEqual(['shape', 'timeMs']);
  });

  it('drops entries with a non-numeric timeMs', () => {
    expect(parseTimeline({ events: [{ timeMs: '0', shape: 1 }] })).toEqual([]);
  });

  it('drops entries with a non-numeric shape', () => {
    expect(parseTimeline({ events: [{ timeMs: 0, shape: 'open' }] })).toEqual([]);
  });

  it('drops entries with NaN / Infinity timeMs or shape', () => {
    const raw = {
      events: [
        { timeMs: NaN, shape: 1 },
        { timeMs: 0, shape: Infinity },
        { timeMs: -Infinity, shape: 2 },
      ],
    };
    expect(parseTimeline(raw)).toEqual([]);
  });

  it('drops non-object entries (null, number, string) but keeps valid neighbours', () => {
    const raw = {
      events: [null, 42, 'x', { timeMs: 5, shape: 4 }, undefined],
    };
    expect(parseTimeline(raw)).toEqual([{ timeMs: 5, shape: 4 }]);
  });

  it('returns [] for null', () => {
    expect(parseTimeline(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseTimeline(undefined)).toEqual([]);
  });

  it('returns [] for a number', () => {
    expect(parseTimeline(123)).toEqual([]);
  });

  it('returns [] for a string', () => {
    expect(parseTimeline('events')).toEqual([]);
  });

  it('returns [] for an object with no events', () => {
    expect(parseTimeline({})).toEqual([]);
  });

  it('returns [] when events is not an array', () => {
    expect(parseTimeline({ events: 'x' })).toEqual([]);
  });

  it('returns [] for an empty events array', () => {
    expect(parseTimeline({ events: [] })).toEqual([]);
  });
});
