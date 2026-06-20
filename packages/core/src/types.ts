// The public engine API types for @vivify/core.
//
// The superset IR (CharacterModel) and the TTS contract live in @vivify/types —
// the neutral contract package shared by the parser (@vivify/acs) and this
// engine. These types are the engine's own public surface. See ADR-0008.

import type { TtsProvider } from '@vivify/types';

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
