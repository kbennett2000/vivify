// Cycle 5 acceptance (docs/cycles/cycle-5-voice.md → "What is verified where",
// CI bullet): "the Node server end-to-end against a fake bridge ... request
// validation, ... response shape, GET /health, error paths". This drives a real
// http.Server on an ephemeral port via global fetch, with the bridge command
// pointed at the committed fake-bridge (a separate process / legitimate external
// test double, NOT a mock of the code under test). No Wine required.

import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVoiceServer } from '../src/server.js';

const fakeBridgePath = fileURLToPath(new URL('./fake-bridge.mjs', import.meta.url));
const failBridgePath = fileURLToPath(new URL('./fail-bridge.mjs', import.meta.url));
const hangBridgePath = fileURLToPath(new URL('./hang-bridge.mjs', import.meta.url));

interface TtsResponse {
  audioWavBase64: string;
  mouthTimeline: Array<{ timeMs: number; shape: number }>;
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
    server = createVoiceServer({ bridgeCommand: `node ${fakeBridgePath}` });
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

    // audioWavBase64 must base64-decode to a real RIFF/WAVE container.
    const wav = Buffer.from(json.audioWavBase64, 'base64');
    expect(wav.length).toBeGreaterThanOrEqual(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // mouthTimeline is the bridge's 3 canned events, normalized to {timeMs, shape}.
    expect(json.mouthTimeline).toEqual([
      { timeMs: 0, shape: 0 },
      { timeMs: 50, shape: 5 },
      { timeMs: 120, shape: 2 },
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

describe('voice-server bridge-failure path', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({ bridgeCommand: `node ${failBridgePath}` });
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

describe('voice-server CORS (browser access)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createVoiceServer({ bridgeCommand: `node ${fakeBridgePath}` });
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
