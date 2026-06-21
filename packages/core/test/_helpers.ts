// Shared test helpers for Cycle 3 engine pure-logic tests
// (docs/cycles/cycle-3-renderer.md). Synthetic IR + a deterministic FakeClock.

import type { AnimationModel, FrameModel, FrameBranch } from '@vivify/types';
import type { Clock } from '../src/clock.js';

/**
 * Build a synthetic frame. `images: 1` → one dummy composited image;
 * `images: 0` → an empty (trailing-trimmable) frame.
 */
export function frame(
  opts: {
    images?: number;
    durationMs?: number;
    branches?: FrameBranch[];
    exitFrame?: number;
  } = {},
): FrameModel {
  const { images = 1, durationMs = 100, branches = [], exitFrame } = opts;
  const f: FrameModel = {
    images: Array.from({ length: images }, () => ({ imageIndex: 0, x: 0, y: 0 })),
    durationMs,
    branches,
  };
  if (exitFrame !== undefined) f.exitFrame = exitFrame;
  return f;
}

/** Build a synthetic animation from frames. */
export function animation(frames: FrameModel[], name = 'Test'): AnimationModel {
  return { name, transitionType: 0, frames };
}

/**
 * Deterministic clock implementing the Clock interface. `advance(ms)` fires all
 * timers whose deadline falls within the window, in time order, including
 * timers scheduled by earlier timers (chained frame scheduling).
 */
export class FakeClock implements Clock {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): number {
    const h = ++this.seq;
    this.timers.set(h, { at: this.t + ms, fn });
    return h;
  }

  clearTimeout(h: number): void {
    this.timers.delete(h);
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let h = -1;
      let best: { at: number; fn: () => void } | null = null;
      for (const [k, v] of this.timers) {
        if (v.at <= end && (best === null || v.at < best.at)) {
          best = v;
          h = k;
        }
      }
      if (!best) break;
      this.timers.delete(h);
      this.t = best.at;
      best.fn();
    }
    this.t = end;
  }
}
