// Pure lip-sync mapping helpers (no DOM) — unit-tested in isolation.
//
// Joins the voice timeline (MouthEvent {timeMs, shape=height, width?}) to a frame's
// mouth overlays. The authentic mapping is DoubleAgent's VoiceMouthOverlay decision
// tree (oracle Core/Sapi4Voice.cpp): SAPI4 TTSMOUTH height+width → one of the seven
// AgentMouthOverlay types (Core/AgentFileParts.h). The engine then composites the
// frame overlay whose `type` equals that value (oracle Core/AgentFile.cpp). See
// ADR-0018. We interpolate height+width between sparse anchors so the mouth moves.

import type { FrameMouthOverlay, MouthEvent } from '@vivify/types';

/** AgentMouthOverlay enum (oracle AgentFileParts.h:94-105). */
export const MouthOverlayType = {
  Closed: 0,
  Wide1: 1,
  Wide2: 2,
  Wide3: 3,
  Wide4: 4,
  Medium: 5,
  Narrow: 6,
} as const;

/**
 * Assumed mouth width when the timeline carries none (fallback providers). Picked so
 * VoiceMouthOverlay degrades to its height-only branches (Closed/Wide1/Medium/Wide4)
 * rather than misfiring to Narrow (width <= 40).
 */
export const DEFAULT_MOUTH_WIDTH = 100;

/**
 * Map a SAPI4 mouth height+width to an AgentMouthOverlay type (0-6), verbatim from
 * DoubleAgent's VoiceMouthOverlay (oracle Core/Sapi4Voice.cpp:1136-1186). `width`
 * defaults to DEFAULT_MOUTH_WIDTH when absent.
 */
export function voiceMouthOverlayType(height: number, width: number = DEFAULT_MOUTH_WIDTH): number {
  if (height <= 20) return MouthOverlayType.Closed;
  if (width <= 40) return MouthOverlayType.Narrow;
  if (width >= 60 && height >= 120) return MouthOverlayType.Wide4;
  if (width >= 160 && height >= 60) return MouthOverlayType.Wide3;
  if (width >= 130 && height >= 40) return MouthOverlayType.Wide2;
  if (height <= 90) return MouthOverlayType.Wide1;
  return MouthOverlayType.Medium;
}

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
 * Linearly interpolate the mouth height+width at `tMs` between the two timeline events
 * that bracket it. Returns null before the first event (closed mouth) and holds the
 * last event's values after the final event. This gives a MOVING mouth when the voice
 * server emits sparse anchors — it morphs smoothly between them (ADR-0017 interim).
 * Returns CONTINUOUS floats; `voiceMouthOverlayType` quantizes them to a type.
 */
export function interpolatedMouth(
  timeline: readonly MouthEvent[],
  tMs: number,
): { height: number; width: number } | null {
  const i = lastIndexAtOrBefore(timeline, tMs);
  if (i < 0) return null;
  const prev = timeline[i]!;
  const prevW = prev.width ?? DEFAULT_MOUTH_WIDTH;
  const next = timeline[i + 1];
  if (!next) return { height: prev.shape, width: prevW }; // after the last event: hold
  const span = next.timeMs - prev.timeMs;
  const nextW = next.width ?? DEFAULT_MOUTH_WIDTH;
  if (span <= 0) return { height: next.shape, width: nextW }; // coincident: snap to later
  const frac = (tMs - prev.timeMs) / span;
  return {
    height: prev.shape + (next.shape - prev.shape) * frac,
    width: prevW + (nextW - prevW) * frac,
  };
}

/**
 * Height-only convenience retained for callers/tests that only need the interpolated
 * mouth height. Delegates to `interpolatedMouth`.
 */
export function interpolatedShape(timeline: readonly MouthEvent[], tMs: number): number | null {
  return interpolatedMouth(timeline, tMs)?.height ?? null;
}

/**
 * The overlay on this frame whose `type` equals the requested AgentMouthOverlay type.
 * Falls back to the nearest available type (by numeric distance) when the frame lacks
 * the exact one, and null when the frame has no overlays. NOTE: the fallback is a
 * should-not-happen safety net — authentic characters (e.g. Genie) carry all 7 types,
 * so the exact match hits. Numeric nearness is NOT a visual-openness ordering (the type
 * enum isn't ordinal), so on a partial-overlay frame the fallback can pick a visually
 * wrong shape; that only occurs for non-authored/partial characters.
 */
export function overlayForType(
  type: number,
  overlays: readonly FrameMouthOverlay[],
): FrameMouthOverlay | null {
  if (overlays.length === 0) return null;
  let best = overlays[0]!;
  let bestDist = Math.abs(best.type - type);
  for (const o of overlays) {
    if (o.type === type) return o;
    const dist = Math.abs(o.type - type);
    if (dist < bestDist) {
      best = o;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Choose the mouth overlay for a SAPI4 mouth height+width from a frame's overlays:
 * map to an AgentMouthOverlay type (VoiceMouthOverlay) then select that overlay.
 * Returns null when the frame has no overlays.
 */
export function chooseOverlay(
  height: number,
  width: number | undefined,
  overlays: readonly FrameMouthOverlay[],
): FrameMouthOverlay | null {
  if (overlays.length === 0) return null;
  return overlayForType(voiceMouthOverlayType(height, width), overlays);
}
