// Cycle 11 — a PERSISTENT capture source. Earlier the server spawned a fresh `parec` per
// /tts request and gated synthesis on its first sample; that per-request process spawn +
// PulseAudio stream setup had highly variable latency (`captureReady` swung 600↔1700ms),
// which was the remaining variable Speak latency. Instead, run ONE long-lived `parec`
// reading the null sink's `.monitor` for the container's lifetime and WINDOW its stream per
// request: no per-request spawn ⇒ no variance, and the capture is always live (the original
// start-race stays solved). PCM is buffered ONLY while a window is open, so idle silence
// between requests is discarded and memory stays bounded. The command is injectable, so CI
// drives it against a continuous fake — no Wine/PulseAudio.

import { spawn, type ChildProcess } from 'node:child_process';

export interface CaptureSourceOptions {
  /** Full capture command (the persistent monitor reader, e.g. `parec -d dummy.monitor …`). */
  command: string;
  /** Warn if no sample arrives within this many ms of a (re)start. Default 5000. */
  readyTimeoutMs?: number;
  /** Respawn the reader if it dies (default true; tests disable it). */
  respawn?: boolean;
}

export interface CaptureWindow {
  /** The PCM captured between beginWindow() and endWindow(). */
  pcm: Buffer;
  /** beginWindow() → first buffered chunk, ms — should be ~tens of ms and STABLE (the proof the
   *  old per-request captureReady variance is gone). 0 if no chunk arrived. */
  firstByteMs: number;
}

/**
 * One long-lived `parec` whose monitor stream the server windows per request. The capture is
 * always streaming (silence when idle, audio when the engine plays); a window simply collects
 * the chunks that arrive between begin and end.
 */
export class CaptureSource {
  private proc: ChildProcess | null = null;
  private chunks: Buffer[] = [];
  private capturing = false;
  private windowStart = 0;
  private windowFirstByteAt = 0;
  private stopped = false;
  private stderr = '';
  private respawns = 0; // consecutive respawns without going live (drives backoff)
  private live = false; // has the reader produced any sample yet?
  private liveWaiters: Array<() => void> = []; // resolved when `live` first becomes true
  private readonly command: string;
  private readonly readyTimeoutMs: number;
  private readonly respawn: boolean;

  constructor(opts: CaptureSourceOptions) {
    this.command = opts.command;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 5000;
    this.respawn = opts.respawn ?? true;
  }

  /** Spawn the persistent reader. Idempotent-ish: a no-op once stopped. */
  start(): void {
    if (this.stopped) return;
    const parts = this.command.split(/\s+/).filter(Boolean);
    const program = parts[0];
    if (!program) throw new Error('voice-server: empty capture command');
    const proc = spawn(program, parts.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    const readyTimer = setTimeout(() => {
      if (!this.live)
        console.warn(
          `[capture] no sample within ${this.readyTimeoutMs}ms — is the null sink live and ` +
            `streaming to its monitor? (parec: ${this.stderr.trim().slice(0, 200) || 'no stderr'})`,
        );
    }, this.readyTimeoutMs);
    readyTimer.unref?.();

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (!this.live) {
        this.live = true;
        this.respawns = 0; // a healthy reader resets the backoff
        clearTimeout(readyTimer);
        console.log('[capture] persistent monitor reader is live');
        const waiters = this.liveWaiters;
        this.liveWaiters = [];
        for (const w of waiters) w();
      }
      if (this.capturing) {
        if (this.windowFirstByteAt === 0) this.windowFirstByteAt = Date.now();
        this.chunks.push(chunk);
      }
    });
    proc.stderr?.on('data', (chunk) => {
      this.stderr += String(chunk);
    });

    const onEnd = (): void => {
      clearTimeout(readyTimer);
      if (this.proc === proc) {
        this.proc = null;
        this.live = false; // a new spawn must prove itself live again before `whenLive` resolves
      }
      if (this.stopped || !this.respawn) return;
      // Exponential backoff capped at 5s so a genuinely-dead monitor (bad command, sink never
      // enumerable) doesn't respawn in a tight loop; escalate the log past a few failures so it's
      // not a silent forever-loop. `respawns` resets to 0 once a reader actually goes live.
      const backoffMs = Math.min(250 * 2 ** this.respawns, 5000);
      this.respawns++;
      const msg = `[capture] monitor reader exited (attempt ${this.respawns}) — respawning in ${backoffMs}ms`;
      if (this.respawns >= 5)
        console.error(`${msg} (the null-sink monitor keeps dying — check parec/pulse)`);
      else console.warn(msg);
      const t = setTimeout(() => this.start(), backoffMs);
      t.unref?.();
    };
    proc.on('close', onEnd);
    proc.on('error', onEnd);
  }

  /** Open a capture window: start buffering incoming PCM. (Serialize /tts so only one is open.) */
  beginWindow(): void {
    this.chunks = [];
    this.windowFirstByteAt = 0;
    this.windowStart = Date.now();
    this.capturing = true;
  }

  /** Close the window and return the captured PCM + the window's first-byte latency. */
  endWindow(): CaptureWindow {
    this.capturing = false;
    const pcm = Buffer.concat(this.chunks);
    const firstByteMs = this.windowFirstByteAt ? this.windowFirstByteAt - this.windowStart : 0;
    this.chunks = [];
    return { pcm, firstByteMs };
  }

  /** Stop buffering + discard, without returning anything (failure-path backstop). */
  abortWindow(): void {
    this.capturing = false;
    this.chunks = [];
  }

  /** Is the reader process currently alive (point-in-time)? */
  isLive(): boolean {
    return this.proc !== null;
  }

  /**
   * Resolve `true` once the reader has actually produced a PCM sample (the monitor is streaming),
   * or `false` after `timeoutMs` (best-effort — never hangs). Used to gate the startup warmup so it
   * runs a real, non-empty capture window instead of racing the reader's connect. Resolves
   * immediately if already live.
   */
  whenLive(timeoutMs: number): Promise<boolean> {
    if (this.live) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      this.liveWaiters.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Stop the reader for good (server shutdown). */
  stop(): void {
    this.stopped = true;
    this.capturing = false;
    this.chunks = [];
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) this.proc.kill('SIGTERM');
    this.proc = null;
  }
}
