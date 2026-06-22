// Cycle 10/11 — parse the bridge's per-stage timing line so the server can log a combined
// latency breakdown per /tts request. The bridge (sapi4-mouth.cpp) prints ONE line to
// stderr of the form (Cycle 11, single-pass — passB_* removed):
//   [timing] initMs=12 passA_ttfbMs=80 passA_totalMs=2900 writeMs=1 totalMs=2920
// passA (CLSID_MMAudioDest, real-time) ≈ utterance length — the inherent lip-sync floor.
// Pure + unit-tested (no Wine).

/** Per-stage timings emitted by the SAPI4 bridge, in milliseconds. */
export interface BridgeTiming {
  /** Engine init: process start → CoInitialize + voice-mode resolve (per-request COM cost). */
  initMs: number;
  /** Pass A (real-time MMAudioDest): synth start → AudioStart (first audio). */
  passATtfbMs: number;
  /** Pass A total ≈ utterance length — the inherent real-time floor. */
  passATotalMs: number;
  /** Timeline JSON write. */
  writeMs: number;
  /** Bridge self-time: first statement of main() → the timing print (before fast _Exit). */
  totalMs: number;
}

// stderr key (snake) → BridgeTiming field (camel). All are required; a line missing any
// is treated as unparseable (returns null) rather than silently zero-filling.
const FIELDS: ReadonlyArray<readonly [string, keyof BridgeTiming]> = [
  ['initMs', 'initMs'],
  ['passA_ttfbMs', 'passATtfbMs'],
  ['passA_totalMs', 'passATotalMs'],
  ['writeMs', 'writeMs'],
  ['totalMs', 'totalMs'],
];

/**
 * Parse the bridge's `[timing] …` line out of captured stderr. Returns the timings, or
 * `null` if there's no `[timing]` line or any expected field is absent/non-numeric. If
 * several lines are present (e.g. a warmup + the real pass), the LAST one wins.
 */
export function parseBridgeTiming(stderr: string): BridgeTiming | null {
  const lines = stderr.split(/\r?\n/).filter((l) => l.includes('[timing]'));
  const line = lines[lines.length - 1];
  if (!line) return null;

  const out = {} as Record<keyof BridgeTiming, number>;
  for (const [key, field] of FIELDS) {
    // Word-boundary so `passA_totalMs` can't be matched by a `totalMs` lookup, etc.
    const m = new RegExp(`(?:^|\\s)${key}=(\\d+)(?:\\s|$)`).exec(line);
    if (!m) return null;
    out[field] = Number(m[1]);
  }
  return out as BridgeTiming;
}

/** Server-side + parsed-bridge timings for one /tts request (milliseconds). */
export interface TtsTiming {
  /** Server-observed bridge child wall time (spawn → close). */
  bridgeMs: number;
  /**
   * Wine process-load prologue: spawn → the child's first stderr byte (its `[boot]` line),
   * which is emitted as main()'s first statement. The residual structural cost (Cycle 11
   * WIN 2) a persistent-engine daemon would remove.
   */
  wineLoadMs: number;
  /**
   * Capture window first-byte latency (Cycle 11 persistent source): beginWindow → first buffered
   * chunk from the always-on monitor reader. Replaces the old per-request `captureReadyMs` — it's
   * now consistently ~tens of ms (no per-request `parec` spawn), which is the variance fix.
   */
  windowFirstByteMs: number;
  /** Building the WAV from captured PCM: wrap + trim leading silence (base64 is `encode`). */
  buildMs: number;
  /** Building the WAV from captured PCM (wrap + trim) + base64 encode for the response. */
  encodeMs: number;
  /** Whole /tts handler, request → response. */
  totalMs: number;
  /** Per-stage bridge breakdown parsed from stderr, or null if absent/garbled. */
  bridge: BridgeTiming | null;
  /**
   * Cycle 12: cache outcome for this request. `'hit'` = served from disk (no synthesis;
   * `bridge` is null and the synth stages are 0); `'miss'` = synthesized then cached;
   * undefined = caching disabled (no cache dir configured). Lets the operator SEE the speedup.
   */
  cache?: 'hit' | 'miss';
  /** Cycle 12 (hit only): time to read the cached payload off disk, ms — expected tens of ms. */
  diskReadMs?: number;
}

/**
 * One-line human-readable breakdown for the per-request server log. Splits the old
 * unexplained gap into load / self / teardown: teardown ≈ bridgeWall − wineLoad − bridge.total
 * (the COM/DLL/device teardown that the bridge's fast `_Exit` is meant to skip).
 */
export function formatTtsTiming(t: TtsTiming): string {
  // Cycle 12: a cache HIT skips synthesis entirely — render just the disk read + total so the
  // speedup is obvious at a glance (no bridge/window stages to report).
  if (t.cache === 'hit') {
    return `cache=HIT total=${t.totalMs}ms (diskRead=${t.diskReadMs ?? 0})`;
  }
  const b = t.bridge;
  const cachePart = t.cache === 'miss' ? ' cache=miss' : '';
  const teardownMs = b ? Math.max(0, t.bridgeMs - t.wineLoadMs - b.totalMs) : null;
  const bridgePart = b
    ? `bridge[init=${b.initMs} passA=${b.passATotalMs}(ttfb ${b.passATtfbMs}) ` +
      `write=${b.writeMs} self=${b.totalMs}]`
    : 'bridge[timing unavailable]';
  const gapPart =
    teardownMs === null
      ? `wineLoad=${t.wineLoadMs}`
      : `wineLoad=${t.wineLoadMs} teardown=${teardownMs}`;
  return (
    `total=${t.totalMs}ms (windowFirstByte=${t.windowFirstByteMs} bridgeWall=${t.bridgeMs} ${gapPart} ` +
    `build=${t.buildMs} encode=${t.encodeMs}) ` +
    bridgePart +
    cachePart
  );
}
