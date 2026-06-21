// Cycle 5 acceptance (docs/cycles/cycle-5-voice.md → "What is verified where",
// CI bullet): "the Node server end-to-end against a fake bridge ... request
// validation, ... response shape, GET /health, error paths". This drives a real
// http.Server on an ephemeral port via global fetch, with the bridge command
// pointed at the committed fake-bridge (a separate process / legitimate external
// test double, NOT a mock of the code under test). No Wine required.

import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVoiceServer, warmUp } from '../src/server.js';
import type { TtsTiming } from '../src/timing.js';

const fakeBridgePath = fileURLToPath(new URL('./fake-bridge.mjs', import.meta.url));
const slowExitBridgePath = fileURLToPath(new URL('./fake-bridge-slow-exit.mjs', import.meta.url));
const failBridgePath = fileURLToPath(new URL('./fail-bridge.mjs', import.meta.url));
const hangBridgePath = fileURLToPath(new URL('./hang-bridge.mjs', import.meta.url));
const fakeCapturePath = fileURLToPath(new URL('./fake-capture.mjs', import.meta.url));
const emptyCapturePath = fileURLToPath(new URL('./fake-capture-empty.mjs', import.meta.url));
const slowCapturePath = fileURLToPath(new URL('./fake-capture-slow.mjs', import.meta.url));

// Cycle 11: every server runs the single-pass flow — a timeline-only bridge plus a
// capture process that streams raw PCM. The fake-capture emits leading-silence +
// tone PCM the server wraps + trims into the WAV; a small grace keeps tests fast.
const captureCommand = `node ${fakeCapturePath}`;
const captureGraceMs = 20;
// Cycle 11 fix: the readiness gate waits for the capture's first sample before spawning
// the bridge. fake-capture emits immediately, so 1000ms is generous headroom for the
// happy path while keeping the timeout-path tests fast where they set a tighter value.
const captureReadyTimeoutMs = 1000;

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
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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

    // Cycle 11: the WAV is built from the fake-capture's raw PCM (leading silence +
    // tone), wrapped + trimmed by the server — NOT produced by the bridge. It must
    // still base64-decode to a real RIFF/WAVE container.
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
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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

    // Server-observed stages are real wall-clock measurements: present and
    // non-negative (Cycle 11: readMs is gone, replaced by capture/wineLoad; the
    // Cycle 11 fix adds captureReadyMs — parec spawn → its first sample).
    for (const v of [
      t.bridgeMs,
      t.wineLoadMs,
      t.captureReadyMs,
      t.captureMs,
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
    // The capture still runs and must be torn down even though the bridge fails.
    server = createVoiceServer({
      bridgeCommand: `node ${failBridgePath}`,
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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

describe('voice-server empty-capture path (Cycle 11 honest failure via readiness gate)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // The bridge would succeed, but the capture stays alive and produces NO samples.
    // Cycle 11 fix: synthesis is gated on the capture's first sample, so this never
    // reaches the bridge — the readiness gate times out and the request fails loudly
    // (never a faked silent WAV). A short captureReadyTimeoutMs keeps this fast.
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      captureCommand: `node ${emptyCapturePath}`,
      captureGraceMs,
      captureReadyTimeoutMs: 300,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 500 when the capture never produces a sample (readiness timeout)', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'nothing was captured' }),
    });
    expect(res.status).toBe(500);
    // fake-capture-empty stays alive emitting nothing, so this is the readiness-TIMEOUT
    // path specifically: "null-sink capture produced no sample within <n>ms …". Pin to that
    // wording so the test fails if it ever silently takes a different error path.
    expect(((await res.json()) as { error: string }).error).toMatch(/no sample within/);
  });
});

describe('voice-server slow-capture path (Cycle 11 readiness gate WAITS)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // fake-capture-slow delays its first PCM chunk by DELAY_MS (~150ms) then streams
    // the same leading-silence + tone PCM. With a generous captureReadyTimeoutMs the
    // server must WAIT for that first sample (not fail, not clip), then run the bridge
    // and return the captured audio — proving the gate waits for a slow-but-working
    // capture rather than racing the opening words.
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      captureCommand: `node ${slowCapturePath}`,
      captureGraceMs,
      captureReadyTimeoutMs: 2000,
    });
    const port = await listenOnEphemeralPort(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('POST /tts → 200 with valid RIFF/WAVE when the capture is slow but eventually streams', async () => {
    const res = await fetch(`${baseUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'wait for the capture to wake up' }),
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as TtsResponse;
    expect(json.format).toBe('wav');

    // The audio still arrives after the gate waits ~150ms — a real RIFF/WAVE built from
    // the slow capture's PCM, not a clipped/empty buffer.
    const wav = Buffer.from(json.audioWavBase64, 'base64');
    expect(wav.length).toBeGreaterThan(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  });
});

describe('voice-server CORS (browser access)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({
      bridgeCommand: `node ${fakeBridgePath}`,
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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
      captureCommand,
      captureGraceMs,
      captureReadyTimeoutMs,
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

describe('warmUp (Cycle 11 follow-up: prime the pipeline, best-effort)', () => {
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

  it('swallows errors and still resolves when the capture produces no audio (best-effort)', async () => {
    // fake-capture-empty never streams a sample → synthesize() rejects, but warmUp must
    // swallow that (a cold first Speak, never a crash). A short readiness timeout keeps it fast.
    await expect(
      warmUp({
        bridgeCommand: `node ${fakeBridgePath}`,
        captureCommand: `node ${emptyCapturePath}`,
        captureGraceMs,
        captureReadyTimeoutMs: 300,
      }),
    ).resolves.toBeUndefined();
  });
});
