// Parse the SAPI4 bridge's timeline JSON into the engine-facing MouthEvent[].
// Pure + tolerant — unit-tested. The bridge emits, per SAPI4 `Visual` callback,
// an audio-relative timestamp + a viseme `shape` (with the full TTSMOUTH/phoneme
// preserved for Cycle 6); we keep only the contract fields here.

import type { MouthEvent } from '@vivify/types';

/** Shape of one entry the bridge writes (richer than MouthEvent; extra fields ignored). */
export interface BridgeMouthEvent {
  timeMs: number;
  shape: number;
  phoneme?: string;
  mouth?: Record<string, number>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Validate/normalize the bridge timeline JSON → MouthEvent[]. Returns [] on anything malformed. */
export function parseTimeline(raw: unknown): MouthEvent[] {
  const root = asRecord(raw);
  const events = root?.events;
  if (!Array.isArray(events)) return [];
  const out: MouthEvent[] = [];
  for (const entry of events) {
    const record = asRecord(entry);
    if (!record) continue;
    const timeMs = record.timeMs;
    const shape = record.shape;
    if (
      typeof timeMs === 'number' &&
      Number.isFinite(timeMs) &&
      typeof shape === 'number' &&
      Number.isFinite(shape)
    ) {
      out.push({ timeMs, shape });
    }
  }
  return out;
}
