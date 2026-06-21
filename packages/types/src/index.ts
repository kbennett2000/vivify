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
 * One mouth-overlay entry on a frame: a mouth-shape image (an index into
 * CharacterModel.images) composited at an offset during lip-sync. Decoded from
 * the .acs 14-byte overlay record (Cycle 2 captured these losslessly; Cycle 6
 * structured them — ADR-0010). `type` is the engine's mouth-shape id for the
 * overlay; the remaining fields are preserved verbatim from the format.
 */
export interface FrameMouthOverlay {
  /** Mouth-shape id for this overlay (raw .acs `type`). */
  type: number;
  /** Whether the overlay replaces (vs. blends over) the base pixels. */
  replaceFlag: boolean;
  /** Index into CharacterModel.images for the mouth-shape image. */
  imageIndex: number;
  /** Compositing offset. */
  x: number;
  y: number;
  /** Region flag, preserved from the format. */
  rgnFlag: number;
  /** Scale factors, preserved from the format (often unused). */
  scaleX: number;
  scaleY: number;
}

/**
 * Lip-sync overlay info for a frame: the set of mouth-shape overlays the engine
 * can composite while speaking. Cycle 6 drives one of these per the voice
 * timeline (ADR-0010). Empty/absent means the frame carries no mouth overlay.
 */
export interface MouthOverlay {
  overlays: FrameMouthOverlay[];
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
  /** Mouth HEIGHT (SAPI4 TTSMOUTH bMouthHeight, ~0..255). Named `shape` for back-compat. */
  shape: number;
  /**
   * Mouth WIDTH (SAPI4 TTSMOUTH bMouthWidth, ~0..255). Optional: present from the
   * TruVoice server; absent for fallback providers. Together with `shape` (height) it
   * selects the AgentMouthOverlay type via the authentic VoiceMouthOverlay mapping.
   */
  width?: number;
}

export interface TtsResult {
  /** Synthesized audio as a WAV byte buffer. */
  audio: ArrayBuffer;
  /** Per-event mouth timeline for lip-sync; may be empty (e.g. a fallback provider). */
  mouthTimeline: MouthEvent[];
}

export interface TtsProvider {
  /**
   * Synthesize `text` with the character's voice. `signal`, if given, aborts the
   * in-flight synthesis (e.g. when the engine is stopped mid-utterance) — the
   * returned promise should reject on abort.
   */
  speak(text: string, voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult>;
}
