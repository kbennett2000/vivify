// Cycle 8 (docs/cycles/cycle-8-return-to-rest.md → "What is verified where" →
// "CI (this repo): ... the engine behavior via synthetic models + FakeClock + a
// fake Document — transitionType 1 renders the exit chain and ends on the rest
// frame; transitionType 0 plays the return animation; transitionType 2 adds no
// frames; a second queued play renders only after the first's return (no hard
// cut); abort during the return stops it.").
//
// All synthetic: no .acs, no real browser/canvas. The fake Document is an
// external collaborator (reused from speak-lipsync.test.ts's pattern): each
// composited frame is identified by the WIDTH of the image it draws, so the
// recorded draw sequence tells us exactly which frames rendered, in order. We
// drive everything with the FakeClock and assert the agent's REAL playback +
// return-to-rest + serial-queue behavior — we never mock the code under test.

import { describe, it, expect } from 'vitest';
import type { AnimationModel, CharacterModel, FrameModel, ImageModel } from '@vivify/types';
import { createAgentFromModel } from '../src/agent.js';
import { FakeClock } from './_helpers.js';

// --- distinct image widths so a recorded drawImage maps back to a frame role ---
const MAIN0_W = 10; // first main frame of animation A
const MAIN2_W = 11; // last main frame of animation A (carries the exit branch)
const REST_W = 12; // exit-branch terminal rest frame of A
const B_REST_W = 20; // named return animation B's (only) frame
const C_FIRST_W = 30; // first frame of animation C (the second queued action)
const T2_LAST_W = 40; // last frame of a transitionType-2 animation

