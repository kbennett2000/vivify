// Animation playback — faithful to MS Agent / clippy.js Animator semantics,
// mapped to our IR (FrameModel.branches = weighted next-frame, .exitFrame =
// exit-branch return-to-rest). Pure logic driven by an injected Clock + RNG, so
// it is deterministically unit-tested with no DOM. See docs/cycles/cycle-3-renderer.md.

import type { AnimationModel, FrameModel } from '@vivify/types';
import type { Clock } from './clock.js';

/** Returns a float in [0, 1). */
export type Rng = () => number;

/**
 * The next frame index after `currentIndex`, per MS Agent rules:
 *  1. exiting + an exit branch → exitFrame (graceful return-to-rest);
 *  2. probabilistic branches → weighted pick (cumulative; fall through if none);
 *  3. otherwise the next sequential frame.
 */
export function nextFrameIndex(
  frame: FrameModel,
  currentIndex: number,
  exiting: boolean,
  rng: Rng,
): number {
  if (exiting && frame.exitFrame !== undefined) return frame.exitFrame;
  if (frame.branches.length > 0) {
    let rnd = rng() * 100;
    for (const branch of frame.branches) {
      if (rnd <= branch.probability) return branch.frameIndex;
      rnd -= branch.probability;
    }
  }
  return currentIndex + 1;
}

/** Playable length after dropping a trailing run of zero-image frames (ADR-0011). */
export function playableLength(frames: FrameModel[]): number {
  let n = frames.length;
  while (n > 0 && frames[n - 1]!.images.length === 0) n--;
  return n;
}

export interface PlaybackOptions {
  clock: Clock;
  rng?: Rng;
  onFrame: (frameIndex: number, frame: FrameModel) => void;
  onEnd?: () => void;
}

/**
 * Drives one animation over a Clock. `start()` renders frame 0 and schedules
 * subsequent frames by each frame's duration; `exit()` switches to the
 * exit-branch return path; `cancel()` hard-stops with no `onEnd`.
 */
export class Playback {
  private readonly frames: FrameModel[];
  private readonly len: number;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly onFrame: (frameIndex: number, frame: FrameModel) => void;
  private readonly onEnd: () => void;

  private index = 0;
  private exiting = false;
  private handle: number | null = null;
  private done = false;

  constructor(animation: AnimationModel, opts: PlaybackOptions) {
    this.frames = animation.frames;
    this.len = playableLength(animation.frames);
    this.clock = opts.clock;
    this.rng = opts.rng ?? Math.random;
    this.onFrame = opts.onFrame;
    this.onEnd = opts.onEnd ?? (() => {});
  }

  start(): void {
    if (this.len === 0) {
      this.finish();
      return;
    }
    this.renderAndSchedule();
  }

  /** Begin the exit-branch return-to-rest; the animation then ends gracefully. */
  exit(): void {
    this.exiting = true;
  }

  /** Hard stop: cancel pending timers and emit no `onEnd`. */
  cancel(): void {
    this.done = true;
    this.clearTimer();
  }

  private renderAndSchedule(): void {
    if (this.done) return;
    const frame = this.frames[this.index]!;
    this.onFrame(this.index, frame);

    // End once the current frame is the last playable one (matches Animator).
    if (this.index >= this.len - 1) {
      this.finish();
      return;
    }

    this.handle = this.clock.setTimeout(() => {
      this.handle = null;
      const next = nextFrameIndex(frame, this.index, this.exiting, this.rng);
      if (next < 0 || next >= this.len) {
        this.finish();
        return;
      }
      this.index = next;
      this.renderAndSchedule();
    }, frame.durationMs);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    this.onEnd();
  }

  private clearTimer(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
