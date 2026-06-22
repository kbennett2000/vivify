// Cycle 5 acceptance (docs/cycles/cycle-5-voice.md → "What is verified where",
// CI bullet): "the Node server end-to-end against a fake bridge ... request
// validation, ... response shape, GET /health, error paths". This drives a real
// http.Server on an ephemeral port via global fetch, with the bridge command
// pointed at the committed fake-bridge (a separate process / legitimate external
// test double, NOT a mock of the code under test). No Wine required.

import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVoiceServer, warmUp } from '../src/server.js';
import type { TtsTiming } from '../src/timing.js';

const fakeBridgePath = fileURLToPath(new URL('./fake-bridge.mjs', import.meta.url));
const slowExitBridgePath = fileURLToPath(new URL('./fake-bridge-slow-exit.mjs', import.meta.url));
const detachedHolderBridgePath = fileURLToPath(
  new URL('./fake-bridge-detached-holder.mjs', import.meta.url),
);
const failBridgePath = fileURLToPath(new URL('./fail-bridge.mjs', import.meta.url));
const hangBridgePath = fileURLToPath(new URL('./hang-bridge.mjs', import.meta.url));
const continuousCapturePath = fileURLToPath(
  new URL('./fake-capture-continuous.mjs', import.meta.url),
);
const emptyCapturePath = fileURLToPath(new URL('./fake-capture-empty.mjs', import.meta.url));

// Cycle 11 follow-up: the per-request `parec` became ONE PERSISTENT capture source that
// the server WINDOWS per request. fake-capture-continuous streams raw s16 PCM continuously
// (a small chunk every ~20ms), so a window opened at any moment captures samples the server
// wraps + trims into the WAV. A small grace keeps tests fast.
const captureCommand = `node ${continuousCapturePath}`;
const captureGraceMs = 20;
// Cycle 11 follow-up: the readiness GATE is gone (the persistent source is always live);
// captureReadyTimeoutMs now only governs a warn log. A small value is harmless. warmOnStart
// is OFF so tests don't run a background warmup synthesis, and captureRespawn is OFF so the
// fake reader isn't respawned after the server tears it down.
const captureReadyTimeoutMs = 1000;
const captureRespawn = false;
const warmOnStart = false;

// Common opts every server in this suite shares (persistent continuous capture, no warmup,
// no respawn). Spread into each createVoiceServer call alongside its bridge.
const baseCaptureOpts = {
  captureCommand,
  captureGraceMs,
  captureReadyTimeoutMs,
  captureRespawn,
  warmOnStart,
} as const;

interface TtsResponse {
  audioWavBase64: string;
  mouthTimeline: Array<{ timeMs: number; shape: number; width?: number }>;
  format: string;
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('expected an AddressInfo from listen(0)'));
        return;
      }
      resolve(addr.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('voice-server HTTP layer (fake bridge)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('GET /health → 200 {ok:true}', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /tts with a valid body → 200 with format "wav" and a RIFF/WAVE audio payload', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Your wish is my command.',
        voice: { engineModeId: 'GENIE', speed: 157, pitch: 100 },
      }),
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as TtsResponse;
    expect(json.format).toBe('wav');

    // Cycle 11 follow-up: the WAV is built from the PERSISTENT capture window's raw PCM
    // (continuously streamed silence + tone bursts), wrapped + trimmed by the server —
    // NOT produced by the bridge. It must still base64-decode to a real RIFF/WAVE.
    const wav = Buffer.from(json.audioWavBase64, 'base64');
    expect(wav.length).toBeGreaterThanOrEqual(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // mouthTimeline is the bridge's 3 canned events, normalized to {timeMs, shape,
    // width} — the mouth WIDTH (from the bridge's nested mouth.width) is now carried
    // for the authentic VoiceMouthOverlay(height,width) mapping.
    expect(json.mouthTimeline).toEqual([
      { timeMs: 0, shape: 0, width: 0 },
      { timeMs: 50, shape: 5, width: 3 },
      { timeMs: 120, shape: 2, width: 4 },
    ]);
  });

  it('POST /tts works when voice is omitted (engine defaults)', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as TtsResponse;
    expect(json.format).toBe('wav');
    expect(json.mouthTimeline.length).toBe(3);
  });

  it('POST /tts with missing text → 400', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /tts with empty text → 400', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /tts with a non-string text → 400', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /tts with invalid JSON → 400', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });

  it('unknown route → 404', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it('GET /tts (wrong method) → 404', async () => {
    const res = await fetch(`${baseUrl}/tts`);
    expect(res.status).toBe(404);
  });
});

