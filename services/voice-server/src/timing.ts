// Cycle 10 — parse the bridge's per-stage timing line so the server can log a combined
// latency breakdown per /tts request. The bridge (sapi4-mouth.cpp) prints ONE line to
// stderr of the form:
//   [timing] initMs=12 passA_ttfbMs=80 passA_totalMs=1840 passB_ttfbMs=15 passB_totalMs=420 writeMs=1 totalMs=2290
// where passA (CLSID_MMAudioDest, real-time) ≈ utterance length (the inherent floor) and
// passB (CLSID_AudioDestFile) is the serial overhead on top. Pure + unit-tested (no Wine).

/** Per-stage timings emitted by the SAPI4 bridge, in milliseconds. */
export interface BridgeTiming {
  /** Engine init: process start → CoInitialize + voice-mode resolve (per-request COM cost). */
  initMs: number;
  /** Pass A (real-time MMAudioDest): synth start → AudioStart (first audio). */
  passATtfbMs: number;
  /** Pass A total ≈ utterance length — the inherent real-time floor. */
  passATotalMs: number;
  /** Pass B (file AudioDestFile): synth start → AudioStart. */
  passBTtfbMs: number;
  /** Pass B total — serial overhead on top of the floor (candidate future saving). */
  passBTotalMs: number;
  /** Timeline JSON write. */
  writeMs: number;
  /** Whole bridge process, start → exit. */
  totalMs: number;
}

// stderr key (snake) → BridgeTiming field (camel). All are required; a line missing any
// is treated as unparseable (returns null) rather than silently zero-filling.
const FIELDS: ReadonlyArray<readonly [string, keyof BridgeTiming]> = [
  ['initMs', 'initMs'],
  ['passA_ttfbMs', 'passATtfbMs'],
  ['passA_totalMs', 'passATotalMs'],
  ['passB_ttfbMs', 'passBTtfbMs'],
  ['passB_totalMs', 'passBTotalMs'],
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
  /** Reading the WAV + timeline files the bridge wrote. */
  readMs: number;
  /** base64-encoding the WAV for the JSON response. */
  encodeMs: number;
  /** Whole /tts handler, request → response. */
  totalMs: number;
  /** Per-stage bridge breakdown parsed from stderr, or null if absent/garbled. */
  bridge: BridgeTiming | null;
}

/** One-line human-readable breakdown for the per-request server log. */
export function formatTtsTiming(t: TtsTiming): string {
  const b = t.bridge;
  const bridgePart = b
    ? `bridge[init=${b.initMs} passA=${b.passATotalMs}(ttfb ${b.passATtfbMs}) ` +
      `passB=${b.passBTotalMs}(ttfb ${b.passBTtfbMs}) write=${b.writeMs} total=${b.totalMs}]`
    : 'bridge[timing unavailable]';
  return (
    `total=${t.totalMs}ms (bridgeWall=${t.bridgeMs} read=${t.readMs} encode=${t.encodeMs}) ` +
    bridgePart
  );
}
