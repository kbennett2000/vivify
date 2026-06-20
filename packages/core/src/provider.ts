// The pluggable TTS provider seam. @vivify/core never knows how speech is
// produced — it calls provider.speak(text, voice) and consumes the result
// uniformly for lip-sync. See ADR-0004 / ADR-0005.

import type { VoiceConfig } from './types.js';

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

/**
 * A no-op provider: produces no audio and an empty mouth timeline. Lets the
 * engine be exercised end-to-end without a real voice backend (Cycle 0).
 */
export class StubTtsProvider implements TtsProvider {
  async speak(_text: string, _voice: VoiceConfig): Promise<TtsResult> {
    return { audio: new ArrayBuffer(0), mouthTimeline: [] };
  }
}