describe('voice-server latency instrumentation (Cycle 10, fake bridge)', () => {
  let server: Server;
  let baseUrl: string;
  let captured: TtsTiming | undefined;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
      onTiming: (t) => {
        captured = t;
      },
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('onTiming receives the parsed bridge stages + server stages for a /tts request', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'measure me' }),
    });
    expect(res.status).toBe(200);

    // The callback fired with the request's timing.
    expect(captured).toBeDefined();
    const t = captured as TtsTiming;

    // Bridge stages came from the fake bridge's `[timing]` stderr line, parsed by
    // the server (NOT injected by this test) — assert the values from that line
    // (Cycle 11 single-pass: no passB_*).
    expect(t.bridge).not.toBeNull();
    expect(t.bridge?.passATotalMs).toBe(300);
    expect(t.bridge?.totalMs).toBe(320);

    // Server-observed stages are real wall-clock measurements: present and non-negative.
    // Cycle 11 follow-up: the per-request captureReadyMs/captureMs/captureStopMs stages are
    // GONE (the persistent source has no per-request spawn / stop); a single
    // windowFirstByteMs (beginWindow → first buffered chunk) replaces them, alongside
    // bridgeMs/wineLoadMs/buildMs/encodeMs/totalMs.
    for (const v of [
      t.bridgeMs,
      t.wineLoadMs,
      t.windowFirstByteMs,
      t.buildMs,
      t.encodeMs,
      t.totalMs,
    ]) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('voice-server bridge-failure path', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // The persistent capture still streams and must be torn down even though the bridge fails.
    server = createVoiceServer({
      bridgeCommand: `node ${failBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 500 when the bridge exits non-zero', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'this will fail' }),
    });
    expect(res.status).toBe(500);
  });
});

describe('voice-server bridge timeout', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // A bridge that hangs forever (never writes output, never exits) — the server
    // must kill it and fail the request rather than pinning the connection open.
    server = createVoiceServer({
      bridgeCommand: `node ${hangBridgePath}`,
      ...baseCaptureOpts,
      bridgeTimeoutMs: 200,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 500 when the bridge exceeds the timeout', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'this will hang' }),
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('timed out');
  });
});

describe('voice-server empty-window path (Cycle 11 follow-up honest failure)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // The bridge would succeed, but the persistent capture source emits NO bytes ever
    // (fake-capture-empty). The window therefore closes empty, and the server fails the
    // request loudly rather than returning a faked silent WAV. There is no readiness gate
    // anymore: the request runs the bridge, then the empty window → 500.
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
      captureCommand: `node ${emptyCapturePath}`,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 500 when the capture window is empty (no PCM streamed)', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'nothing was captured' }),
    });
    expect(res.status).toBe(500);
    // An empty window is the honest-failure path: "null-sink capture window was empty …".
    // Pin the wording so the test fails if it ever silently takes a different error path.
    expect(((await res.json()) as { error: string }).error).toMatch(/capture window was empty/);
  });
});

describe('voice-server CORS (browser access)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('OPTIONS preflight reflects the request Origin (any localhost port) → 204', async () => {
    const origin = 'http://localhost:5174'; // Vite's "next free port" — must not be hardcoded away
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('reflects the Origin on a normal response and sets Vary: Origin', async () => {
    const origin = 'http://localhost:61234';
    const res = await fetch(`${baseUrl}/health`, { headers: { origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('falls back to * when there is no Origin (curl / same-origin)', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('voice-server skips bridge teardown (Cycle 11 follow-up: SIGKILL on [timing])', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // The slow-exit bridge writes the timeline + emits `[timing]`, then SLEEPS ~3000ms
    // before exiting (simulating Wine's slow teardown). The server's fix watches stderr
    // and SIGKILLs the bridge the moment it sees `[timing]`, so the request must NOT wait
    // out that 3s close. The capture is the normal fast fake.
    server = createVoiceServer({
      bridgeCommand: `node ${slowExitBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 200 well before the bridge’s 3000ms slow exit (server SIGKILLs on [timing])', async () => {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'kill me on timing, do not wait for teardown' }),
    });
    const elapsedMs = Date.now() - t0;

    expect(res.status).toBe(200);

    const json = (await res.json()) as TtsResponse;
    // Valid RIFF/WAVE built from the capture (proves the timeline file written BEFORE the
    // `[timing]` print is readable after the SIGKILL — the kill races nothing on disk).
    const wav = Buffer.from(json.audioWavBase64, 'base64');
    expect(wav.length).toBeGreaterThanOrEqual(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // The 3 canned events still round-trip — the bridge's useful work completed before kill.
    expect(json.mouthTimeline).toEqual([
      { timeMs: 0, shape: 0, width: 0 },
      { timeMs: 50, shape: 5, width: 3 },
      { timeMs: 120, shape: 2, width: 4 },
    ]);

    // The deterministic proof of the teardown-skip fix: the bridge sleeps 3000ms before
    // exiting, but the server SIGKILLed it on `[timing]`, so the whole request finishes
    // well under that. The only real work is the 20ms capture grace + trivial I/O.
    expect(elapsedMs).toBeLessThan(1500);
  });
});

