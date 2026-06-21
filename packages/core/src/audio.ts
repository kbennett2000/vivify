// Audio playback abstraction so the engine stays framework-agnostic and testable.
// The default WebAudioSink uses the Web Audio API (precise currentTime for
// lip-sync); tests inject a fake sink driven by the FakeClock. The engine only
// plays audio in the browser (where a provider yields a real WAV); in Node tests
// the audio path runs against the injected fake.

/** A handle to one in-progress playback. */
export interface AudioHandle {
  /** Current playback position, in milliseconds from the start. */
  currentTimeMs(): number;
  /** Total duration in milliseconds (0 if unknown). */
  durationMs(): number;
  /** Resolves when playback finishes naturally. */
  readonly ended: Promise<void>;
  /** Stop playback immediately (idempotent). */
  stop(): void;
}

/** Decodes + plays a WAV buffer. */
export interface AudioSink {
  /** Begin playing `wav`; resolves with a handle once playback has started. */
  play(wav: ArrayBuffer): Promise<AudioHandle>;
}

/** Default browser sink: Web Audio API. Lazily creates a single AudioContext. */
export class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null;

  async play(wav: ArrayBuffer): Promise<AudioHandle> {
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === 'suspended') await ctx.resume();
    // decodeAudioData may detach the buffer; decode a copy so callers keep theirs.
    const buffer = await ctx.decodeAudioData(wav.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startedAt = ctx.currentTime;
    const durationMs = buffer.duration * 1000;
    let stopped = false;
    let resolveEnded!: () => void;
    const ended = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    source.onended = () => resolveEnded();
    source.start();

    return {
      currentTimeMs: () =>
        stopped ? durationMs : Math.max(0, (ctx.currentTime - startedAt) * 1000),
      durationMs: () => durationMs,
      ended,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source.stop();
        } catch {
          // already stopped/ended
        }
        resolveEnded();
      },
    };
  }
}
