// @vivify/voice-server — the authentic-voice backend: a Dockerized Wine + SAPI4
// + L&H TruVoice service. POST /tts {text, voice} → { audioWavBase64,
// mouthTimeline, format }. The HTTP layer lives here (Node); the SAPI4 engine is
// a C++ bridge run under Wine (bridge/sapi4-mouth.cpp). See docs/cycles/cycle-5-voice.md.
// vendor/ binaries + the Wine prefix are gitignored and never committed.

export const name = '@vivify/voice-server';

export { createVoiceServer, start } from './server.js';
export type { ServerOptions, SynthRequest } from './server.js';
export { voiceToBridgeArgs } from './voice-args.js';
export { parseTimeline } from './timeline.js';
export type { BridgeMouthEvent } from './timeline.js';