describe('voice-server resolves on [timing], not on bridge close', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // fake-bridge-detached-holder replicates WINE: it emits `[timing]`, then exits
    // immediately BUT leaves a detached grandchild holding the stderr pipe open ~3000ms,
    // so the server-side stderr stream's 'end'/'close' is delayed ~3s even though the
    // bridge process is already gone. If the server (regressed) waited for 'close', the
    // request would block ~3s. The fix resolves the instant `[timing]` lands on stderr.
    server = createVoiceServer({
      bridgeCommand: `node ${detachedHolderBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 200 well before the stderr pipe closes (~3s), proving resolve-on-[timing]', async () => {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'resolve on timing, not on pipe close' }),
    });
    const elapsedMs = Date.now() - t0;

    expect(res.status).toBe(200);

    const json = (await res.json()) as TtsResponse;
    expect(json.format).toBe('wav');

    // Valid RIFF/WAVE built from the capture (the timeline written BEFORE the `[timing]`
    // print is readable after the server SIGKILLs the bridge in the background).
    const wav = Buffer.from(json.audioWavBase64, 'base64');
    expect(wav.length).toBeGreaterThanOrEqual(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // The 3 canned events still round-trip.
    expect(json.mouthTimeline).toEqual([
      { timeMs: 0, shape: 0, width: 0 },
      { timeMs: 50, shape: 5, width: 3 },
      { timeMs: 120, shape: 2, width: 4 },
    ]);

    // The deterministic proof: the stderr pipe stays open ~3000ms (the detached holder),
    // but the server resolved on the `[timing]` LINE — not on pipe-close — so the request
    // finishes well under that. (Only the 20ms capture grace + trivial I/O is real work.)
    expect(elapsedMs).toBeLessThan(1500);
  });
});

describe('warmUp (Cycle 11 follow-up: prime the pipeline, best-effort)', () => {
  // warmUp creates its OWN throwaway persistent source (respawn:false), runs one synth,
  // and stops it — so it doesn't take warmOnStart/captureRespawn.
  it('resolves without throwing against a working bridge + capture', async () => {
    await expect(
      warmUp({
        bridgeCommand: `node ${fakeBridgePath}`,
        captureCommand,
        captureGraceMs,
        captureReadyTimeoutMs,
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows errors and still resolves when the capture window is empty (best-effort)', async () => {
    // fake-capture-empty never streams a byte → the window is empty → synthesize() rejects,
    // but warmUp must swallow that (a cold first Speak, never a crash).
    await expect(
      warmUp({
        bridgeCommand: `node ${fakeBridgePath}`,
        captureCommand: `node ${emptyCapturePath}`,
        captureGraceMs,
        captureReadyTimeoutMs,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('voice-server startup warmup waits for the reader', () => {
  // Cycle 11 follow-up: the startup warmup must AWAIT source.whenLive(...) (inside the
  // serialize mutex) BEFORE running the warmup synthesize — otherwise it fires immediately
  // after source.start() and races the reader (empty window → `[warmup] failed`). With the
  // continuous fake (which streams immediately) whenLive resolves and the warmup must
  // actually RUN and COMPLETE: a `[warmup] done` line, with NO `[warmup] skipped` /
  // `[warmup] failed … reader not live` line.
  let server: Server | undefined;
  let logSpy: ReturnType<typeof vi.spyOn> | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
  const lines: string[] = [];

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
    logSpy?.mockRestore();
    warnSpy?.mockRestore();
  });

  it('runs the warmup synth once the persistent reader is live (no skip / no reader-not-live failure)', async () => {
    const collect = (...args: unknown[]): void => {
      lines.push(args.map((a) => String(a)).join(' '));
    };
    // Spy BEFORE creating the server so we capture the warmup's logs, which fire on the
    // background mutex chain kicked off inside createVoiceServer().
    logSpy = vi.spyOn(console, 'log').mockImplementation(collect);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(collect);

    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      captureCommand: `node ${continuousCapturePath}`,
      captureGraceMs: 20,
      captureReadyTimeoutMs: 2000,
      captureRespawn: false,
      warmOnStart: true,
    });
    // Listen on an ephemeral port so afterEach's closeServer() has a running server to close
    // (which also tears the persistent capture reader down). The warmup runs regardless of
    // listen(); we don't send any request — we only observe its logs.
    await listenOnEphemeralPort(server);

    // Poll the captured logs (bounded ~4s) for the terminal `[warmup]` line. The warmup is
    // a best-effort background chain, so we wait for it to settle deterministically rather
    // than racing a fixed sleep.
    const isTerminal = (line: string): boolean =>
      line.includes('[warmup] done') ||
      line.includes('[warmup] failed') ||
      line.includes('[warmup] skipped');
    const deadline = Date.now() + 4000;
    while (!lines.some(isTerminal) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // The warmup COMPLETED: a `[warmup] done` line is present...
    expect(lines.some((l) => l.includes('[warmup] done'))).toBe(true);
    // ...and it neither skipped (reader-not-live) nor failed on a not-live reader. (The
    // continuous fake streams immediately, so whenLive resolved and the synth ran.)
    expect(lines.some((l) => l.includes('[warmup] skipped'))).toBe(false);
    expect(lines.some((l) => l.includes('[warmup] failed'))).toBe(false);
    // The warmup also logs its own audio metric, proving the synth actually ran (not skipped).
    expect(lines.some((l) => l.includes('[warmup tts-audio]'))).toBe(true);
  });
});

describe('voice-server disk cache (Cycle 12: repeat is served from disk)', () => {
  // With a cacheDir configured, the first /tts for a phrase synthesizes (via the fake bridge)
  // and writes the payload to disk; an IDENTICAL second /tts is served from disk — byte-identical
  // body, `cache:'hit'` timing, and NO bridge work (bridge stage is null, synth stages are 0). A
  // different voice is a separate key → miss. Each test uses its own temp cache dir.
  let server: Server;
  let baseUrl: string;
  let cacheDir: string;
  const timings: TtsTiming[] = [];

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'vivify-server-cache-'));
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
      cacheDir,
      onTiming: (t) => {
        timings.push(t);
      },
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
    await rm(cacheDir, { recursive: true, force: true });
  });

  const postTts = (body: unknown): Promise<Response> =>
    fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('first request misses (synthesizes), identical second request hits (byte-identical, no bridge)', async () => {
    timings.length = 0;
    const reqBody = { text: 'cache me please', voice: { engineModeId: 'GENIE', speed: 157 } };

    const first = await postTts(reqBody);
    expect(first.status).toBe(200);
    const firstBytes = Buffer.from(await first.arrayBuffer());

    const second = await postTts(reqBody);
    expect(second.status).toBe(200);
    const secondBytes = Buffer.from(await second.arrayBuffer());

    // The cached response is byte-for-byte identical to the synthesized one.
    expect(secondBytes.equals(firstBytes)).toBe(true);

    // Two timings fired: a miss then a hit (the observable for the [tts-timing] marker).
    expect(timings.length).toBe(2);
    const missTiming = timings[0]!;
    const hitTiming = timings[1]!;
    expect(missTiming.cache).toBe('miss');
    expect(missTiming.bridge).not.toBeNull(); // the miss actually ran the bridge

    expect(hitTiming.cache).toBe('hit');
    // A hit bypasses synthesis entirely: no bridge stages, synth stages are 0.
    expect(hitTiming.bridge).toBeNull();
    expect(hitTiming.bridgeMs).toBe(0);
    expect(hitTiming.windowFirstByteMs).toBe(0);
    expect(typeof hitTiming.diskReadMs).toBe('number');
  });

  it('a different voice for the same text is a separate key → miss (no collision)', async () => {
    timings.length = 0;
    const text = 'same text, different voice';

    const a = await postTts({ text, voice: { engineModeId: 'GENIE' } });
    expect(a.status).toBe(200);
    const b = await postTts({ text, voice: { engineModeId: 'ROBBY' } });
    expect(b.status).toBe(200);

    // Both miss — they don't share a cache entry.
    expect(timings.map((t) => t.cache)).toEqual(['miss', 'miss']);

    // ...and a repeat of the FIRST voice now hits (proving it was cached under its own key).
    const aAgain = await postTts({ text, voice: { engineModeId: 'GENIE' } });
    expect(aAgain.status).toBe(200);
    expect(timings[timings.length - 1]?.cache).toBe('hit');
  });
});

describe('voice-server without a cache (default: no cacheDir → cache undefined)', () => {
  let server: Server;
  let baseUrl: string;
  let lastTiming: TtsTiming | undefined;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
      onTiming: (t) => {
        lastTiming = t;
      },
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('serves /tts normally and reports no cache marker when caching is disabled', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'no cache here' }),
    });
    expect(res.status).toBe(200);
    expect(lastTiming?.cache).toBeUndefined();
  });
});

describe('voice-server serializes concurrent /tts (one capture window at a time)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      ...baseCaptureOpts,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('two concurrent POST /tts both return 200 with valid RIFF/WAVE (run one-at-a-time, no corruption)', async () => {
    const post = (text: string): Promise<Response> =>
      fetch(`${baseUrl}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });

    // Fire both at once; the server serializes the capture windows so neither corrupts the
    // other's PCM. Both must still produce a valid RIFF/WAVE from their own window.
    const [a, b] = await Promise.all([post('first concurrent'), post('second concurrent')]);

    for (const res of [a, b]) {
      expect(res.status).toBe(200);
      const json = (await res.json()) as TtsResponse;
      expect(json.format).toBe('wav');
      const wav = Buffer.from(json.audioWavBase64, 'base64');
      expect(wav.length).toBeGreaterThanOrEqual(44);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    }
  });
});
