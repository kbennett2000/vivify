# Cycle 0 — Repo + contracts

## Goal
Define the seams everything else is built across — **before** any real logic exists. The IR (the superset CharacterModel), the public engine API, the TTS provider interface, and the on-disk bundle schema. Stubs only.

## Why this is its own cycle
The IR is the load-bearing contract between the parser, the renderer, and the voice path. Getting it agreed and type-checked first prevents three subsystems from baking in incompatible assumptions. (Same instinct as a shared identity contract: define the seam first.)

## Deliverables
1. `packages/core/src/types.ts` — the IR + public API types.
2. `packages/core/src/provider.ts` — the `TtsProvider` interface.
3. `packages/acs/src/bundle.ts` — the on-disk bundle schema + a runtime validator (zod) + emitted JSON Schema.
4. Stub implementations so the types are exercised: a `createAgent()` that returns an Agent whose methods are no-ops, and a `StubTtsProvider` returning an empty timeline.
5. Vitest tests that the contracts compile under strict TS and the stubs satisfy the interfaces; bundle validator round-trips a hand-written sample manifest.

## The IR (superset) — sketch to implement and refine
> This is the shape, not the final field list. Refine field names/units during implementation, but it MUST remain a superset of what `.acs` carries. Do not drop fidelity-bearing data.

```ts
export interface CharacterModel {
  info: CharacterInfo;
  palette: Rgb[];              // up to 256 entries
  transparentIndex: number;    // palette index used as the color key
  images: ImageModel[];        // decoded, de-duplicated
  animations: AnimationModel[];
  sounds: SoundModel[];        // extracted WAVs
  balloon: BalloonConfig;
  voice: VoiceConfig;
  states: Record<string, string[]>; // state name -> animation names (Showing, Hiding, Speaking, IdlingLevel1..3, MovingLeft/Right/Up/Down, GesturingLeft/... )
}

export interface CharacterInfo {
  guid: string;
  name?: string;
  width: number; height: number; // default frame size in px
}

export interface ImageModel {
  width: number; height: number;
  // RGBA after palette + color-key applied (alpha 0 for transparent index)
  rgba: Uint8ClampedArray;
}

export interface AnimationModel {
  name: string;
  transitionType: number;      // how it enters/exits (preserve raw value)
  returnAnimation?: string;
  frames: FrameModel[];
}

export interface FrameModel {
  images: FrameImage[];        // composited in order, each at an offset
  durationMs: number;          // .acs stores 1/100s; convert
  branches: FrameBranch[];     // probabilistic next-frame jumps
  exitFrame?: number;          // frame to jump to on exit
  soundIndex?: number;
  mouth?: MouthOverlay;        // lip-sync overlay info for this frame
}

export interface FrameImage { imageIndex: number; x: number; y: number; }
export interface FrameBranch { frameIndex: number; probability: number; } // probabilities sum to 100
export interface MouthOverlay { /* which image(s) represent mouth states; see Cycle 1/6 */ }

export interface BalloonConfig {
  numLines: number; charsPerLine: number;
  fontName: string; fontHeight: number;
  fg: Rgb; bg: Rgb; border: Rgb;
}

export interface VoiceConfig {
  // Enough to drive the authentic service with the character's real settings.
  engineModeId?: string;       // SAPI mode / engine identifier
  languageId?: number;
  gender?: "male" | "female" | "neutral";
  speed?: number; pitch?: number;
  // Raw blob preserved for anything we don't model yet.
  raw?: Record<string, unknown>;
}

export type Rgb = [number, number, number];
```

## Public engine API — sketch
```ts
export interface Agent {
  show(): Promise<void>;
  hide(): Promise<void>;
  play(animationName: string): Promise<void>;
  animations(): string[];
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  moveTo(x: number, y: number, opts?: MoveOptions): Promise<void>;
  gestureAt(x: number, y: number): Promise<void>;
  stopCurrent(): void;        // drop the current queued action
  stop(): void;               // clear queue, return to idle
  on(event: AgentEvent, handler: (...a: unknown[]) => void): void;
  dispose(): void;
}

export interface SpeakOptions { hold?: boolean; provider?: TtsProvider; }
export function createAgent(source: ArrayBuffer | CharacterBundleRef, mount?: HTMLElement): Promise<Agent>;
```
All actions **enqueue** and run in order (matches classic Agent semantics).

## TTS provider interface — sketch
```ts
export interface TtsProvider {
  speak(text: string, voice: VoiceConfig): Promise<TtsResult>;
}
export interface TtsResult {
  audio: ArrayBuffer;          // WAV
  mouthTimeline: MouthEvent[]; // may be empty (fallback)
}
export interface MouthEvent { timeMs: number; shape: number; /* viseme/mouth-height */ }
```

## Bundle (on-disk superset) — schema requirements
- `manifest.json`: everything in `CharacterModel` minus pixel data, plus a sprite-atlas coordinate table (`{ imageIndex -> {x,y,w,h} }`) and audio file references. Versioned (`formatVersion`).
- `sheet.png`: packed transparent atlas of all unique images.
- `audio/*.wav`: extracted sounds.
- zod validator + generated JSON Schema; a sample manifest fixture committed for tests.

## Acceptance check
- [ ] `pnpm -r typecheck` passes under strict mode.
- [ ] `createAgent()` returns an Agent; every method exists and no-ops without throwing.
- [ ] `StubTtsProvider.speak()` returns `{ audio: empty, mouthTimeline: [] }`.
- [ ] Bundle validator accepts the sample manifest and rejects a deliberately broken one.

## Explicit non-goals
No parsing, no rendering, no audio, no real CLI. Stubs and types only. If you find yourself decoding bytes, you're in Cycle 1.
