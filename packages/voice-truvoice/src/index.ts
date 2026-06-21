// @vivify/voice-truvoice — the authentic-voice TtsProvider. Talks to the
// Dockerized Wine + SAPI4 + L&H TruVoice service (Cycle 5) and returns
// { audio (WAV), mouthTimeline } for the engine's lip-sync (Cycle 6).
//
// Isomorphic (browser + Node 20+): uses the global fetch + atob. The voice
// server URL + an optional fetch override are injected, so it's testable
// against a fake HTTP server with no real engine.

import type { MouthEvent, TtsProvider, TtsResult, VoiceConfig } from '@vivify/types';

export interface TruVoiceOptions {
  /** Base URL of the voice server (e.g. http://localhost:8080). */
  url: string;
  /** Override for fetch (tests inject one; defaults to globalThis.fetch). */
  fetch?: typeof fetch;
}

/** Shape of the voice server's POST /tts response. */
interface TtsResponse {
  audioWavBase64?: string;
  mouthTimeline?: unknown;
  format?: string;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (b64.length === 0) return new ArrayBuffer(0);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Tolerant normalize of the server's mouthTimeline into MouthEvent[]. */
function normalizeTimeline(raw: unknown): MouthEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: MouthEvent[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>;
      const timeMs = rec.timeMs;
      const shape = rec.shape;
      const width = rec.width;
      if (
        typeof timeMs === 'number' &&
        Number.isFinite(timeMs) &&
        typeof shape === 'number' &&
        Number.isFinite(shape)
      ) {
        const event: MouthEvent = { timeMs, shape };
        if (typeof width === 'number' && Number.isFinite(width)) event.width = width;
        out.push(event);
      }
    }
  }
  return out;
}

/**
 * TtsProvider backed by the TruVoice voice server. `speak` POSTs to `${url}/tts`
 * and returns the decoded WAV + mouth timeline. Passing the engine's AbortSignal
 * cancels the in-flight request (so stop() interrupts synthesis mid-flight).
 */
export class TruVoiceProvider implements TtsProvider {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: TruVoiceOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async speak(text: string, voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult> {
    const res = await this.fetchFn(`${this.url}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`voice server responded ${res.status}`);
    }
    const data = (await res.json()) as TtsResponse;
    return {
      audio: base64ToArrayBuffer(data.audioWavBase64 ?? ''),
      mouthTimeline: normalizeTimeline(data.mouthTimeline),
    };
  }
}

/**
 * Audible no-backend fallback using the browser's Web Speech API. It speaks via
 * `speechSynthesis` and returns an empty result (no WAV / no timeline), so the
 * engine runs its heuristic mouth animation alongside. Fire-and-forget: resolves
 * immediately; an AbortSignal cancels the utterance. Outside a browser (or with
 * no speech support) it's a silent no-op.
 */
export class WebSpeechProvider implements TtsProvider {
  speak(text: string, _voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult> {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    const Utterance = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance;
    if (synth && Utterance && text.length > 0) {
      synth.cancel();
      synth.speak(new Utterance(text));
      if (signal) {
        signal.addEventListener('abort', () => synth.cancel(), { once: true });
      }
    }
    return Promise.resolve({ audio: new ArrayBuffer(0), mouthTimeline: [] });
  }
}

export const name = '@vivify/voice-truvoice';
