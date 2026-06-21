// Cycle 6 (docs/cycles/cycle-6-lipsync.md). Pure mapping logic, no DOM, no audio.
// The authentic mapping is DoubleAgent's VoiceMouthOverlay decision tree (oracle
// Core/Sapi4Voice.cpp): SAPI4 mouth HEIGHT+WIDTH → one of seven AgentMouthOverlay
// types; the engine then composites the frame overlay whose `type` equals it.
// We assert that documented tree branch-by-branch (IF-order matters: earlier
// branches win) plus the interpolation/selection contract.

import { describe, it, expect } from 'vitest';
import type { FrameMouthOverlay, MouthEvent } from '@vivify/types';
import {
  activeMouthEvent,
  chooseOverlay,
  interpolatedMouth,
  interpolatedShape,
  overlayForType,
  voiceMouthOverlayType,
  MouthOverlayType,
  DEFAULT_MOUTH_WIDTH,
} from '../src/lipsync.js';

const ev = (timeMs: number, shape: number, width?: number): MouthEvent =>
  width === undefined ? { timeMs, shape } : { timeMs, shape, width };

/** Build an overlay with a distinct `type` (selection key) + `imageIndex` (identity). */
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

describe('voiceMouthOverlayType (authentic VoiceMouthOverlay tree, IF-order)', () => {
  it('maps height <= 20 to Closed (first branch wins even at any width)', () => {
    expect(voiceMouthOverlayType(0, 100)).toBe(MouthOverlayType.Closed);
    expect(voiceMouthOverlayType(20, 100)).toBe(MouthOverlayType.Closed);
    // Closed precedes Narrow: a low+narrow mouth is Closed, not Narrow.
    expect(voiceMouthOverlayType(10, 30)).toBe(MouthOverlayType.Closed);
  });

  it('maps width <= 40 (with height > 20) to Narrow', () => {
    expect(voiceMouthOverlayType(50, 30)).toBe(MouthOverlayType.Narrow);
    expect(voiceMouthOverlayType(200, 40)).toBe(MouthOverlayType.Narrow);
  });

  it('maps width >= 60 && height >= 120 to Wide4', () => {
    expect(voiceMouthOverlayType(130, 100)).toBe(MouthOverlayType.Wide4);
    expect(voiceMouthOverlayType(120, 60)).toBe(MouthOverlayType.Wide4);
  });

  it('maps width >= 160 && height >= 60 (and height < 120) to Wide3', () => {
    // height 60 keeps it out of Wide4 (needs height >= 120) so Wide3 is reached.
    expect(voiceMouthOverlayType(60, 160)).toBe(MouthOverlayType.Wide3);
    expect(voiceMouthOverlayType(119, 200)).toBe(MouthOverlayType.Wide3);
  });

  it('maps width >= 130 && height >= 40 (not wide enough for Wide3/4) to Wide2', () => {
    // width 130 (< 160) avoids Wide3; height 50 (< 120) avoids Wide4.
    expect(voiceMouthOverlayType(50, 130)).toBe(MouthOverlayType.Wide2);
    expect(voiceMouthOverlayType(119, 159)).toBe(MouthOverlayType.Wide2);
  });

  it('maps height <= 90 (mid width, no wide branch) to Wide1', () => {
    expect(voiceMouthOverlayType(80, 100)).toBe(MouthOverlayType.Wide1);
    expect(voiceMouthOverlayType(90, 120)).toBe(MouthOverlayType.Wide1);
  });

  it('maps height > 90 (mid width, no wide branch) to Medium', () => {
    expect(voiceMouthOverlayType(100, 100)).toBe(MouthOverlayType.Medium);
    expect(voiceMouthOverlayType(110, 120)).toBe(MouthOverlayType.Medium);
  });

  it('defaults width to DEFAULT_MOUTH_WIDTH (100) when omitted', () => {
    expect(DEFAULT_MOUTH_WIDTH).toBe(100);
    // height 80 with the default width 100 -> Wide1 (height-only branch).
    expect(voiceMouthOverlayType(80)).toBe(MouthOverlayType.Wide1);
    expect(voiceMouthOverlayType(80)).toBe(voiceMouthOverlayType(80, DEFAULT_MOUTH_WIDTH));
    // height 100 with the default width 100 -> Medium.
    expect(voiceMouthOverlayType(100)).toBe(MouthOverlayType.Medium);
    // The default (100) is NOT <= 40, so it never misfires to Narrow.
    expect(voiceMouthOverlayType(100)).not.toBe(MouthOverlayType.Narrow);
  });
});

