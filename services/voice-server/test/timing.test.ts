// Cycle 10 acceptance (docs/cycles/cycle-10-latency.md → "What is verified where",
// CI bullet): "`parseBridgeTiming` unit tests (valid line → struct; missing/garbled
// → null; tolerant of extra fields)". These are pure-function tests — no Wine, no
// child process. The server-side end-to-end (fake bridge emits a `[timing]` line →
// `onTiming` receives the parsed stages) lives in server.test.ts.

import { describe, it, expect } from 'vitest';
import {
  parseBridgeTiming,
  formatTtsTiming,
  type BridgeTiming,
  type TtsTiming,
} from '../src/timing.js';

describe('parseBridgeTiming', () => {
  it('extracts every field from a valid [timing] line embedded in multi-line stderr', () => {
    const stderr = [
      '[mmaudio] events=412 spanMs=1840 qTimeStamp=[0..1840] AudioStart=80',
      '[file-wav] events=0 spanMs=420',
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 passB_ttfbMs=15 passB_totalMs=420 writeMs=1 totalMs=2290',
      'ok: wrote out.wav (40500 bytes) + out.json',
    ].join('\n');

    const expected: BridgeTiming = {
      initMs: 12,
      passATtfbMs: 80,
      passATotalMs: 1840,
      passBTtfbMs: 15,
      passBTotalMs: 420,
      writeMs: 1,
      totalMs: 2290,
    };
    expect(parseBridgeTiming(stderr)).toEqual(expected);
  });

  it('extracts standalone totalMs, not a substring of passA_totalMs / passB_totalMs', () => {
    // The three "*total*" values are deliberately all different so a sloppy regex that
    // matched `totalMs=` inside `passA_totalMs=` would pick the wrong number.
    const stderr =
      '[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=1111 passB_ttfbMs=4 passB_totalMs=2222 writeMs=1 totalMs=3333';
    const t = parseBridgeTiming(stderr);
    expect(t).not.toBeNull();
    expect(t?.passATotalMs).toBe(1111);
    expect(t?.passBTotalMs).toBe(2222);
    expect(t?.totalMs).toBe(3333);
    // And the three really are distinct (guards against any one accidentally aliasing another).
    expect(new Set([t?.passATotalMs, t?.passBTotalMs, t?.totalMs]).size).toBe(3);
  });

  it('returns null when there is no [timing] line at all', () => {
    const stderr = ['[mmaudio] events=412 spanMs=1840', 'ok: wrote out.wav'].join('\n');
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('returns null when the [timing] line is missing a field (no writeMs)', () => {
    const stderr =
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 passB_ttfbMs=15 passB_totalMs=420 totalMs=2290';
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('returns null when a field is non-numeric', () => {
    const stderr =
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=NaN passB_ttfbMs=15 passB_totalMs=420 writeMs=1 totalMs=2290';
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('uses the LAST [timing] line when several are present', () => {
    const stderr = [
      '[timing] initMs=99 passA_ttfbMs=99 passA_totalMs=99 passB_ttfbMs=99 passB_totalMs=99 writeMs=99 totalMs=99',
      '[mmaudio] events=412',
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 passB_ttfbMs=15 passB_totalMs=420 writeMs=1 totalMs=2290',
    ].join('\n');

    const t = parseBridgeTiming(stderr);
    expect(t).toEqual({
      initMs: 12,
      passATtfbMs: 80,
      passATotalMs: 1840,
      passBTtfbMs: 15,
      passBTotalMs: 420,
      writeMs: 1,
      totalMs: 2290,
    });
  });
});

describe('formatTtsTiming', () => {
  it('includes the parsed bridge stages and the grand total when bridge is present', () => {
    const t: TtsTiming = {
      bridgeMs: 2300,
      readMs: 4,
      encodeMs: 2,
      totalMs: 2310,
      bridge: {
        initMs: 12,
        passATtfbMs: 80,
        passATotalMs: 1840,
        passBTtfbMs: 15,
        passBTotalMs: 420,
        writeMs: 1,
        totalMs: 2290,
      },
    };
    const out = formatTtsTiming(t);
    // Grand total.
    expect(out).toContain('total=2310ms');
    // Server stages.
    expect(out).toContain('bridgeWall=2300');
    expect(out).toContain('read=4');
    expect(out).toContain('encode=2');
    // Bridge breakdown (each stage's number, plus ttfb annotations).
    expect(out).toContain('init=12');
    expect(out).toContain('passA=1840(ttfb 80)');
    expect(out).toContain('passB=420(ttfb 15)');
    expect(out).toContain('write=1');
    expect(out).toContain('total=2290]');
  });

  it('reports "timing unavailable" but still the server stages + total when bridge is null', () => {
    const t: TtsTiming = {
      bridgeMs: 2300,
      readMs: 4,
      encodeMs: 2,
      totalMs: 2310,
      bridge: null,
    };
    const out = formatTtsTiming(t);
    expect(out).toContain('timing unavailable');
    expect(out).toContain('total=2310ms');
    expect(out).toContain('bridgeWall=2300');
    expect(out).toContain('read=4');
    expect(out).toContain('encode=2');
  });
});
