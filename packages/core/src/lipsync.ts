// Pure lip-sync mapping helpers (no DOM) — unit-tested in isolation.
//
// Joins the voice timeline (MouthEvent {timeMs, shape}) to a Speaking frame's
// mouth overlays. `shape` is the SAPI4 TTSMOUTH mouth-height (ADR-0015): a
// roughly 0..160 "openness" scale. We treat a frame's overlays as ordered
// closed→open (by their `type` id) and quantize the openness into that set.
// The mapping is deliberately simple + tunable; it is calibrated visually
// against real characters (ADR-0016) and may be refined.

import type { FrameMouthOverlay, MouthEvent } from '@vivify/types';

/** Upper bound of the SAPI4 mouth-height scale used for quantization. */
export const SHAPE_MAX = 160;

/**
 * The active mouth event at time `tMs`: the last event whose timeMs <= tMs.
 * Returns null before the first event (or for an empty timeline). Assumes the
 * timeline is sorted by timeMs (the voice server emits it in order).
 */
export function activeMouthEvent(timeline: readonly MouthEvent[], tMs: number): MouthEvent | null {
  const idx = lastIndexAtOrBefore(timeline, tMs);
  return idx >= 0 ? timeline[idx]! : null;
}

/** Index of the last event whose timeMs <= tMs, or -1 if none. Binary search; assumes sorted. */
function lastIndexAtOrBefore(timeline: readonly MouthEvent[], tMs: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]!.timeMs <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Linearly interpolate the mouth `shape` at `tMs` between the two timeline events
 * that bracket it. Returns null before the first event (closed mouth) and holds the
 * last event's shape after the final event. This is the Cycle 6 interim that gives a
 * MOVING mouth when the voice server emits sparse anchors (~1 event/2s) — it morphs
 * smoothly between them rather than holding one pose. It is NOT per-phoneme-accurate
 * lip-sync; with dense (per-phoneme) anchors it degrades to near-inert smoothing.
 * The authentic dense-event fix is the real-time-audio bridge (ADR-0017 / Cycle 7).
 * Returns a CONTINUOUS float (not a quantized SAPI4 height); `chooseOverlay` floors it.
 */
export function interpolatedShape(timeline: readonly MouthEvent[], tMs: number): number | null {
  const i = lastIndexAtOrBefore(timeline, tMs);
  if (i < 0) return null;
  const prev = timeline[i]!;
  const next = timeline[i + 1];
  if (!next) return prev.shape; // after the last event: hold
  const span = next.timeMs - prev.timeMs;
  if (span <= 0) return next.shape; // coincident/out-of-order anchors: snap to the later one
  const frac = (tMs - prev.timeMs) / span;
  return prev.shape + (next.shape - prev.shape) * frac;
}

/**
 * Choose a mouth overlay for a viseme `shape` from a frame's overlays. Overlays
 * are ordered by their `type` id (closed→open) and the clamped openness is
 * quantized across them. Returns null when the frame has no overlays.
 */
export function chooseOverlay(
  shape: number,
  overlays: readonly FrameMouthOverlay[],
): FrameMouthOverlay | null {
  if (overlays.length === 0) return null;
  if (overlays.length === 1) return overlays[0]!;
  const ordered = [...overlays].sort((a, b) => a.type - b.type);
  const clamped = Math.max(0, Math.min(SHAPE_MAX, shape));
  const idx = Math.min(ordered.length - 1, Math.floor((clamped / SHAPE_MAX) * ordered.length));
  return ordered[idx]!;
}