function img(w: number): ImageModel {
  const h = 1;
  return { width: w, height: h, rgba: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
}

// A frame that composites exactly one image (imageIndex) plus optional exit/branch.
function fr(
  imageIndex: number,
  opts: { durationMs?: number; exitFrame?: number; branches?: FrameModel['branches'] } = {},
): FrameModel {
  const f: FrameModel = {
    images: [{ imageIndex, x: 0, y: 0 }],
    durationMs: opts.durationMs ?? 100,
    branches: opts.branches ?? [],
  };
  if (opts.exitFrame !== undefined) f.exitFrame = opts.exitFrame;
  return f;
}

// imageIndex -> width registry. The model's `images` array is indexed by
// imageIndex; each entry's width is the role marker the draw recorder reads back.
const WIDTHS = [MAIN0_W, MAIN2_W, REST_W, B_REST_W, C_FIRST_W, T2_LAST_W];
const IMG = {
  MAIN0: 0,
  MAIN2: 1,
  REST: 2,
  B_REST: 3,
  C_FIRST: 4,
  T2_LAST: 5,
} as const;

function baseModel(animations: AnimationModel[]): CharacterModel {
  return {
    info: { guid: '{return-to-rest-test}', width: 64, height: 64 },
    palette: [],
    transparentIndex: 0,
    images: WIDTHS.map(img),
    animations,
    sounds: [],
    balloon: {
      numLines: 3,
      charsPerLine: 40,
      fontName: '',
      fontHeight: 12,
      fg: [0, 0, 0],
      bg: [255, 255, 255],
      border: [0, 0, 0],
    },
    voice: {},
    states: {},
  };
}

// Animation A (transitionType 1, exit-branch): forward play branches 0 -> 2
// (frame 2 is the last playable frame, so playback ends there), then the exit
// chain follows frame 2's exitFrame to frame 1 (the terminal REST pose).
//   frame 0 (MAIN0): branch 100% -> frame 2
//   frame 1 (REST):  terminal rest pose (not visited on the forward pass)
//   frame 2 (MAIN2): last playable; exitFrame -> 1
function animExitBranch(name = 'A'): AnimationModel {
  return {
    name,
    transitionType: 1,
    frames: [
      fr(IMG.MAIN0, { branches: [{ frameIndex: 2, probability: 100 }] }),
      fr(IMG.REST),
      fr(IMG.MAIN2, { exitFrame: 1 }),
    ],
  };
}

// --- fake Document (the drawImage-recording pattern from speak-lipsync.test.ts) ---

interface DrawCall {
  w: number;
}

function makeFakeDoc(): { doc: Document; draws: DrawCall[]; mount: HTMLElement } {
  const draws: DrawCall[] = [];
  const makeCtx = (): unknown => ({
    clearRect: () => {},
    drawImage: (src: { width: number; height: number }) => {
      draws.push({ w: src.width });
    },
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: () => {},
  });

  interface FakeElement {
    style: Record<string, string>;
    textContent: string;
    ownerDocument: Document;
    children: FakeElement[];
    appendChild(child: FakeElement): void;
    remove(): void;
  }

  const makeEl = (): FakeElement => ({
    style: {},
    textContent: '',
    ownerDocument: undefined as unknown as Document,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    remove() {},
  });

  const makeCanvas = (): unknown => ({
    width: 0,
    height: 0,
    style: {},
    getContext: () => makeCtx(),
    appendChild: () => {},
    remove: () => {},
  });

  const doc = {
    createElement: (tag: string): unknown => {
      if (tag === 'canvas') return makeCanvas();
      const el = makeEl();
      el.ownerDocument = docRef;
      return el;
    },
    body: makeEl(),
  };
  const docRef = doc as unknown as Document;
  (doc.body as unknown as FakeElement).ownerDocument = docRef;

  const mount = makeEl();
  mount.ownerDocument = docRef;
  return { doc: docRef, draws, mount: mount as unknown as HTMLElement };
}

const widths = (draws: DrawCall[]): number[] => draws.map((d) => d.w);

/** Flush queued microtasks so awaited queue/playForward/returnToRest steps run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

/**
 * Advance the clock and flush microtasks repeatedly, so that timer callbacks AND
 * the awaited continuations they unblock (playForward -> returnToRest -> playIndices)
 * both make progress. A single advance+flush only crosses one async hop; the gesture
 * + return-to-rest spans several, so we iterate.
 */
async function run(clock: FakeClock, totalMs: number, stepMs = 50): Promise<void> {
  let elapsed = 0;
  await flush();
  while (elapsed < totalMs) {
    clock.advance(stepMs);
    elapsed += stepMs;
    await flush();
  }
}

describe('return-to-rest: transitionType 1 (exit-branch)', () => {
  it('renders the exit chain after the main frames and ends on the rest frame', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const agent = createAgentFromModel(baseModel([animExitBranch('A')]), fd.mount, {
      clock,
      rng: () => 0, // force the 100% branch (frame 0 -> frame 2)
    });

    const done = agent.play('A');
    // Drive the whole forward play + the exit-branch return-to-rest walk.
    await run(clock, 1000);
    await expect(done).resolves.toBeUndefined();

    const seq = widths(fd.draws);
    // Forward: MAIN0 then MAIN2 (branch). Return: REST.
    expect(seq).toContain(MAIN0_W);
    expect(seq).toContain(MAIN2_W);
    // The rest frame is composited only as part of the return walk, AFTER the mains.
    expect(seq.lastIndexOf(REST_W)).toBeGreaterThan(seq.lastIndexOf(MAIN2_W));
    expect(seq.lastIndexOf(REST_W)).toBeGreaterThan(seq.lastIndexOf(MAIN0_W));
    // The FINAL composited frame is the rest pose — the character ends neutral.
    expect(seq[seq.length - 1]).toBe(REST_W);
  });
});

describe('return-to-rest: transitionType 0 (named return animation)', () => {
  it("plays the named return animation's frames after the gesture's own frames", async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();

    // A (transitionType 0, returnAnimation 'B'): a single main frame.
    const a: AnimationModel = {
      name: 'A',
      transitionType: 0,
      returnAnimation: 'B',
      frames: [fr(IMG.MAIN0)],
    };
    // B: the named return — its frame is the distinct rest pose.
    const b: AnimationModel = {
      name: 'B',
      transitionType: 2, // B is itself neutral-ending, so no recursion
      frames: [fr(IMG.B_REST)],
    };

    const agent = createAgentFromModel(baseModel([a, b]), fd.mount, {
      clock,
      rng: () => 0,
    });

    const done = agent.play('A');
    await run(clock, 1000);
    await expect(done).resolves.toBeUndefined();

    const seq = widths(fd.draws);
    expect(seq).toContain(MAIN0_W);
    // B's rest frame renders, and it renders AFTER A's frame (the return follows).
    expect(seq).toContain(B_REST_W);
    expect(seq.lastIndexOf(B_REST_W)).toBeGreaterThan(seq.lastIndexOf(MAIN0_W));
    // Ends neutral on B's frame.
    expect(seq[seq.length - 1]).toBe(B_REST_W);
  });
});

