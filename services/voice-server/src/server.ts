// The voice service HTTP layer (Node built-in http; no web-framework dep). On
// POST /tts it spawns the SAPI4 bridge (which writes a WAV + timeline JSON to
// temp files), reads them, and returns { audioWavBase64, mouthTimeline, format }.
// The bridge command is injectable (opts.bridgeCommand / VIVIFY_SAPI4_BRIDGE) so
// CI tests drive the whole flow against a fake bridge — no Wine required.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceConfig } from '@vivify/types';
import { voiceToBridgeArgs } from './voice-args.js';
import { parseTimeline } from './timeline.js';

export interface SynthRequest {
  text: string;
  voice?: VoiceConfig;
}

export interface ServerOptions {
  /** Full bridge command; defaults to VIVIFY_SAPI4_BRIDGE or the in-container Wine path. */
  bridgeCommand?: string;
  /** Cap on request body size (bytes). */
  maxBodyBytes?: number;
  /** Kill the bridge + fail the request if it runs longer than this (ms). */
  bridgeTimeoutMs?: number;
}

const DEFAULT_BRIDGE =
  process.env.VIVIFY_SAPI4_BRIDGE ?? 'xvfb-run -a wine /opt/vivify/bridge/sapi4-mouth.exe';
const DEFAULT_MAX_BODY = 1_000_000;
const DEFAULT_BRIDGE_TIMEOUT = Number(process.env.VIVIFY_SAPI4_TIMEOUT_MS ?? 120_000);

// Permissive CORS so a browser app (e.g. mash on another origin) can call the
// service. The service exposes no secrets and is a local dev/voice backend.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS });
  res.end(payload);
}

async function runBridge(
  bridgeCommand: string,
  text: string,
  voice: VoiceConfig,
  timeoutMs: number,
): Promise<{ wav: Buffer; timeline: unknown }> {
  const dir = await mkdtemp(join(tmpdir(), 'vivify-tts-'));
  try {
    const textPath = join(dir, 'in.txt');
    const wavPath = join(dir, 'out.wav');
    const timelinePath = join(dir, 'out.json');
    await writeFile(textPath, text, 'utf8');

    const parts = bridgeCommand.split(/\s+/).filter(Boolean);
    const program = parts[0];
    if (!program) throw new Error('voice-server: empty bridge command');
    const args = [
      ...parts.slice(1),
      '--text-file',
      textPath,
      '--wav',
      wavPath,
      '--timeline',
      timelinePath,
      ...voiceToBridgeArgs(voice),
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      // Don't let a hung wine/Xvfb spawn pin the request open forever.
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(`bridge timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => finish(() => reject(err)));
      child.on('close', (code) => {
        if (code === 0) finish(resolve);
        else
          finish(() =>
            reject(new Error(`bridge exited with code ${code}: ${stderr.slice(0, 500)}`)),
          );
      });
    });

    const wav = await readFile(wavPath);
    const timeline: unknown = JSON.parse(await readFile(timelinePath, 'utf8'));
    return { wav, timeline };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function createVoiceServer(opts: ServerOptions = {}): Server {
  const bridgeCommand = opts.bridgeCommand ?? DEFAULT_BRIDGE;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const bridgeTimeoutMs = opts.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT;

  return createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        if (req.method === 'GET' && req.url === '/health') {
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === 'POST' && req.url === '/tts') {
          const body = await readBody(req, maxBodyBytes);
          let parsed: SynthRequest;
          try {
            parsed = JSON.parse(body) as SynthRequest;
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' });
            return;
          }
          if (!parsed || typeof parsed.text !== 'string' || parsed.text.length === 0) {
            sendJson(res, 400, { error: 'field "text" (non-empty string) is required' });
            return;
          }
          const { wav, timeline } = await runBridge(
            bridgeCommand,
            parsed.text,
            parsed.voice ?? {},
            bridgeTimeoutMs,
          );
          sendJson(res, 200, {
            audioWavBase64: wav.toString('base64'),
            mouthTimeline: parseTimeline(timeline),
            format: 'wav',
          });
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}

export function start(port = Number(process.env.PORT ?? 8080), opts: ServerOptions = {}): Server {
  const server = createVoiceServer(opts);
  server.listen(port, () => {
    console.log(`vivify voice-server listening on :${port}`);
  });
  return server;
}
