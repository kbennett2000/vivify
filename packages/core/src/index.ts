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
export { createAgent, createAgentFromModel } from './agent.js';
export type { CreateAgentOptions } from './agent.js';

// Engine building blocks (pure; useful for advanced consumers and tested directly).
export { Playback, nextFrameIndex, playableLength } from './playback.js';
export type { Rng, PlaybackOptions } from './playback.js';
export { ActionQueue } from './queue.js';
export type { QueuedAction } from './queue.js';
export { wrapText } from './wrap.js';
export { animationForState, directionTo, moveState, gestureState } from './states.js';
export type { Direction } from './states.js';
export { realClock } from './clock.js';
export type { Clock } from './clock.js';
export { WebAudioSink } from './audio.js';
export type { AudioSink, AudioHandle } from './audio.js';
export { activeMouthEvent, chooseOverlay, interpolatedShape, SHAPE_MAX } from './lipsync.js';

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
  FrameMouthOverlay,
  SoundModel,
  BalloonConfig,
  VoiceConfig,
  TtsProvider,
  TtsResult,
  MouthEvent,
} from '@vivify/types';
