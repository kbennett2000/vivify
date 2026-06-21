// Cycle 6 (docs/cycles/cycle-6-lipsync.md → "Validation → CI": "speak integration
// + stop-interrupts-synthesis: synthetic Speaking IR + FakeClock + fake AudioSink
// + a controllable provider honoring the signal → audio played, overlays set over
// time, balloon advances; stop() → audio stopped, provider aborted, balloon
// hidden, no further overlays. Silent fallback (empty audio) still runs the
// heuristic path."). All synthetic: no .acs, no engine, no real browser/audio.
// The fakes here are external collaborators (Document/AudioSink/TtsProvider), not
// mocks of the code under test — we drive them with the FakeClock and assert the
// agent's real compositing/balloon/queue behavior.

import { describe, it, expect } from 'vitest';
import type {
  AnimationModel,
  CharacterModel,
  FrameMouthOverlay,
  ImageModel,
  MouthEvent,
  TtsProvider,
  TtsResult,
  VoiceConfig,
} from '@vivify/types';
import { createAgentFromModel } from '../src/agent.js';
import type { AudioHandle, AudioSink } from '../src/audio.js';
import { FakeClock } from './_helpers.js';

// --- synthetic model -------------------------------------------------------

// Distinct widths so a recorded drawImage maps back to an imageIndex:
//   width 3 = base frame image (index 0)
//   width 1 = "closed" mouth overlay (index 1, AgentMouthOverlay type 0 = Closed)
//   width 2 = "open"   mouth overlay (index 2, AgentMouthOverlay type 4 = Wide4)
const BASE_W = 3;
const CLOSED_W = 1;
const OPEN_W = 2;

