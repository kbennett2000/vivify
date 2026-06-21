// Cycle 11 acceptance (docs/cycles/cycle-11-latency-singlepass.md → "What is
// verified where", CI bullet): the timing parse/format that backs the per-request
// `[tts-timing]` breakdown. Pure-function tests — no Wine, no child process. The
// bridge is now single-pass: the `[timing]` line drops `passB_*`, and TtsTiming
// carries server stages {bridgeMs, wineLoadMs, captureMs, encodeMs} + the parsed
// bridge. The server-side end-to-end (fake bridge emits the line → onTiming) lives
// in server.test.ts.

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
      '[boot] bridge up',
      '[mmaudio] events=412 spanMs=1840 qTimeStamp=[0..1840] AudioStart=80',
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 writeMs=1 totalMs=2290',
      'ok: wrote out.json',
    ].join('\n');

    const expected: BridgeTiming = {
      initMs: 12,
      passATtfbMs: 80,
      passATotalMs: 1840,
      writeMs: 1,
      totalMs: 2290,
    };
    expect(parseBridgeTiming(stderr)).toEqual(expected);
  });

  it('extracts standalone totalMs, not a substring of passA_totalMs', () => {
    // The two "*total*" values are deliberately different so a sloppy regex that
    // matched `totalMs=` inside `passA_totalMs=` would pick the wrong number.
    const stderr = '[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=1111 writeMs=1 totalMs=3333';
    const t = parseBridgeTiming(stderr);
    expect(t).not.toBeNull();
    expect(t?.passATotalMs).toBe(1111);
    expect(t?.totalMs).toBe(3333);
    // And the two really are distinct (guards against one aliasing the other).
    expect(new Set([t?.passATotalMs, t?.totalMs]).size).toBe(2);
  });

  it('returns null when there is no [timing] line at all', () => {
    const stderr = ['[mmaudio] events=412 spanMs=1840', 'ok: wrote out.json'].join('\n');
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('returns null when the [timing] line is missing a field (no writeMs)', () => {
    const stderr = '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 totalMs=2290';
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('returns null when a field is non-numeric', () => {
    const stderr = '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=NaN writeMs=1 totalMs=2290';
    expect(parseBridgeTiming(stderr)).toBeNull();
  });

  it('uses the LAST [timing] line when several are present', () => {
    const stderr = [
      '[timing] initMs=99 passA_ttfbMs=99 passA_totalMs=99 writeMs=99 totalMs=99',
      '[mmaudio] events=412',
      '[timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 writeMs=1 totalMs=2290',
    ].join('\n');

    const t = parseBridgeTiming(stderr);
    expect(t).toEqual({
      initMs: 12,
      passATtfbMs: 80,
      passATotalMs: 1840,
      writeMs: 1,
      totalMs: 2290,
    });
  });
});

describe('formatTtsTiming', () => {
  it('includes the parsed bridge stages, server stages, total, and computed teardown', () => {
    const t: TtsTiming = {
      bridgeMs: 2300,
      wineLoadMs: 200,
      captureReadyMs: 45,
      captureMs: 2100,
      captureStopMs: 3,
      buildMs: 4,
      encodeMs: 2,
      totalMs: 2310,
      bridge: {
        initMs: 12,
        passATtfbMs: 80,
        passATotalMs: 1840,
        writeMs: 1,
        totalMs: 2000,
      },
    };
    const out = formatTtsTiming(t);

    // Grand total.
    expect(out).toContain('total=2310ms');
    // Server stages (Cycle 11 fix adds the capture-readiness gate; the follow-up adds
    // captureStop — stopCapture duration — and build — wrap+trim).
    expect(out).toContain('captureReady=45');
    expect(out).toContain('bridgeWall=2300');
    expect(out).toContain('wineLoad=200');
    expect(out).toContain('capture=2100');
    expect(out).toContain('captureStop=3');
    expect(out).toContain('build=4');
    expect(out).toContain('encode=2');
    // teardown = max(0, bridgeMs − wineLoadMs − bridge.totalMs) = 2300 − 200 − 2000 = 100.
    expect(out).toContain('teardown=100');
    // Bridge breakdown (each stage's number, plus ttfb annotation).
    expect(out).toContain('init=12');
    expect(out).toContain('passA=1840(ttfb 80)');
    expect(out).toContain('write=1');
    expect(out).toContain('self=2000]');
  });

  it('clamps teardown at 0 when the bridge self-time exceeds the observed wall time', () => {
    const t: TtsTiming = {
      bridgeMs: 1000,
      wineLoadMs: 100,
      captureReadyMs: 30,
      captureMs: 900,
      captureStopMs: 2,
      buildMs: 3,
      encodeMs: 1,
      totalMs: 1010,
      bridge: {
        initMs: 5,
        passATtfbMs: 10,
        passATotalMs: 1840,
        writeMs: 1,
        totalMs: 2000, // > bridgeMs − wineLoadMs → teardown would be negative
      },
    };
    // max(0, 1000 − 100 − 2000) = 0.
    expect(formatTtsTiming(t)).toContain('teardown=0');
  });

  it('reports "timing unavailable" but still wineLoad + server stages + total when bridge is null', () => {
    const t: TtsTiming = {
      bridgeMs: 2300,
      wineLoadMs: 200,
      captureReadyMs: 45,
      captureMs: 2100,
      captureStopMs: 3,
      buildMs: 4,
      encodeMs: 2,
      totalMs: 2310,
      bridge: null,
    };
    const out = formatTtsTiming(t);
    expect(out).toContain('bridge[timing unavailable]');
    expect(out).toContain('total=2310ms');
    expect(out).toContain('captureReady=45');
    expect(out).toContain('bridgeWall=2300');
    expect(out).toContain('wineLoad=200');
    expect(out).toContain('capture=2100');
    expect(out).toContain('captureStop=3');
    expect(out).toContain('build=4');
    expect(out).toContain('encode=2');
    // No teardown when there's no bridge self-time to subtract.
    expect(out).not.toContain('teardown=');
  });
});
