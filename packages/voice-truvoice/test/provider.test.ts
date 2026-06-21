// Cycle 6 (docs/cycles/cycle-6-lipsync.md → "Validation → CI": "TruVoiceProvider
// against a real fake HTTP server (canned {audioWavBase64, mouthTimeline}) —
// decode + abort"). The server here is a genuine external double — a real
// node:http server on an ephemeral port, NOT a vitest mock of the provider — so
// we test the provider's real fetch/decode/abort behavior against real bytes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { MouthEvent } from '@vivify/types';
import { TruVoiceProvider, WebSpeechProvider } from '../src/index.js';

// Known audio bytes the server hands back; the provider must decode the base64
// back to exactly these bytes (RIFF/WAVE prefix proves a real container shape).
const KNOWN_WAV = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46, // "RIFF"
  0x24,
  0x00,
  0x00,
  0x00, // chunk size (arbitrary)
  0x57,
  0x41,
  0x56,
  0x45, // "WAVE"
  0xde,
  0xad,
  0xbe,
  0xef, // payload sentinel
]);
const KNOWN_WAV_B64 = Buffer.from(KNOWN_WAV).toString('base64');

// Mixed: the first event carries a mouth WIDTH, the second omits it. The provider
// must carry `width` through when present and leave it absent when not.
const CANNED_TIMELINE: MouthEvent[] = [
  { timeMs: 0, shape: 0, width: 0 },
  { timeMs: 50, shape: 9 },
];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('expected an AddressInfo from listen(0)'));
        return;
      }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('TruVoiceProvider', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await close(server);
      server = null;
    }
  });

  it('POSTs {text, voice} and decodes the WAV + mouth timeline from the response', async () => {
    let captured: { method?: string; url?: string; body: string } | null = null;
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const body = await readBody(req);
      captured = { method: req.method, url: req.url, body };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          audioWavBase64: KNOWN_WAV_B64,
          mouthTimeline: CANNED_TIMELINE,
          format: 'wav',
        }),
      );
    });
    const url = await listen(server);

    const provider = new TruVoiceProvider({ url });
    const result = await provider.speak('hi', { engineModeId: 'GENIE', speed: 157 });

    // Decoded audio equals the exact bytes the server sent (RIFF/WAVE container).
    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    const bytes = new Uint8Array(result.audio);
    expect(Array.from(bytes)).toEqual(Array.from(KNOWN_WAV));
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(bytes.subarray(8, 12)).toString('ascii')).toBe('WAVE');

    // Mouth timeline passes through as MouthEvent[], carrying `width` when the
    // server sends it and omitting it when absent.
    expect(result.mouthTimeline).toEqual(CANNED_TIMELINE);
    expect(result.mouthTimeline[0]!.width).toBe(0);
    expect('width' in (result.mouthTimeline[1] as object)).toBe(false);

    // The server received the right request (asserted from the external double,
    // not from anything we configured the provider to echo back).
    expect(captured).not.toBeNull();
    const cap = captured as unknown as { method: string; url: string; body: string };
    expect(cap.method).toBe('POST');
    expect(cap.url).toBe('/tts');
    expect(JSON.parse(cap.body)).toEqual({
      text: 'hi',
      voice: { engineModeId: 'GENIE', speed: 157 },
    });
  });

  it('rejects when the server responds 500', async () => {
    server = createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    const url = await listen(server);

    const provider = new TruVoiceProvider({ url });
    await expect(provider.speak('hi', {})).rejects.toThrow(/500/);
  });

  it('rejects with an abort error when the signal is aborted mid-flight', async () => {
    // A server that delays its response long enough for us to abort first.
    server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ audioWavBase64: KNOWN_WAV_B64, mouthTimeline: [], format: 'wav' }),
        );
      }, 2000);
    });
    const url = await listen(server);

    const provider = new TruVoiceProvider({ url });
    const controller = new AbortController();
    const pending = provider.speak('hi', {}, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    // No request should be honored, but stand a server up anyway so a stray
    // request would resolve (proving the rejection comes from the abort).
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ audioWavBase64: KNOWN_WAV_B64, mouthTimeline: [], format: 'wav' }));
    });
    const url = await listen(server);

    const provider = new TruVoiceProvider({ url });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.speak('hi', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('WebSpeechProvider', () => {
  it('resolves to an empty result in Node (no speechSynthesis global) without throwing', async () => {
    expect((globalThis as { speechSynthesis?: unknown }).speechSynthesis).toBeUndefined();

    const provider = new WebSpeechProvider();
    const result = await provider.speak('hi', {});
    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    expect(result.audio.byteLength).toBe(0);
    expect(result.mouthTimeline).toEqual([]);
  });
});