describe('return-to-rest: transitionType 2 (none)', () => {
  it("adds no extra frames — the last drawn frame is the animation's own last frame", async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();

    // Two frames, both with images. transitionType 2 → no return-to-rest.
    const a: AnimationModel = {
      name: 'A',
      transitionType: 2,
      // A returnAnimation set here MUST be ignored for type 2.
      returnAnimation: 'B',
      frames: [fr(IMG.MAIN0), fr(IMG.T2_LAST)],
    };
    const b: AnimationModel = {
      name: 'B',
      transitionType: 2,
      frames: [fr(IMG.B_REST)],
    };

    const agent = createAgentFromModel(baseModel([a, b]), fd.mount, {
      clock,
      rng: () => 0,
    });

    const done = agent.play('A');
    await run(clock, 1000);
    await expect(done).resolves.toBeUndefined();

    const seq = widths(fd.draws);
    // Only A's own frames rendered; the last one is A's last frame.
    expect(seq).toContain(MAIN0_W);
    expect(seq[seq.length - 1]).toBe(T2_LAST_W);
    // No return animation frame leaked in despite returnAnimation being set.
    expect(seq).not.toContain(B_REST_W);
    // No rest-chain frame either.
    expect(seq).not.toContain(REST_W);
  });
});

describe('serial queue: the next action starts only after the return-to-rest completes', () => {
  it('renders C only after A has walked back to its rest frame (no hard cut)', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();

    const c: AnimationModel = {
      name: 'C',
      transitionType: 2,
      frames: [fr(IMG.C_FIRST)],
    };

    const agent = createAgentFromModel(baseModel([animExitBranch('A'), c]), fd.mount, {
      clock,
      rng: () => 0,
    });

    // Enqueue A (type 1 with an exit chain) then immediately C.
    void agent.play('A');
    const doneC = agent.play('C');

    await run(clock, 2000);
    await expect(doneC).resolves.toBeUndefined();

    const seq = widths(fd.draws);
    // A's rest frame appears (return-to-rest ran)...
    expect(seq).toContain(REST_W);
    expect(seq).toContain(C_FIRST_W);
    // ...and C's first frame renders strictly AFTER A's rest frame — the serial
    // queue lets A finish returning to rest before C begins (no hard cut from a
    // frozen non-neutral pose).
    expect(seq.indexOf(C_FIRST_W)).toBeGreaterThan(seq.lastIndexOf(REST_W));
  });
});

describe('abort during the return walk stops it', () => {
  it('draws no further frames once stop() lands mid return-to-rest', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();

    // A longer exit chain so we can stop partway: forward branches 0 -> 4 (last),
    // then exit 4 -> 1 -> 2 -> 3 (terminal). We stop after the first return step.
    //   0 MAIN0   (branch -> 4)
    //   1 REST     (exit -> 2)   <- first return step
    //   2 T2_LAST  (exit -> 3)   <- second return step
    //   3 B_REST   (terminal)    <- final rest
    //   4 MAIN2    (last playable; exit -> 1)
    const a: AnimationModel = {
      name: 'A',
      transitionType: 1,
      frames: [
        fr(IMG.MAIN0, { branches: [{ frameIndex: 4, probability: 100 }], durationMs: 100 }),
        fr(IMG.REST, { exitFrame: 2, durationMs: 100 }),
        fr(IMG.T2_LAST, { exitFrame: 3, durationMs: 100 }),
        fr(IMG.B_REST, { durationMs: 100 }),
        fr(IMG.MAIN2, { exitFrame: 1, durationMs: 100 }),
      ],
    };

    const agent = createAgentFromModel(baseModel([a]), fd.mount, {
      clock,
      rng: () => 0,
    });

    void agent.play('A');
    // Advance just far enough to finish the forward play (frame 0 -> 4) and render
    // the FIRST return step (REST), but not the rest of the exit chain.
    await flush();
    clock.advance(100); // fire frame 0's timer -> branch to frame 4 (forward end)
    await flush(); // playForward resolves -> returnToRest -> playIndices first step (REST)

    const seqBeforeStop = widths(fd.draws);
    // The return walk has started (REST drawn) but not finished (B_REST not yet) —
    // otherwise this wouldn't exercise a mid-walk abort.
    expect(seqBeforeStop).toContain(REST_W);
    expect(seqBeforeStop).not.toContain(B_REST_W);

    const drawsAtStop = fd.draws.length;
    agent.stop();

    // No further frames render no matter how far the clock advances.
    await run(clock, 5000);
    expect(fd.draws.length).toBe(drawsAtStop);
  });
});
