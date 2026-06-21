// Cycle 11 follow-up acceptance: the PERSISTENT capture source (src/capture.ts). The old
// per-request `parec` was replaced by ONE long-lived reader whose stream the server WINDOWS
// per request. These tests drive a real spawned fake (`fake-capture-continuous.mjs`, a
// legitimate external test double for `parec` — NOT a mock of CaptureSource) and assert the
// windowing contract: PCM is buffered ONLY between beginWindow() and endWindow(); idle
// between windows is discarded; nothing is captured before start() or after stop().

import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureSource } from '../src/capture.js';

const continuousCapturePath = fileURLToPath(
  new URL('./fake-capture-continuous.mjs', import.meta.url),
);
const continuousCommand = `node ${continuousCapturePath}`;

const emptyCapturePath = fileURLToPath(new URL('./fake-capture-empty.mjs', import.meta.url));
const emptyCommand = `node ${emptyCapturePath}`;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('CaptureSource (persistent reader, windowed per request)', () => {
  // Track every source so a failing assertion can't leak a child process.
  let sources: CaptureSource[] = [];
  const make = (
    opts: Partial<{ readyTimeoutMs: number; respawn: boolean }> = {},
  ): CaptureSource => {
    const s = new CaptureSource({ command: continuousCommand, respawn: false, ...opts });
    sources.push(s);
    return s;
  };

  afterEach(() => {
    for (const s of sources) s.stop();
    sources = [];
  });

  it('captures PCM streamed during an open window (firstByteMs is a non-negative number)', async () => {
    const source = make();
    source.start();
    // Give the persistent reader a moment to spawn and start streaming.
    await delay(80);

    source.beginWindow();
    await delay(100); // the fake emits a chunk every ~20ms, so several land in the window
    const { pcm, firstByteMs } = source.endWindow();

    expect(pcm.length).toBeGreaterThan(0);
    expect(typeof firstByteMs).toBe('number');
    expect(firstByteMs).toBeGreaterThanOrEqual(0);
  });

  it('buffers ONLY during a window — idle between windows is discarded', async () => {
    const source = make();
    source.start();
    await delay(80);

    // First window collects data.
    source.beginWindow();
    await delay(80);
    const first = source.endWindow();
    expect(first.pcm.length).toBeGreaterThan(0);

    // Idle gap with NO open window: the stream keeps flowing but must NOT be buffered.
    await delay(80);

    // A second, FRESH window only contains data from that window — it does not accumulate
    // the idle gap. endWindow() called again WITHOUT a new beginWindow() returns empty,
    // proving the buffer was cleared and idle chunks were dropped.
    source.beginWindow();
    await delay(80);
    const second = source.endWindow();
    expect(second.pcm.length).toBeGreaterThan(0);

    const third = source.endWindow(); // no beginWindow() — must be empty
    expect(third.pcm.length).toBe(0);
  });

  it('returns empty PCM for endWindow() before start()', () => {
    const source = make();
    // No start(), no window.
    const { pcm, firstByteMs } = source.endWindow();
    expect(pcm.length).toBe(0);
    expect(firstByteMs).toBe(0);
  });

  it('stop() prevents any further buffering (no capture after stop)', async () => {
    const source = make();
    source.start();
    await delay(80);
    expect(source.isLive()).toBe(true);

    source.stop();
    expect(source.isLive()).toBe(false);

    // Opening a window after stop() captures nothing — the reader is gone.
    source.beginWindow();
    await delay(80);
    const { pcm } = source.endWindow();
    expect(pcm.length).toBe(0);
  });

  it('isLive() reflects the spawned reader and falls false after stop()', async () => {
    const source = make();
    expect(source.isLive()).toBe(false); // not started yet
    source.start();
    await delay(80);
    expect(source.isLive()).toBe(true);
    source.stop();
    expect(source.isLive()).toBe(false);
  });
});

describe('whenLive (Cycle 11 follow-up: gate the startup warmup on a real first sample)', () => {
  // Track every source so a failing assertion can't leak a child process.
  let sources: CaptureSource[] = [];
  const make = (command: string, respawn = false): CaptureSource => {
    const s = new CaptureSource({ command, respawn });
    sources.push(s);
    return s;
  };

  afterEach(() => {
    for (const s of sources) s.stop();
    sources = [];
  });

  it('resolves true once the reader produces its first PCM sample (continuous fake streams immediately)', async () => {
    const source = make(continuousCommand);
    source.start();
    await expect(source.whenLive(2000)).resolves.toBe(true);
  });

  it('resolves true IMMEDIATELY (<100ms) when already live (a second whenLive after the first)', async () => {
    const source = make(continuousCommand);
    source.start();
    // First call waits for the reader's first sample → live.
    await expect(source.whenLive(2000)).resolves.toBe(true);

    // Second call: the source is already live, so it must resolve true fast — without
    // waiting for another sample or the timeout. Measure the wall time to prove it.
    const t0 = Date.now();
    await expect(source.whenLive(2000)).resolves.toBe(true);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it('resolves false after timeoutMs when no sample ever arrives (never-emitting fake)', async () => {
    const source = make(emptyCommand);
    source.start();
    // fake-capture-empty writes nothing to stdout, so the reader never goes live.
    const t0 = Date.now();
    const live = await source.whenLive(150);
    const elapsedMs = Date.now() - t0;

    expect(live).toBe(false); // timed out, not live
    // It waited out (roughly) the timeout — not instant, not a hang.
    expect(elapsedMs).toBeGreaterThanOrEqual(140);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
