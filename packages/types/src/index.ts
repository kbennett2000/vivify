// @vivify/types — the neutral, runtime-free contract package.
//
// Holds the shared types owned by neither producer nor consumer: the superset
// IR (CharacterModel) that @vivify/acs *produces* and @vivify/core *consumes*,
// and the TTS contract the engine talks to. Zero runtime dependencies; types
// only. See ADR-0003 (superset IR), ADR-0005 (pluggable TTS), ADR-0008 (this
// package). The IR MUST remain a superset of everything an .acs carries — no
// fidelity-bearing data is dropped.

// ---------------------------------------------------------------------------
// Intermediate representation (the superset CharacterModel)
// ---------------------------------------------------------------------------

/** An RGB triple, each channel 0–255. */
export type Rgb = [number, number, number];

export interface CharacterModel {
  info: CharacterInfo;
  /** Color palette, up to 256 entries. */
  palette: Rgb[];
  /** Palette index used as the transparent color key. */
  transparentIndex: number;
  /** Decoded, de-duplicated images referenced by frames. */
  images: ImageModel[];
  animations: AnimationModel[];
  /** Extracted sound assets (WAV bytes). */
  sounds: SoundModel[];
  balloon: BalloonConfig;
  voice: VoiceConfig;
  /**
   * State name → animation names. Well-known states include Showing, Hiding,
   * Speaking, IdlingLevel1..3, MovingLeft/Right/Up/Down, GesturingLeft/... — but
   * the map is open-ended to preserve whatever a character declares.
   */
  states: Record<string, string[]>;
}

export interface CharacterInfo {
  guid: string;
  name?: string;
  /** Default frame size in pixels. */
  width: number;
  height: number;
}

export interface ImageModel {
  width: number;
  height: number;
  /** RGBA after palette + color-key applied (alpha 0 for the transparent index). */
  rgba: Uint8ClampedArray;
}

export interface AnimationModel {
  name: string;
  /** How the animation enters/exits. Raw .acs value preserved. */
  transitionType: number;
  returnAnimation?: string;
  frames: FrameModel[];
}

export interface FrameModel {
  /** Images composited in order, each at an offset. */
  images: FrameImage[];
  /** Frame duration in milliseconds (.acs stores hundredths of a second; converted). */
  durationMs: number;
  /** Probabilistic next-frame jumps; probabilities sum to 100. */
  branches: FrameBranch[];
  /** Frame to jump to on exit, if any. */
  exitFrame?: number;
  /** Index into CharacterModel.sounds for a per-frame sound, if any. */
  soundIndex?: number;
  /** Lip-sync overlay info for this frame, if any. */
  mouth?: MouthOverlay;
}

export interface FrameImage {
  /** Index into CharacterModel.images. */
  imageIndex: number;
  x: number;
  y: number;
}

export interface FrameBranch {
  /** Index of the frame to branch to. */
  frameIndex: number;
  /** Probability 0–100; the set of branches on a frame sums to 100. */
  probability: number;
}

/**
 * Lip-sync overlay info for a frame. Modeled in Cycle 1/6; preserved as an
 * open structure here so the parser can attach mouth-state data without the
 * contract changing shape. `raw` keeps anything not yet explicitly modeled.
 */
export interface MouthOverlay {
  raw?: Record<string, unknown>;
}

export interface SoundModel {
  /** Raw WAV bytes for this sound. */
  wav: ArrayBuffer;
}

export interface BalloonConfig {
  numLines: number;
  charsPerLine: number;
  fontName: string;
  fontHeight: number;
  fg: Rgb;
  bg: Rgb;
  border: Rgb;
}

export interface VoiceConfig {
  /** SAPI mode / engine identifier. */
  engineModeId?: string;
  languageId?: number;
  gender?: 'male' | 'female' | 'neutral';
  speed?: number;
  pitch?: number;
  /** Raw blob preserved for anything not yet modeled. */
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TTS contract (the seam between the engine and any voice provider)
// ---------------------------------------------------------------------------

export interface MouthEvent {
  /** Time of this mouth event, in milliseconds from the start of the audio. */
  timeMs: number;
  /** Viseme / mouth-shape id (or mouth-height). Provider-defined scale. */
  shape: number;
}

export interface TtsResult {
  /** Synthesized audio as a WAV byte buffer. */
  audio: ArrayBuffer;
  /** Per-event mouth timeline for lip-sync; may be empty (e.g. a fallback provider). */
  mouthTimeline: MouthEvent[];
}

export interface TtsProvider {
  speak(text: string, voice: VoiceConfig): Promise<TtsResult>;
}
