// A no-op TTS provider. The TtsProvider contract (and TtsResult/MouthEvent)
// lives in @vivify/types; this is the engine's bundled stub implementation so
// the queue/lip-sync path can be exercised without a real voice backend.
// See ADR-0004 / ADR-0005 / ADR-0008.

import type { TtsProvider, TtsResult, VoiceConfig } from '@vivify/types';

/**
 * A no-op provider: produces no audio and an empty mouth timeline. Lets the
 * engine be exercised end-to-end without a real voice backend (Cycle 0).
 */
export class StubTtsProvider implements TtsProvider {
  async speak(_text: string, _voice: VoiceConfig, _signal?: AbortSignal): Promise<TtsResult> {
    return { audio: new ArrayBuffer(0), mouthTimeline: [] };
  }
}
