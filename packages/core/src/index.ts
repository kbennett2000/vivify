// @vivify/core — framework-agnostic engine that loads, renders, animates, and
// speaks Microsoft Agent characters in the browser.
//
// Cycle 0: the superset IR, the public Agent API, and the TtsProvider seam are
// defined here, with no-op stubs (createAgent, StubTtsProvider). Real rendering
// and playback land in Cycle 3+.

export const name = '@vivify/core';

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
  Agent,
  AgentEvent,
  SpeakOptions,
  MoveOptions,
  CharacterBundleRef,
} from './types.js';

export type { TtsProvider, TtsResult, MouthEvent } from './provider.js';
export { StubTtsProvider } from './provider.js';

export { createAgent } from './agent.js';
