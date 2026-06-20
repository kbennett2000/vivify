// The superset IR + public engine API types for @vivify/core.
//
// The IR (CharacterModel) is the load-bearing contract between the parser
// (@vivify/acs), the renderer (this package), and the voice path. It MUST remain
// a superset of everything an .acs carries — no fidelity-bearing data is dropped.
// See docs/cycles/cycle-0-contracts.md and ADR-0003.

import type { TtsProvider } from './provider.js';

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
// Public engine API
// ---------------------------------------------------------------------------

/** Events an Agent can emit. Handlers are registered via `Agent.on`. */
export type AgentEvent =
  | 'show'
  | 'hide'
  | 'play'
  | 'speak'
  | 'move'
  | 'gesture'
  | 'idle'
  | 'command'
  | 'error';

export interface SpeakOptions {
  /** Keep the balloon up after speaking instead of auto-hiding. */
  hold?: boolean;
  /** Override the TTS provider for this utterance. */
  provider?: TtsProvider;
}

export interface MoveOptions {
  /** Movement speed (pixels/second); engine picks a default if omitted. */
  speed?: number;
}

/**
 * A reference to a pre-built bundle (manifest + atlas + audio) served somewhere,
 * as an alternative to passing a raw .acs ArrayBuffer to `createAgent`.
 */
export interface CharacterBundleRef {
  /** URL of the bundle's manifest.json. */
  manifestUrl: string;
}

/**
 * The public agent control. Mirrors the classic Microsoft Agent control. Every
 * action enqueues and runs in order (classic Agent semantics).
 */
export interface Agent {
  show(): Promise<void>;
  hide(): Promise<void>;
  play(animationName: string): Promise<void>;
  /** Names of the character's available animations. */
  animations(): string[];
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  moveTo(x: number, y: number, opts?: MoveOptions): Promise<void>;
  gestureAt(x: number, y: number): Promise<void>;
  /** Drop the currently-running queued action. */
  stopCurrent(): void;
  /** Clear the queue and return to idle. */
  stop(): void;
  on(event: AgentEvent, handler: (...a: unknown[]) => void): void;
  dispose(): void;
}