describe('overlayForType', () => {
  it('returns null when the frame has no overlays', () => {
    expect(overlayForType(0, [])).toBeNull();
    expect(overlayForType(4, [])).toBeNull();
  });

  it('returns the overlay whose type matches exactly', () => {
    const closed = overlay(MouthOverlayType.Closed, 100);
    const wide4 = overlay(MouthOverlayType.Wide4, 200);
    const medium = overlay(MouthOverlayType.Medium, 150);
    const overlays = [wide4, closed, medium];
    expect(overlayForType(MouthOverlayType.Closed, overlays)).toBe(closed);
    expect(overlayForType(MouthOverlayType.Wide4, overlays)).toBe(wide4);
    expect(overlayForType(MouthOverlayType.Medium, overlays)).toBe(medium);
  });

  it('falls back to the nearest type by |type - target| when the exact one is missing', () => {
    const closed = overlay(0, 100); // type 0
    const wide4 = overlay(4, 200); // type 4
    const overlays = [closed, wide4];
    // target 1 -> nearest is type 0 (dist 1) over type 4 (dist 3).
    expect(overlayForType(1, overlays)).toBe(closed);
    // target 3 -> nearest is type 4 (dist 1) over type 0 (dist 3).
    expect(overlayForType(3, overlays)).toBe(wide4);
  });
});

describe('chooseOverlay (height+width -> type -> overlay)', () => {
  it('returns null when the frame has no overlays', () => {
    expect(chooseOverlay(0, 100, [])).toBeNull();
    expect(chooseOverlay(140, 100, [])).toBeNull();
    expect(chooseOverlay(80, undefined, [])).toBeNull();
  });

  it('picks the Closed overlay for a closed mouth (height 0)', () => {
    const closed = overlay(MouthOverlayType.Closed, 100);
    const wide4 = overlay(MouthOverlayType.Wide4, 200);
    const overlays = [closed, wide4];
    expect(chooseOverlay(0, 100, overlays)).toBe(closed);
  });

  it('picks the Wide4 overlay for a tall + wide mouth (height 140, width 100)', () => {
    const closed = overlay(MouthOverlayType.Closed, 100);
    const wide4 = overlay(MouthOverlayType.Wide4, 200);
    const overlays = [closed, wide4];
    // voiceMouthOverlayType(140, 100) === Wide4.
    expect(chooseOverlay(140, 100, overlays)).toBe(wide4);
  });

  it('defaults width to DEFAULT_MOUTH_WIDTH when undefined, matching the type tree', () => {
    const closed = overlay(MouthOverlayType.Closed, 100);
    const wide1 = overlay(MouthOverlayType.Wide1, 300);
    const medium = overlay(MouthOverlayType.Medium, 400);
    const overlays = [closed, wide1, medium];
    // height 80, default width 100 -> Wide1.
    expect(chooseOverlay(80, undefined, overlays)).toBe(wide1);
    // height 100, default width 100 -> Medium.
    expect(chooseOverlay(100, undefined, overlays)).toBe(medium);
  });
});

