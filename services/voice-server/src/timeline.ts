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
  mouth?: { height?: number; width?: number; upturn?: number };
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
    // Mouth WIDTH lives under the bridge's nested `mouth.width`; carry it for the
    // authentic VoiceMouthOverlay(height,width) mapping (height == top-level `shape`).
    const mouth = asRecord(record.mouth);
    const width = mouth?.width;
    if (
      typeof timeMs === 'number' &&
      Number.isFinite(timeMs) &&
      typeof shape === 'number' &&
      Number.isFinite(shape)
    ) {
      const event: MouthEvent = { timeMs, shape };
      if (typeof width === 'number' && Number.isFinite(width)) event.width = width;
      out.push(event);
    }
  }
  return out;
}
