// Cycle 6 (docs/cycles/cycle-6-lipsync.md → "Validation → CI": "lipsync pure
// helpers: activeMouthEvent(timeline, t), chooseOverlay(shape, overlays)").
// Pure mapping logic, no DOM, no audio. We assert the documented contract +
// monotonic openness property rather than the exact bucket arithmetic so the
// mapping stays tunable (ADR-0016) without breaking these tests.

import { describe, it, expect } from 'vitest';
import type { FrameMouthOverlay, MouthEvent } from '@vivify/types';
import { activeMouthEvent, chooseOverlay, interpolatedShape, SHAPE_MAX } from '../src/lipsync.js';

const ev = (timeMs: number, shape: number): MouthEvent => ({ timeMs, shape });

/** Build an overlay with a distinct `type` (ordering key) + `imageIndex` (identity). */
const overlay = (type: number, imageIndex: number): FrameMouthOverlay => ({
  type,
  replaceFlag: false,
  imageIndex,
  x: 0,
  y: 0,
  rgnFlag: 0,
  scaleX: 1,
  scaleY: 1,
});

describe('activeMouthEvent', () => {
  it('returns null for an empty timeline', () => {
    expect(activeMouthEvent([], 0)).toBeNull();
    expect(activeMouthEvent([], 1000)).toBeNull();
  });

  it('returns null before the first event', () => {
    const tl = [ev(100, 1), ev(200, 2)];
    expect(activeMouthEvent(tl, 0)).toBeNull();
    expect(activeMouthEvent(tl, 99)).toBeNull();
  });

  it('returns the event at its exact timeMs', () => {
    const tl = [ev(0, 5), ev(100, 6), ev(200, 7)];
    expect(activeMouthEvent(tl, 0)).toBe(tl[0]);
    expect(activeMouthEvent(tl, 100)).toBe(tl[1]);
    expect(activeMouthEvent(tl, 200)).toBe(tl[2]);
  });

  it('returns the last event whose timeMs <= t between events', () => {
    const tl = [ev(0, 5), ev(100, 6), ev(200, 7)];
    expect(activeMouthEvent(tl, 50)).toBe(tl[0]);
    expect(activeMouthEvent(tl, 150)).toBe(tl[1]);
    expect(activeMouthEvent(tl, 199)).toBe(tl[1]);
  });

  it('holds the final event for t past the end', () => {
    const tl = [ev(0, 5), ev(100, 6)];
    expect(activeMouthEvent(tl, 1000)).toBe(tl[1]);
  });
});

describe('interpolatedShape', () => {
  it('returns null for an empty timeline and before the first event', () => {
    expect(interpolatedShape([], 0)).toBeNull();
    expect(interpolatedShape([], 1000)).toBeNull();
    const tl = [ev(100, 10), ev(200, 20)];
    expect(interpolatedShape(tl, 0)).toBeNull();
    expect(interpolatedShape(tl, 99)).toBeNull();
  });

  it('returns the exact shape at each event boundary', () => {
    const tl = [ev(0, 0), ev(100, 100), ev(200, 40)];
    expect(interpolatedShape(tl, 0)).toBe(0);
    expect(interpolatedShape(tl, 100)).toBe(100);
    expect(interpolatedShape(tl, 200)).toBe(40);
  });

  it('linearly interpolates between two bracketing events', () => {
    const tl = [ev(0, 0), ev(100, 100)];
    expect(interpolatedShape(tl, 25)).toBe(25);
    expect(interpolatedShape(tl, 50)).toBe(50);
    expect(interpolatedShape(tl, 75)).toBe(75);
    // A non-trivial range (the interim's whole point: motion between sparse anchors).
    const sparse = [ev(0, 20), ev(2000, 60)];
    expect(interpolatedShape(sparse, 1000)).toBe(40);
    expect(interpolatedShape(sparse, 500)).toBe(30);
  });

  it('holds the final event shape after the end (and for a single-event timeline)', () => {
    const tl = [ev(0, 5), ev(100, 90)];
    expect(interpolatedShape(tl, 1000)).toBe(90);
    const one = [ev(50, 33)];
    expect(interpolatedShape(one, 49)).toBeNull(); // before it
    expect(interpolatedShape(one, 50)).toBe(33);
    expect(interpolatedShape(one, 5000)).toBe(33); // hold
  });

  it('changes continuously across a sparse 2-point timeline (no static hold mid-span)', () => {
    const tl = [ev(0, 0), ev(1000, 160)];
    const a = interpolatedShape(tl, 100);
    const b = interpolatedShape(tl, 200);
    const c = interpolatedShape(tl, 300);
    expect(a).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
    expect(c!).toBeGreaterThan(b!);
  });
});

describe('chooseOverlay', () => {
  it('returns null when the frame has no overlays', () => {
    expect(chooseOverlay(0, [])).toBeNull();
    expect(chooseOverlay(80, [])).toBeNull();
    expect(chooseOverlay(SHAPE_MAX, [])).toBeNull();
  });

  it('returns the only overlay regardless of shape', () => {
    const only = overlay(7, 42);
    expect(chooseOverlay(0, [only])).toBe(only);
    expect(chooseOverlay(80, [only])).toBe(only);
    expect(chooseOverlay(SHAPE_MAX, [only])).toBe(only);
    expect(chooseOverlay(SHAPE_MAX + 999, [only])).toBe(only);
  });

  it('maps shape 0 to the lowest-type overlay and a max shape to the highest-type', () => {
    // Pass overlays out of order to prove it sorts by `type` (closed -> open).
    const high = overlay(9, 200);
    const low = overlay(0, 100);
    const mid = overlay(5, 150);
    const overlays = [high, low, mid];

    expect(chooseOverlay(0, overlays)).toBe(low);
    expect(chooseOverlay(SHAPE_MAX, overlays)).toBe(high);
    expect(chooseOverlay(SHAPE_MAX + 1000, overlays)).toBe(high); // clamps above max
    expect(chooseOverlay(-50, overlays)).toBe(low); // clamps below 0
  });

  it('picks a strictly middle overlay for a mid shape (a documented endpoint property)', () => {
    const low = overlay(0, 100);
    const mid = overlay(5, 150);
    const high = overlay(9, 200);
    const overlays = [low, mid, high];

    const chosen = chooseOverlay(Math.floor(SHAPE_MAX / 2), overlays);
    expect(chosen).toBe(mid);
  });

  it('is monotonic non-decreasing in shape over the sorted overlays', () => {
    const overlays = [overlay(0, 10), overlay(3, 20), overlay(6, 30), overlay(9, 40)];
    const ordered = [...overlays].sort((a, b) => a.type - b.type);
    const rank = new Map(ordered.map((o, i) => [o.imageIndex, i]));

    let prev = -1;
    for (let shape = 0; shape <= SHAPE_MAX; shape += 5) {
      const chosen = chooseOverlay(shape, overlays);
      expect(chosen).not.toBeNull();
      const r = rank.get(chosen!.imageIndex)!;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});