describe('interpolatedMouth', () => {
  it('returns null for an empty timeline and before the first event', () => {
    expect(interpolatedMouth([], 0)).toBeNull();
    expect(interpolatedMouth([], 1000)).toBeNull();
    const tl = [ev(100, 10, 50), ev(200, 20, 60)];
    expect(interpolatedMouth(tl, 0)).toBeNull();
    expect(interpolatedMouth(tl, 99)).toBeNull();
  });

  it('lerps BOTH height and width between two bracketing events', () => {
    const tl = [ev(0, 0, 0), ev(100, 100, 200)];
    expect(interpolatedMouth(tl, 0)).toEqual({ height: 0, width: 0 });
    expect(interpolatedMouth(tl, 50)).toEqual({ height: 50, width: 100 });
    expect(interpolatedMouth(tl, 100)).toEqual({ height: 100, width: 200 });
  });

  it('holds the final event values after the end (and for a single-event timeline)', () => {
    const tl = [ev(0, 5, 10), ev(100, 90, 150)];
    expect(interpolatedMouth(tl, 1000)).toEqual({ height: 90, width: 150 });
    const one = [ev(50, 33, 77)];
    expect(interpolatedMouth(one, 49)).toBeNull(); // before it
    expect(interpolatedMouth(one, 50)).toEqual({ height: 33, width: 77 });
    expect(interpolatedMouth(one, 5000)).toEqual({ height: 33, width: 77 }); // hold
  });

  it('treats a missing width as DEFAULT_MOUTH_WIDTH (100) at both ends of a span', () => {
    // Neither event carries a width: both contribute the default, so the width
    // stays flat at 100 across the span while the height still lerps.
    const tl = [ev(0, 0), ev(100, 100)];
    expect(interpolatedMouth(tl, 0)).toEqual({ height: 0, width: DEFAULT_MOUTH_WIDTH });
    expect(interpolatedMouth(tl, 50)).toEqual({ height: 50, width: DEFAULT_MOUTH_WIDTH });
    // Only the LATER event lacks width: it falls back to the default for the lerp.
    const mixed = [ev(0, 0, 0), ev(100, 100)];
    expect(interpolatedMouth(mixed, 50)).toEqual({ height: 50, width: DEFAULT_MOUTH_WIDTH / 2 });
  });
});

describe('interpolatedShape (height-only convenience, unchanged)', () => {
  it('returns null for an empty timeline and before the first event', () => {
    expect(interpolatedShape([], 0)).toBeNull();
    expect(interpolatedShape([], 1000)).toBeNull();
    const tl = [ev(100, 10), ev(200, 20)];
    expect(interpolatedShape(tl, 0)).toBeNull();
    expect(interpolatedShape(tl, 99)).toBeNull();
  });

  it('returns the exact height at each event boundary', () => {
    const tl = [ev(0, 0), ev(100, 100), ev(200, 40)];
    expect(interpolatedShape(tl, 0)).toBe(0);
    expect(interpolatedShape(tl, 100)).toBe(100);
    expect(interpolatedShape(tl, 200)).toBe(40);
  });

  it('linearly interpolates the height between two bracketing events', () => {
    const tl = [ev(0, 0), ev(100, 100)];
    expect(interpolatedShape(tl, 25)).toBe(25);
    expect(interpolatedShape(tl, 50)).toBe(50);
    expect(interpolatedShape(tl, 75)).toBe(75);
    const sparse = [ev(0, 20), ev(2000, 60)];
    expect(interpolatedShape(sparse, 1000)).toBe(40);
    expect(interpolatedShape(sparse, 500)).toBe(30);
  });

  it('holds the final height after the end (and for a single-event timeline)', () => {
    const tl = [ev(0, 5), ev(100, 90)];
    expect(interpolatedShape(tl, 1000)).toBe(90);
    const one = [ev(50, 33)];
    expect(interpolatedShape(one, 49)).toBeNull(); // before it
    expect(interpolatedShape(one, 50)).toBe(33);
    expect(interpolatedShape(one, 5000)).toBe(33); // hold
  });

  it('equals interpolatedMouth(...).height across a span', () => {
    const tl = [ev(0, 0, 0), ev(1000, 160, 200)];
    for (const t of [100, 200, 300, 700]) {
      expect(interpolatedShape(tl, t)).toBe(interpolatedMouth(tl, t)!.height);
    }
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