function img(w: number, h: number): ImageModel {
  return { width: w, height: h, rgba: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
}

const overlay = (type: number, imageIndex: number): FrameMouthOverlay => ({
  type,
  replaceFlag: false,
  imageIndex,
  x: 0,
  y: 0,
  rgnFlag: 0,
  scaleX: 1,
  scaleY: 1,
});

function model(): CharacterModel {
  // Two frames so the Speaking loop schedules through the clock (a single-frame
  // animation would end synchronously inside start() and re-enter the loop).
  // Both frames carry the same mouth overlays so the lip-sync ticker always has
  // a closed/open pair to choose from regardless of the active frame.
  const speakFrame = () => ({
    images: [{ imageIndex: 0, x: 0, y: 0 }],
    durationMs: 100,
    branches: [],
    mouth: { overlays: [overlay(0, 1), overlay(4, 2)] },
  });
  const speaking: AnimationModel = {
    name: 'Speak',
    transitionType: 0,
    frames: [speakFrame(), speakFrame()],
  };
  return {
    info: { guid: '{lipsync-test}', width: 32, height: 32 },
    palette: [],
    transparentIndex: 0,
    images: [img(BASE_W, BASE_W), img(CLOSED_W, CLOSED_W), img(OPEN_W, OPEN_W)],
    animations: [speaking],
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
    states: { Speaking: ['Speak'] },
  };
}

// --- fake Document (extends compositor.test.ts's pattern to div + canvas) ---

interface DrawCall {
  w: number;
  h: number;
}

interface FakeCtx {
  clearRect(): void;
  drawImage(src: { width: number; height: number }, x: number, y: number): void;
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(): void;
}

interface FakeStyle {
  [k: string]: string;
}

interface FakeElement {
  style: FakeStyle;
  textContent: string;
  ownerDocument: Document;
  children: FakeElement[];
  appendChild(child: FakeElement): void;
  remove(): void;
}

interface FakeDoc {
  doc: Document;
  draws: DrawCall[];
  mount: HTMLElement;
}

function makeFakeDoc(): FakeDoc {
  const draws: DrawCall[] = [];
  const makeCtx = (): FakeCtx => ({
    clearRect: () => {},
    drawImage: (src) => {
      draws.push({ w: src.width, h: src.height });
    },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  });

  const makeEl = (): FakeElement => {
    const el: FakeElement = {
      style: {},
      textContent: '',
      ownerDocument: undefined as unknown as Document,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
      remove() {},
    };
    return el;
  };

  const makeCanvas = (): unknown => ({
    width: 0,
    height: 0,
    style: {} as FakeStyle,
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

function balloonText(mount: HTMLElement): string {
  // host -> [canvas, balloon]; the balloon is the div child carrying textContent.
  const host = (mount as unknown as FakeElement).children[0]!;
  const balloon = host.children[1]!;
  return balloon.textContent;
}

function balloonDisplay(mount: HTMLElement): string | undefined {
  const host = (mount as unknown as FakeElement).children[0]!;
  const balloon = host.children[1]!;
  return balloon.style.display;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Recorded draw widths (each draw is identified by the WIDTH of its image). */
function widths(draws: DrawCall[]): number[] {
  return draws.map((d) => d.w);
}

// --- fake AudioSink driven by the FakeClock --------------------------------

interface FakeHandleState {
  stopped: boolean;
  resolveEnded: () => void;
}

class FakeAudioSink implements AudioSink {
  playCalls: ArrayBuffer[] = [];
  handles: FakeHandleState[] = [];
  private readonly durationMs: number;

  constructor(
    private readonly clock: FakeClock,
    durationMs = 1000,
  ) {
    this.durationMs = durationMs;
  }

  play(wav: ArrayBuffer): Promise<AudioHandle> {
    this.playCalls.push(wav);
    const startedAt = this.clock.now();
    const state: FakeHandleState = { stopped: false, resolveEnded: () => {} };
    const ended = new Promise<void>((resolve) => {
      state.resolveEnded = resolve;
    });
    this.handles.push(state);
    const dur = this.durationMs;
    const clock = this.clock;
    const handle: AudioHandle = {
      currentTimeMs: () => (state.stopped ? dur : Math.max(0, clock.now() - startedAt)),
      durationMs: () => dur,
      ended,
      stop: () => {
        if (state.stopped) return;
        state.stopped = true;
        state.resolveEnded();
      },
    };
    return Promise.resolve(handle);
  }

  /** End playback naturally (resolves the handle's `ended` promise). */
  end(i = 0): void {
    this.handles[i]?.resolveEnded();
  }
}

// --- fake providers (real classes implementing TtsProvider) ----------------

class AudioProvider implements TtsProvider {
  constructor(private readonly result: TtsResult) {}
  speak(_text: string, _voice: VoiceConfig, _signal?: AbortSignal): Promise<TtsResult> {
    return Promise.resolve(this.result);
  }
}

/** Never resolves until aborted; rejects with an AbortError on abort. */
class HangingProvider implements TtsProvider {
  aborted = false;
  speak(_text: string, _voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult> {
    return new Promise<TtsResult>((_resolve, reject) => {
      const onAbort = (): void => {
        this.aborted = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** Flush queued microtasks so the agent's awaited provider/audio steps run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// shape == mouth HEIGHT, width == mouth WIDTH. t≈0 -> height 0 maps to Closed
// (type 0); after 500ms -> height 140 & width 100 maps to Wide4 (type 4) since
// the authentic tree selects Wide4 for width>=60 && height>=120.
const TIMELINE: MouthEvent[] = [
  { timeMs: 0, shape: 0, width: 0 },
  { timeMs: 500, shape: 140, width: 100 },
];

function audioResult(): TtsResult {
  return { audio: new Uint8Array([1, 2, 3, 4]).buffer, mouthTimeline: TIMELINE };
}

describe('speak with audio + lip-sync (Test A)', () => {
  it('plays audio, drives changing mouth overlays, holds the full balloon, then clears on end', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResult());

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('one two three four');
    await flush();

    // Audio was played with the provider's buffer.
    expect(sink.playCalls.length).toBe(1);
    expect(new Uint8Array(sink.playCalls[0]!)).toEqual(new Uint8Array([1, 2, 3, 4]));

    // Early (t≈0): shape 0 -> the "closed" overlay (width 1) was composited.
    const earlyDraws = fd.draws.splice(0);
    expect(earlyDraws.some((d) => d.w === CLOSED_W)).toBe(true);
    expect(earlyDraws.some((d) => d.w === OPEN_W)).toBe(false);

    // "Render once and hold": the balloon shows the full text immediately and is
    // NOT blanked/re-revealed during the ticks (regression for the double-fire).
    expect(wordCount(balloonText(fd.mount))).toBe(4);

    // Advance audio time past the second mouth event (timeMs 500, shape 140).
    clock.advance(600);
    await flush();

    const lateDraws = fd.draws.splice(0);
    // The overlay changed: the "open" overlay (width 2) now appears.
    expect(lateDraws.some((d) => d.w === OPEN_W)).toBe(true);

    // Balloon still holds the full text — never blanked between ticks.
    expect(wordCount(balloonText(fd.mount))).toBe(4);

    fd.draws.splice(0);

    // End the audio naturally → speak resolves and the overlay is cleared (the
    // final draw composites only the base frame, no mouth overlay).
    sink.end(0);
    await expect(done).resolves.toBeUndefined();

    const finalDraws = fd.draws;
    expect(finalDraws.length).toBeGreaterThan(0);
    expect(finalDraws.some((d) => d.w === BASE_W)).toBe(true);
    expect(finalDraws.some((d) => d.w === CLOSED_W || d.w === OPEN_W)).toBe(false);
  });
});

describe('stop interrupts in-flight synthesis (Test B)', () => {
  it('aborts the provider, hides the balloon, and draws no further overlays after stop', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new HangingProvider();

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('hello there');
    await flush();

    // Synthesis is in flight (the provider hangs), so no audio yet.
    expect(provider.aborted).toBe(false);
    expect(sink.playCalls.length).toBe(0);

    agent.stop();
    await expect(done).resolves.toBeUndefined();

    // The provider's signal was aborted (stop threads the signal into synthesis).
    expect(provider.aborted).toBe(true);
    // Balloon hidden.
    expect(balloonDisplay(fd.mount)).toBe('none');

    // No further mouth-overlay draws happen on subsequent clock advances.
    fd.draws.splice(0);
    clock.advance(2000);
    await flush();
    const after = fd.draws;
    expect(after.some((d) => d.w === CLOSED_W || d.w === OPEN_W)).toBe(false);
  });

  it('stops audio playback when stop lands after audio has started', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResult());

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('one two three four');
    await flush();
    expect(sink.playCalls.length).toBe(1);
    expect(sink.handles[0]!.stopped).toBe(false);

    agent.stop();
    await expect(done).resolves.toBeUndefined();

    // The in-progress audio handle was stopped, balloon hidden, no later overlays.
    expect(sink.handles[0]!.stopped).toBe(true);
    expect(balloonDisplay(fd.mount)).toBe('none');

    fd.draws.splice(0);
    clock.advance(2000);
    await flush();
    expect(fd.draws.some((d) => d.w === CLOSED_W || d.w === OPEN_W)).toBe(false);
  });
});

// --- Regression (Test D): single-/zero-frame Speaking must not recurse --------
//
// Locks the fix in agent.ts `speakWithAudio`: the Speaking loop only restarts on
// onEnd when the animation has MORE THAN ONE playable frame
// (`playableLength(anim.frames) > 1`). A single static pose plays once and holds
// while the mouth overlay carries the motion. Before the fix, a single-frame
// animation ended synchronously inside start() and re-entered startLoop() from
// onEnd without yielding to the clock → infinite recursion / stack overflow.

// Faster timeline so the second viseme lands within the first lip-sync window.
const TIMELINE_FAST: MouthEvent[] = [
  { timeMs: 0, shape: 0, width: 0 },
  { timeMs: 300, shape: 140, width: 100 },
];

function audioResultFast(): TtsResult {
  return { audio: new Uint8Array([1, 2, 3, 4]).buffer, mouthTimeline: TIMELINE_FAST };
}

/** Speaking animation with exactly ONE playable frame (one image), mouth overlays. */
function singleFrameModel(): CharacterModel {
  const speakFrame = {
    images: [{ imageIndex: 0, x: 0, y: 0 }],
    durationMs: 100,
    branches: [],
    mouth: { overlays: [overlay(0, 1), overlay(4, 2)] },
  };
  const speaking: AnimationModel = {
    name: 'Speak',
    transitionType: 0,
    frames: [speakFrame],
  };
  return {
    info: { guid: '{lipsync-single-frame}', width: 32, height: 32 },
    palette: [],
    transparentIndex: 0,
    images: [img(BASE_W, BASE_W), img(CLOSED_W, CLOSED_W), img(OPEN_W, OPEN_W)],
    animations: [speaking],
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
    states: { Speaking: ['Speak'] },
  };
}

/** Speaking animation whose only frame has ZERO images (playableLength 0). */
function zeroFrameModel(): CharacterModel {
  const m = singleFrameModel();
  m.info = { ...m.info, guid: '{lipsync-zero-frame}' };
  m.animations = [
    {
      name: 'Speak',
      transitionType: 0,
      frames: [{ images: [], durationMs: 100, branches: [], mouth: { overlays: [] } }],
    },
  ];
  return m;
}

describe('speak with a single-frame Speaking animation (Test D — regression)', () => {
  it('does not recurse/stack-overflow; renders the static pose; lip-syncs over time', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResultFast());

    const agent = createAgentFromModel(singleFrameModel(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    // If the fix regressed, this synchronously recurses and throws
    // "Maximum call stack size exceeded" before flush() can yield.
    const done = agent.speak('one two three four');
    await flush();

    // Audio played, and the single static base pose was composited.
    expect(sink.playCalls.length).toBe(1);
    const earlyDraws = fd.draws.splice(0);
    expect(earlyDraws.some((d) => d.w === BASE_W)).toBe(true);
    // Early (t≈0, shape 0): the "closed" overlay drives the mouth, not "open".
    expect(earlyDraws.some((d) => d.w === CLOSED_W)).toBe(true);
    expect(earlyDraws.some((d) => d.w === OPEN_W)).toBe(false);

    // Advance past the second viseme (timeMs 300, shape 140). Even though the
    // base pose is static, the mouth overlay must still update over time.
    clock.advance(400);
    await flush();
    const lateDraws = fd.draws.splice(0);
    expect(lateDraws.some((d) => d.w === OPEN_W)).toBe(true);

    // End audio naturally → speak resolves normally (no recursion ever fired).
    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });

  it('also resolves for a zero-playable-frame Speaking animation (defensive)', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResultFast());

    const agent = createAgentFromModel(zeroFrameModel(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('one two three four');
    await flush();

    // Audio still plays; the loop never restarts (canLoop false, len 0).
    expect(sink.playCalls.length).toBe(1);

    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });
});

describe('silent fallback (Test C)', () => {
  it('runs the heuristic Speaking animation, shows full text, and never plays audio', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    // Empty audio -> the engine must take the silent heuristic path.
    const provider = new AudioProvider({ audio: new ArrayBuffer(0), mouthTimeline: [] });

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const text = 'one two three';
    const done = agent.speak(text);
    await flush();

    // No audio path taken.
    expect(sink.playCalls.length).toBe(0);
    // Balloon shows the full text (no reveal-by-progress without audio).
    expect(wordCount(balloonText(fd.mount))).toBe(3);

    // Advance past the heuristic duration (SPEAK_MIN_MS 800 + len*55 ≈ < 1.5s).
    clock.advance(2000);
    await flush();
    await expect(done).resolves.toBeUndefined();

    // Still never played audio.
    expect(sink.playCalls.length).toBe(0);
    // Balloon hidden after speech completes.
    expect(balloonDisplay(fd.mount)).toBe('none');
  });
});

// --- speak preserves the held gesture pose + sources the mouth overlay (cycle-8 #2) ---
//
// After the return-to-rest correction, a gesture HOLDS its end pose and speak()
// does NOT walk it back to rest. speakWithAudio composites the mouth onto whatever
// is on screen:
//   - If the held frame HAS mouth overlays, it is the overlay source and the pose
//     is preserved (no base frame rendered, no return/exit frames).
//   - If the held frame has NO overlays, a base frame from findOverlayFrame() is
//     rendered so the mouth still has somewhere to composite.
// Both models below have NO Speaking state, so speakWithAudio takes the
// "no speakingAnim" path and the source is the on-screen frame (ADR-0018).

// Distinct widths for the gesture-pose models (kept clear of BASE/CLOSED/OPEN = 3/1/2).
const GEST_BASE_W = 50; // the held gesture frame's base image
const GEST_CLOSED_W = 51; // mouth overlay type 0 (Closed) carried by the held frame
const GEST_OPEN_W = 52; // mouth overlay type 4 (Wide4) carried by the held frame
const FALLBACK_BASE_W = 60; // findOverlayFrame() base image (Showing state)
const FALLBACK_CLOSED_W = 61; // overlay type 0 on the fallback base frame
const FALLBACK_OPEN_W = 62; // overlay type 4 on the fallback base frame
const REST_PLAIN_W = 70; // a held gesture frame that carries NO mouth overlays

/**
 * Model where a gesture's last frame HAS mouth overlays and there is NO Speaking
 * state. play('Gesture') holds that frame; a following speak() must preserve it.
 */
function heldOverlayModel(): CharacterModel {
  const gestureFrame = {
    images: [{ imageIndex: 0, x: 0, y: 0 }], // GEST_BASE
    durationMs: 100,
    branches: [],
    mouth: { overlays: [overlay(0, 1), overlay(4, 2)] }, // GEST_CLOSED, GEST_OPEN
  };
  const gesture: AnimationModel = {
    name: 'Gesture',
    transitionType: 2, // ends neutral; the engine still holds the pose
    frames: [gestureFrame],
  };
  return {
    info: { guid: '{held-overlay}', width: 32, height: 32 },
    palette: [],
    transparentIndex: 0,
    images: [
      img(GEST_BASE_W, GEST_BASE_W),
      img(GEST_CLOSED_W, GEST_CLOSED_W),
      img(GEST_OPEN_W, GEST_OPEN_W),
    ],
    animations: [gesture],
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
    states: {}, // NO Speaking state
  };
}

/**
 * Model where the held gesture's last frame has NO mouth overlays, but a Showing
 * animation DOES carry overlays — so findOverlayFrame() supplies a base frame
 * (preferred states include 'Showing') for the mouth to composite onto.
 */
function heldPlainModel(): CharacterModel {
  const gesture: AnimationModel = {
    name: 'Gesture',
    transitionType: 2,
    // one plain frame, NO mouth overlays (imageIndex 0 = REST_PLAIN)
    frames: [{ images: [{ imageIndex: 0, x: 0, y: 0 }], durationMs: 100, branches: [] }],
  };
  // Showing animation whose frame carries overlays — findOverlayFrame() prefers it.
  const showing: AnimationModel = {
    name: 'Show',
    transitionType: 2,
    frames: [
      {
        images: [{ imageIndex: 1, x: 0, y: 0 }], // FALLBACK_BASE
        durationMs: 100,
        branches: [],
        mouth: { overlays: [overlay(0, 2), overlay(4, 3)] }, // FALLBACK_CLOSED, FALLBACK_OPEN
      },
    ],
  };
  return {
    info: { guid: '{held-plain}', width: 32, height: 32 },
    palette: [],
    transparentIndex: 0,
    images: [
      img(REST_PLAIN_W, REST_PLAIN_W),
      img(FALLBACK_BASE_W, FALLBACK_BASE_W),
      img(FALLBACK_CLOSED_W, FALLBACK_CLOSED_W),
      img(FALLBACK_OPEN_W, FALLBACK_OPEN_W),
    ],
    animations: [gesture, showing],
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
    states: { Showing: ['Show'] }, // NO Speaking; Showing carries the overlay base
  };
}

// Distinct widths for the final-fallback model (kept clear of every width above).
const ARB_BASE_W = 80; // the overlay-bearing frame on an ARBITRARY (non-preferred-state) animation
const ARB_CLOSED_W = 81; // overlay type 0 (Closed) on that arbitrary frame
const ARB_OPEN_W = 82; // overlay type 4 (Wide4) on that arbitrary frame

/**
 * Model that forces findOverlayFrame() into its FINAL fallback loop
 * (`for (const anim of this.model.animations)`): the held gesture frame has NO
 * mouth overlays (so the overlay-base path triggers), and NONE of the preferred
 * states (Speaking / RestPose / IdlingLevel1 / Showing) map to an overlay-bearing
 * frame — here those states are entirely absent. Only an arbitrary 'Greet'
 * animation carries a frame with mouth overlays, so the fallback scan over
 * model.animations must supply it as the speak base.
 */
function fallbackScanModel(): CharacterModel {
  // Held gesture: a single plain frame, NO mouth overlays (REST_PLAIN base).
  const gesture: AnimationModel = {
    name: 'Gesture',
    transitionType: 2,
    frames: [{ images: [{ imageIndex: 0, x: 0, y: 0 }], durationMs: 100, branches: [] }],
  };
  // An arbitrary animation NOT referenced by any preferred state. It is the ONLY
  // overlay-bearing animation, so only the final scan over model.animations finds it.
  const greet: AnimationModel = {
    name: 'Greet',
    transitionType: 2,
    frames: [
      {
        images: [{ imageIndex: 1, x: 0, y: 0 }], // ARB_BASE
        durationMs: 100,
        branches: [],
        mouth: { overlays: [overlay(0, 2), overlay(4, 3)] }, // ARB_CLOSED, ARB_OPEN
      },
    ],
  };
  return {
    info: { guid: '{fallback-scan}', width: 32, height: 32 },
    palette: [],
    transparentIndex: 0,
    images: [
      img(REST_PLAIN_W, REST_PLAIN_W),
      img(ARB_BASE_W, ARB_BASE_W),
      img(ARB_CLOSED_W, ARB_CLOSED_W),
      img(ARB_OPEN_W, ARB_OPEN_W),
    ],
    animations: [gesture, greet],
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
    // NO Speaking / RestPose / IdlingLevel1 / Showing — none of the preferred
    // states exist, so findOverlayFrame() must reach the final animation scan.
    states: {},
  };
}

describe('speak preserves the held gesture pose and sources the mouth overlay (cycle-8 #2)', () => {
  it('held frame HAS overlays: no base/return frame is rendered during speak; the mouth composites from the held frame', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResult());

    const agent = createAgentFromModel(heldOverlayModel(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    // Play the gesture to its held end pose.
    const gestureDone = agent.play('Gesture');
    await flush();
    await expect(gestureDone).resolves.toBeUndefined();
    // The held gesture frame is on screen.
    expect(widths(fd.draws).at(-1)).toBe(GEST_BASE_W);
    fd.draws.splice(0);

    // Speak. There is no Speaking animation and the on-screen frame ALREADY has
    // overlays, so no base frame is rendered — the pose is preserved.
    const done = agent.speak('one two three four');
    await flush();

    expect(sink.playCalls.length).toBe(1);
    const speakDraws = widths(fd.draws);
    // No fallback/other base frame appeared — only the held gesture base re-draws
    // (compositor re-renders the SAME held frame when setting the mouth overlay).
    expect(
      speakDraws.every((w) => w === GEST_BASE_W || w === GEST_CLOSED_W || w === GEST_OPEN_W),
    ).toBe(true);
    // The mouth overlay composited is sourced from the HELD frame: early (shape 0)
    // → the Closed overlay (GEST_CLOSED), not the fallback model's overlays.
    expect(speakDraws).toContain(GEST_CLOSED_W);
    expect(speakDraws).not.toContain(FALLBACK_CLOSED_W);
    expect(speakDraws).not.toContain(FALLBACK_OPEN_W);

    fd.draws.splice(0);
    // Advance past the second viseme (shape 140 → Wide4): the held frame's OPEN
    // overlay now composites — still sourced from the preserved pose.
    clock.advance(600);
    await flush();
    expect(widths(fd.draws)).toContain(GEST_OPEN_W);

    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });

  it('held frame has NO overlays: speak renders the findOverlayFrame() base and composites a real mouth overlay from it', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResult());

    const agent = createAgentFromModel(heldPlainModel(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    // Play the plain gesture; it holds a frame with NO mouth overlays.
    const gestureDone = agent.play('Gesture');
    await flush();
    await expect(gestureDone).resolves.toBeUndefined();
    expect(widths(fd.draws).at(-1)).toBe(REST_PLAIN_W);
    fd.draws.splice(0);

    const done = agent.speak('one two three four');
    await flush();

    expect(sink.playCalls.length).toBe(1);
    const speakDraws = widths(fd.draws);
    // The on-screen held frame had no overlays, so findOverlayFrame() rendered the
    // Showing base (FALLBACK_BASE) so the mouth has somewhere to composite.
    expect(speakDraws).toContain(FALLBACK_BASE_W);
    // A real mouth overlay from the fallback base composites: early (shape 0) →
    // its Closed overlay.
    expect(speakDraws).toContain(FALLBACK_CLOSED_W);

    fd.draws.splice(0);
    clock.advance(600);
    await flush();
    // Past the second viseme → the fallback base's OPEN overlay composites.
    expect(widths(fd.draws)).toContain(FALLBACK_OPEN_W);

    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });

  it('held frame has NO overlays AND no preferred state has overlays: the final model.animations scan supplies the base', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new AudioProvider(audioResult());

    const agent = createAgentFromModel(fallbackScanModel(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    // Play the plain gesture; it holds a frame with NO mouth overlays.
    const gestureDone = agent.play('Gesture');
    await flush();
    await expect(gestureDone).resolves.toBeUndefined();
    expect(widths(fd.draws).at(-1)).toBe(REST_PLAIN_W);
    fd.draws.splice(0);

    const done = agent.speak('one two three four');
    await flush();

    expect(sink.playCalls.length).toBe(1);
    const speakDraws = widths(fd.draws);
    // No Speaking state and no preferred state carries overlays, so findOverlayFrame()
    // fell all the way through to the final `for (const anim of model.animations)`
    // scan and rendered the arbitrary 'Greet' animation's overlay-bearing base.
    expect(speakDraws).toContain(ARB_BASE_W);
    // A real mouth overlay from that scanned base composites: early (shape 0) → Closed.
    expect(speakDraws).toContain(ARB_CLOSED_W);

    fd.draws.splice(0);
    clock.advance(600);
    await flush();
    // Past the second viseme → the scanned base's OPEN overlay composites.
    expect(widths(fd.draws)).toContain(ARB_OPEN_W);

    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });
});

// --- balloon timing: shown only when audio actually starts (cycle-8 #3) ---
//
// speak() calls balloon.setText early but defers balloon.show() until AFTER
// audio.play() resolves (audio path) or to the start of speakAnimate (silent
// path). A DeferredProvider lets us hold synthesis open and assert the balloon is
// hidden during the wait, shown only after the audio actually starts.

/** TtsProvider whose speak() resolves only when we call its `resolve()`. */
class DeferredProvider implements TtsProvider {
  private resolveFn: ((r: TtsResult) => void) | null = null;
  constructor(private readonly result: TtsResult) {}
  speak(_text: string, _voice: VoiceConfig, _signal?: AbortSignal): Promise<TtsResult> {
    return new Promise<TtsResult>((resolve) => {
      this.resolveFn = resolve;
    });
  }
  /** Release the in-flight synthesis with the configured result. */
  release(): void {
    this.resolveFn?.(this.result);
  }
}

describe('balloon is shown only when audio actually starts (cycle-8 #3)', () => {
  it('audio path: balloon is hidden after speak() but before audio.play resolves, and shown after', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    const provider = new DeferredProvider(audioResult());

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('one two three four');
    await flush();

    // Synthesis is in flight (provider deferred): the text is loaded but the
    // balloon must NOT be shown yet (display:none).
    expect(wordCount(balloonText(fd.mount))).toBe(4);
    expect(balloonDisplay(fd.mount)).toBe('none');
    expect(sink.playCalls.length).toBe(0);

    // Release synthesis → speakWithAudio plays the audio, then shows the balloon.
    provider.release();
    await flush();

    expect(sink.playCalls.length).toBe(1);
    expect(balloonDisplay(fd.mount)).not.toBe('none');

    sink.end(0);
    await expect(done).resolves.toBeUndefined();
  });

  it('silent path: empty audio → the balloon is shown when speakAnimate starts', async () => {
    const clock = new FakeClock();
    const fd = makeFakeDoc();
    const sink = new FakeAudioSink(clock, 1000);
    // Deferred provider that ultimately resolves with EMPTY audio (silent path).
    const provider = new DeferredProvider({ audio: new ArrayBuffer(0), mouthTimeline: [] });

    const agent = createAgentFromModel(model(), fd.mount, {
      clock,
      audio: sink,
      provider,
      rng: () => 0,
    });

    const done = agent.speak('one two three four');
    await flush();

    // Still synthesizing: balloon hidden, text loaded.
    expect(balloonDisplay(fd.mount)).toBe('none');
    expect(wordCount(balloonText(fd.mount))).toBe(4);

    // Release with empty audio → silent heuristic path; speakAnimate shows the balloon.
    provider.release();
    await flush();

    expect(sink.playCalls.length).toBe(0); // never plays audio on the silent path
    expect(balloonDisplay(fd.mount)).not.toBe('none');

    // Finish the heuristic duration so the action resolves cleanly.
    clock.advance(3000);
    await flush();
    await expect(done).resolves.toBeUndefined();
  });
});
