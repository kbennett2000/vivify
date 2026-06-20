// @vivify/core — framework-agnostic engine that loads, renders, animates, and
// speaks Microsoft Agent characters in the browser.
//
// Cycle 0: the public Agent API and a no-op engine (createAgent) + bundled stub
// provider (StubTtsProvider). The superset IR and the TTS contract live in
// @vivify/types and are re-exported here for consumer convenience (their
// canonical home is @vivify/types). Real rendering and playback land in Cycle 3+.

export const name = '@vivify/core';

// Public engine API (owned by this package).
export type { Agent, AgentEvent, SpeakOptions, MoveOptions, CharacterBundleRef } from './types.js';

export { StubTtsProvider } from './provider.js';
export { createAgent } from './agent.js';

// Shared contracts re-exported for convenience; canonical home is @vivify/types.
export type {
  Rgb,
  CharacterModel,
  CharacterInfo,
  ImageModel,
  AnimationModel,
  FrameModel,
  FrameImage,
  FrameBranch,
  MouthOverlay,
  SoundModel,
  BalloonConfig,
  VoiceConfig,
  TtsProvider,
  TtsResult,
  MouthEvent,
} from '@vivify/types';
