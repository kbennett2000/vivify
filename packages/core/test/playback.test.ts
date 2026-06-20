// Cycle 3 — playback pure logic: nextFrameIndex, playableLength, Playback.
// Driven by a deterministic FakeClock + injected rng; no DOM, no .acs.
// See docs/cycles/cycle-3-renderer.md.

import { describe, it, expect } from 'vitest';
import { nextFrameIndex, playableLength, Playback } from '../src/playback.js';
import type { FrameBranch } from '@vivify/types';
import { frame, animation, FakeClock } from './_helpers.js';

describe('nextFrameIndex', () => {
  it('advances to the next sequential frame when there are no branches', () => {
    const f = frame({ branches: [] });
    expect(nextFrameIndex(f, 0, false, () => 0)).toBe(1);
    expect(nextFrameIndex(f, 5, false, () => 0)).toBe(6);
  });

  it('takes the exit frame when exiting and an exitFrame is set', () => {
    const f = frame({ exitFrame: 7, branches: [{ frameIndex: 2, probability: 100 }] });
    // Exit takes precedence over branches when exiting.
    expect(nextFrameIndex(f, 0, true, () => 0)).toBe(7);
  });

  it('ignores exitFrame when not exiting', () => {
    const f = frame({ exitFrame: 7 });
    expect(nextFrameIndex(f, 0, false, () => 0)).toBe(1);
  });

  it('picks a branch by cumulative weighted probability', () => {
    const branches: FrameBranch[] = [
      { frameIndex: 2, probability: 30 },
      { frameIndex: 1, probability: 30 },
    ];
    const f = frame({ branches });

    // rng 0 → rnd 0 ≤ 30 → first branch (frame 2).
    expect(nextFrameIndex(f, 0, false, () => 0)).toBe(2);
    // rng 0.5 → rnd 50, >30 so -30 = 20 ≤ 30 → second branch (frame 1).
    expect(nextFrameIndex(f, 0, false, () => 0.5)).toBe(1);
    // rng 0.99 → rnd 90 → 60 → 30, none matched → fall through to sequential.
    expect(nextFrameIndex(f, 0, false, () => 0.99)).toBe(1 /* currentIndex+1 = 0+1 */);
  });
});

describe('playableLength', () => {
  it('counts all frames when none are trailing-empty', () => {
    expect(playableLength([frame(), frame(), frame()])).toBe(3);
  });

  it('drops a trailing run of zero-image frames', () => {
    const frames = [
      frame({ images: 1 }),
      frame({ images: 1 }),
      frame({ images: 0 }),
      frame({ images: 0 }),
    ];
    expect(playableLength(frames)).toBe(2);
  });

  it('keeps interior empty frames (only the trailing run is trimmed)', () => {
    const frames = [
      frame({ images: 1 }),
      frame({ images: 0 }),
      frame({ images: 1 }),
      frame({ images: 0 }),
    ];
    expect(playableLength(frames)).toBe(3);
  });

  it('is 0 when all frames are empty', () => {
    expect(playableLength([frame({ images: 0 }), frame({ images: 0 })])).toBe(0);
  });
});

describe('Playback', () => {
  it('renders 3 sequential frames in order at the right times, then ends', () => {
    const clock = new FakeClock();
    const log: number[] = [];
    let ended = false;
    const times: number[] = [];

    const anim = animation([
      frame({ durationMs: 100 }),
      frame({ durationMs: 200 }),
      frame({ durationMs: 50 }),
    ]);

    const pb = new Playback(anim, {
      clock,
      rng: () => 0,
      onFrame: (i) => {
        log.push(i);
        times.push(clock.now());
      },
      onEnd: () => {
        ended = true;
      },
    });

    pb.start();
    expect(log).toEqual([0]);
    expect(ended).toBe(false);

    clock.advance(1000);

    expect(log).toEqual([0, 1, 2]);
    // Frame 0 at t=0, frame 1 after frame 0's 100ms, frame 2 after frame 1's 200ms.
    expect(times).toEqual([0, 100, 300]);
    expect(ended).toBe(true);
  });

  it('follows a forced weighted-branch path through the clock', () => {
    const clock = new FakeClock();
    const log: number[] = [];
    let ended = false;

    // Frame 0 branches: rng 0 → first branch (frame 2). Frame 2 is last → ends.
    const anim = animation([
      frame({
        durationMs: 100,
        branches: [
          { frameIndex: 2, probability: 50 },
          { frameIndex: 1, probability: 50 },
        ],
      }),
      frame({ durationMs: 100 }),
      frame({ durationMs: 100 }),
    ]);

    const pb = new Playback(anim, {
      clock,
      rng: () => 0, // always selects first branch → frame 2
      onFrame: (i) => log.push(i),
      onEnd: () => {
        ended = true;
      },
    });

    pb.start();
    clock.advance(1000);

    // 0 → (branch) 2, frame 2 is the last playable frame → end. Frame 1 skipped.
    expect(log).toEqual([0, 2]);
    expect(ended).toBe(true);
  });

  it('follows exitFrame after exit() and ends gracefully', () => {
    const clock = new FakeClock();
    const log: number[] = [];
    let ended = false;

    // A looping idle: frame 0 ↔ frame 1, with frame 1 carrying an exit branch
    // to frame 2 (a terminal rest frame).
    const anim = animation([
      frame({ durationMs: 100, branches: [{ frameIndex: 1, probability: 100 }] }),
      frame({ durationMs: 100, branches: [{ frameIndex: 0, probability: 100 }], exitFrame: 2 }),
      frame({ durationMs: 100 }),
    ]);

    const pb = new Playback(anim, {
      clock,
      rng: () => 0,
      onFrame: (i) => log.push(i),
      onEnd: () => {
        ended = true;
      },
    });

    pb.start();
    // 0 → 1 (one cycle), then request exit.
    clock.advance(150); // fire frame 0's timer → renders frame 1
    expect(log).toEqual([0, 1]);
    expect(ended).toBe(false);

    pb.exit();
    clock.advance(1000); // frame 1's timer now picks exitFrame (2), which is terminal

    expect(log).toEqual([0, 1, 2]);
    expect(ended).toBe(true);
  });

  it('renders only non-trailing-empty frames then ends', () => {
    const clock = new FakeClock();
    const log: number[] = [];
    let ended = false;

    const anim = animation([
      frame({ images: 1, durationMs: 100 }),
      frame({ images: 1, durationMs: 100 }),
      frame({ images: 0, durationMs: 100 }),
      frame({ images: 0, durationMs: 100 }),
    ]);

    const pb = new Playback(anim, {
      clock,
      rng: () => 0,
      onFrame: (i) => log.push(i),
      onEnd: () => {
        ended = true;
      },
    });

    pb.start();
    clock.advance(1000);

    expect(log).toEqual([0, 1]);
    expect(ended).toBe(true);
  });

  it('cancel() stops further frames and never fires onEnd', () => {
    const clock = new FakeClock();
    const log: number[] = [];
    let ended = false;

    const anim = animation([
      frame({ durationMs: 100 }),
      frame({ durationMs: 100 }),
      frame({ durationMs: 100 }),
    ]);

    const pb = new Playback(anim, {
      clock,
      rng: () => 0,
      onFrame: (i) => log.push(i),
      onEnd: () => {
        ended = true;
      },
    });

    pb.start();
    expect(log).toEqual([0]);

    pb.cancel();
    clock.advance(1000);

    expect(log).toEqual([0]); // no more frames after cancel
    expect(ended).toBe(false); // cancel does NOT fire onEnd
  });
});
