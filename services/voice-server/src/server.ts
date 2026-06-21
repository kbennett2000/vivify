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
import { parseBridgeTiming, formatTtsTiming, type TtsTiming } from './timing.js';

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
  /** Cycle 10: per-request latency breakdown hook (also logged). Injectable for tests. */
  onTiming?: (timing: TtsTiming) => void;
}

// Cycle 10: the engine is now WARMED at container start (persistent Xvfb + wineserver via
// entrypoint.sh), so the per-request command is a plain `wine …` — no `xvfb-run -a`, which
// spawned a fresh Xvfb and paid wineserver/wineboot cold-start on every /tts. Overridable
// via VIVIFY_SAPI4_BRIDGE.
const DEFAULT_BRIDGE = process.env.VIVIFY_SAPI4_BRIDGE ?? 'wine /opt/vivify/bridge/sapi4-mouth.exe';
const DEFAULT_MAX_BODY = 1_000_000;
const DEFAULT_BRIDGE_TIMEOUT = Number(process.env.VIVIFY_SAPI4_TIMEOUT_MS ?? 120_000);

// Permissive CORS so a browser app (e.g. mash on any localhost dev port) can call
// the service. We REFLECT the request Origin rather than hardcoding one — Vite may
// pick any port (5173, 5174, …), so an allow-list would break. The service exposes
// no secrets and is a local dev/voice backend, so echoing the Origin is fine; it's
// also more robust than `*` (works for credentialed requests). Falls back to `*`
// when there's no Origin (curl / same-origin).
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const requestedHeaders = req.headers['access-control-request-headers'];
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers':
      typeof requestedHeaders === 'string' && requestedHeaders.length > 0
        ? requestedHeaders
        : 'content-type',
    vary: 'Origin',
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cors: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...cors });
  res.end(payload);
}

interface BridgeResult {
  wav: Buffer;
  timeline: unknown;
  /** Captured bridge stderr (carries the `[timing]` + `[label]` diagnostic lines). */
  stderr: string;
  /** Server-observed child wall time (spawn → close), ms. */
  bridgeMs: number;
  /** Time spent reading the WAV + timeline files, ms. */
  readMs: number;
}

async function runBridge(
  bridgeCommand: string,
  text: string,
  voice: VoiceConfig,
  timeoutMs: number,
): Promise<BridgeResult> {
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

    const tSpawn = Date.now();
    const stderr = await new Promise<string>((resolve, reject) => {
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
        if (code === 0) {
          // Surface the bridge's own diagnostics (event count, timeMs span, raw qTimeStamp
          // range, AudioStart, and the [timing] breakdown) in the server log on success too —
          // otherwise they're only visible on failure, and the timing evidence would be hidden.
          const diag = stderr.trim();
          if (diag) console.log(`[bridge] ${diag}`);
          finish(() => resolve(stderr));
        } else
          finish(() =>
            reject(new Error(`bridge exited with code ${code}: ${stderr.slice(0, 500)}`)),
          );
      });
    });
    const bridgeMs = Date.now() - tSpawn;

    const tRead = Date.now();
    const wav = await readFile(wavPath);
    const timeline: unknown = JSON.parse(await readFile(timelinePath, 'utf8'));
    const readMs = Date.now() - tRead;
    return { wav, timeline, stderr, bridgeMs, readMs };
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
    const cors = corsHeaders(req);
    void (async () => {
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, cors);
          res.end();
          return;
        }
        if (req.method === 'GET' && req.url === '/health') {
          sendJson(res, 200, { ok: true }, cors);
          return;
        }
        if (req.method === 'POST' && req.url === '/tts') {
          const tReq = Date.now();
          const body = await readBody(req, maxBodyBytes);
          let parsed: SynthRequest;
          try {
            parsed = JSON.parse(body) as SynthRequest;
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' }, cors);
            return;
          }
          if (!parsed || typeof parsed.text !== 'string' || parsed.text.length === 0) {
            sendJson(res, 400, { error: 'field "text" (non-empty string) is required' }, cors);
            return;
          }
          const { wav, timeline, stderr, bridgeMs, readMs } = await runBridge(
            bridgeCommand,
            parsed.text,
            parsed.voice ?? {},
            bridgeTimeoutMs,
          );
          const mouthTimeline = parseTimeline(timeline);
          const tEncode = Date.now();
          const audioWavBase64 = wav.toString('base64');
          const encodeMs = Date.now() - tEncode;

          // Cycle 10: per-request latency breakdown — server stages + the parsed bridge
          // stages — so we can SEE where the ~2-3s goes (engine init / Pass A real-time
          // floor / Pass B overhead / server). See timing.ts and the cycle-10 doc.
          const timing: TtsTiming = {
            bridgeMs,
            readMs,
            encodeMs,
            totalMs: Date.now() - tReq,
            bridge: parseBridgeTiming(stderr),
          };
          console.log(
            `[tts-timing] ${mouthTimeline.length} events, ${wav.length}B wav | ${formatTtsTiming(timing)}`,
          );
          opts.onTiming?.(timing);

          sendJson(
            res,
            200,
            {
              audioWavBase64,
              mouthTimeline,
              format: 'wav',
            },
            cors,
          );
          return;
        }
        sendJson(res, 404, { error: 'not found' }, cors);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }, cors);
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
