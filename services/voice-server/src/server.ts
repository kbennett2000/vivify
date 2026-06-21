// The voice service HTTP layer (Node built-in http; no web-framework dep). On POST
// /tts it runs ONE real-time synthesis pass (Cycle 11, single-pass): it records the
// PulseAudio null-sink monitor with `parec` WHILE the SAPI4 bridge plays the utterance
// (the bridge emits the dense mouth timeline), then wraps the captured PCM into a WAV and
// returns { audioWavBase64, mouthTimeline, format }. Both the bridge and the capture
// commands are injectable (opts.bridgeCommand/captureCommand, VIVIFY_SAPI4_BRIDGE/
// VIVIFY_CAPTURE) so CI drives the whole flow against fakes — no Wine/PulseAudio required.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceConfig } from '@vivify/types';
import { voiceToBridgeArgs } from './voice-args.js';
import { parseTimeline } from './timeline.js';
import { parseBridgeTiming, formatTtsTiming, type TtsTiming } from './timing.js';
import {
  wrapPcmToWav,
  trimLeadingSilence,
  wavDurationMs,
  DEFAULT_PCM_FORMAT,
  type TrimOptions,
} from './wav.js';
import { CaptureSource } from './capture.js';

export interface SynthRequest {
  text: string;
  voice?: VoiceConfig;
}

export interface ServerOptions {
  /** Full bridge command; defaults to VIVIFY_SAPI4_BRIDGE or the in-container Wine path. */
  bridgeCommand?: string;
  /** Cycle 11: full capture command (records the null-sink monitor → raw PCM on stdout). */
  captureCommand?: string;
  /** Cycle 11: ms to keep recording after the bridge exits, so the audio tail isn't clipped. */
  captureGraceMs?: number;
  /** Cycle 11: warn if the persistent capture source produces no sample within this many ms. */
  captureReadyTimeoutMs?: number;
  /** Cycle 11: respawn the persistent capture reader if it dies (default true; tests disable it). */
  captureRespawn?: boolean;
  /** Cycle 11: run a background warmup synthesis when the server starts (default true; tests off). */
  warmOnStart?: boolean;
  /** Cap on request body size (bytes). */
  maxBodyBytes?: number;
  /** Kill the bridge + fail the request if it runs longer than this (ms). */
  bridgeTimeoutMs?: number;
  /** Cycle 10: per-request latency breakdown hook (also logged). Injectable for tests. */
  onTiming?: (timing: TtsTiming) => void;
}

// Cycle 11: operator-tunable trim knobs (no rebuild to dial in the leading-edge alignment). If a
// real opening consonant still clips or the audio leads the mouth, set these and re-run.
function trimOptionsFromEnv(): TrimOptions {
  const opts: TrimOptions = {};
  const threshold = Number(process.env.VIVIFY_TRIM_THRESHOLD);
  const leadInMs = Number(process.env.VIVIFY_TRIM_LEADIN_MS);
  if (Number.isFinite(threshold) && process.env.VIVIFY_TRIM_THRESHOLD) opts.threshold = threshold;
  if (Number.isFinite(leadInMs) && process.env.VIVIFY_TRIM_LEADIN_MS) opts.leadInMs = leadInMs;
  return opts;
}

// Cycle 10: the engine is now WARMED at container start (persistent Xvfb + wineserver via
// entrypoint.sh), so the per-request command is a plain `wine …` — no `xvfb-run -a`, which
// spawned a fresh Xvfb and paid wineserver/wineboot cold-start on every /tts. Overridable
// via VIVIFY_SAPI4_BRIDGE.
const DEFAULT_BRIDGE = process.env.VIVIFY_SAPI4_BRIDGE ?? 'wine /opt/vivify/bridge/sapi4-mouth.exe';
// Cycle 11: the PERSISTENT capture source runs this once (s16le/44100/mono — matches the pinned
// null-sink format in pulse-null.pa, so no resampling). `--latency-msec=30` keeps the stream
// flushing promptly so a window's first chunk arrives in ~tens of ms. Overridable via VIVIFY_CAPTURE.
const DEFAULT_CAPTURE =
  process.env.VIVIFY_CAPTURE ??
  'parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1 --latency-msec=30';
const DEFAULT_CAPTURE_GRACE = Number(process.env.VIVIFY_CAPTURE_GRACE_MS ?? 200);
// Cycle 11: how long after (re)starting the persistent reader to wait for its first sample before
// warning that the null sink isn't streaming. (No longer a per-request gate.) Overridable.
const DEFAULT_CAPTURE_READY = Number(process.env.VIVIFY_CAPTURE_READY_MS ?? 5_000);
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

interface SynthResult {
  /** WAV built from the captured null-sink PCM (header added + leading silence trimmed). */
  wav: Buffer;
  timeline: unknown;
  /** Captured bridge stderr (carries the `[boot]`, `[timing]`, `[mmaudio]` lines). */
  stderr: string;
  /** Server-observed bridge child wall time (spawn → close), ms. */
  bridgeMs: number;
  /** spawn → the bridge's first stderr byte (`[boot]`) ≈ the Wine process-load prologue, ms. */
  wineLoadMs: number;
  /** Capture window first-byte latency (beginWindow → first buffered chunk), ms — now stable. */
  windowFirstByteMs: number;
  /** Building the WAV (wrap + trim leading silence), ms. */
  buildMs: number;
  /** Audio duration of the raw captured PCM (before trim), ms — for the clip diagnostic. */
  rawCaptureMs: number;
  /** Audio duration of the final (trimmed) WAV, ms — compare to the timeline span to detect clipping. */
  wavMs: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One real-time synthesis pass over the PERSISTENT capture source. Opens a capture window
 * (the always-on `parec` is already streaming, so no per-request spawn / no readiness race),
 * runs the single-pass bridge (which plays the utterance to the null sink and writes the dense
 * timeline), then closes the window and wraps the captured PCM into an aligned WAV. The caller
 * SERIALIZES calls so only one window is open at a time.
 */
async function synthesize(
  source: CaptureSource,
  bridgeCommand: string,
  text: string,
  voice: VoiceConfig,
  timeoutMs: number,
  graceMs: number,
  trim: TrimOptions,
): Promise<SynthResult> {
  const dir = await mkdtemp(join(tmpdir(), 'vivify-tts-'));
  source.beginWindow();

  try {
    const textPath = join(dir, 'in.txt');
    const timelinePath = join(dir, 'out.json');
    await writeFile(textPath, text, 'utf8');

    const parts = bridgeCommand.split(/\s+/).filter(Boolean);
    const program = parts[0];
    if (!program) throw new Error('voice-server: empty bridge command');
    const args = [
      ...parts.slice(1),
      '--text-file',
      textPath,
      '--timeline',
      timelinePath,
      ...voiceToBridgeArgs(voice),
    ];

    const tSpawn = Date.now();
    let firstByteAt = 0;
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let buf = '';
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
        if (firstByteAt === 0) firstByteAt = Date.now(); // `[boot]` ≈ main() start
        buf += String(chunk);
        // Cycle 11 fix: RESOLVE the moment the bridge emits a complete `[timing] …` line — its
        // definitive SUCCESS marker (printed only when rc == 0, as its last output, after the
        // timeline is written + closed and all audio has played to the null sink). Do NOT wait for
        // the process to `'close'`: after `[timing]`, Wine spends ~2s tearing down the audio
        // device/DLLs on exit, and SIGKILL of the `wine` launcher doesn't promptly close the
        // underlying Windows process's stderr pipe — so `'close'` lags ~2s. We have everything we
        // need, so resolve now and reap the child in the background (the teardown happens off the
        // request's critical path). A failure path never prints `[timing] `, so it still falls
        // through to the non-zero-exit reject below → 500. (`[^\n]*\n` ensures the full line is in.)
        if (/\[timing\] [^\n]*\n/.test(buf)) {
          finish(() => resolve(buf));
          child.kill('SIGKILL'); // best-effort; not awaited
          child.unref();
        }
      });
      child.on('error', (err) => finish(() => reject(err)));
      child.on('close', (code) => {
        // Only reached when we DIDN'T resolve on `[timing]` (failure/early-exit path).
        if (code === 0) finish(() => resolve(buf));
        else
          finish(() => reject(new Error(`bridge exited with code ${code}: ${buf.slice(0, 500)}`)));
      });
    });
    const bridgeMs = Date.now() - tSpawn;
    // Surface the bridge's own diagnostics ([boot]/[mmaudio]/[timing]) once resolved — single log
    // site that covers both the resolve-on-`[timing]` path (where `'close'` hasn't fired yet) and a
    // clean natural close. (On failure the promise rejects, and the error carries the stderr tail.)
    const diag = stderr.trim();
    if (diag) console.log(`[bridge] ${diag}`);
    const wineLoadMs = firstByteAt ? firstByteAt - tSpawn : 0;

    // Let the null sink flush the audio tail, then close the window and assemble the WAV. (The
    // bridge resolved on `[timing]`, after AudioStop — all audio has already played — so the grace
    // only covers the pulse buffer tail; closing the window here loses nothing.)
    await delay(graceMs);
    const { pcm, firstByteMs: windowFirstByteMs } = source.endWindow();

    if (pcm.length === 0) {
      // Honest failure — never return a silent/faked WAV. An empty window means the persistent
      // monitor reader isn't streaming (dead/never-live) — surfaced loudly, not papered over.
      throw new Error(
        'null-sink capture window was empty — is the persistent monitor reader live?',
      );
    }
    const tBuild = Date.now();
    const wav = trimLeadingSilence(wrapPcmToWav(pcm), trim);
    const buildMs = Date.now() - tBuild;
    if (wav.length <= 44) {
      throw new Error('null-sink capture was entirely silent — no audio aligned to the timeline');
    }
    const pcmByteRate =
      (DEFAULT_PCM_FORMAT.rate * DEFAULT_PCM_FORMAT.channels * DEFAULT_PCM_FORMAT.bits) >> 3;
    const rawCaptureMs = Math.round((pcm.length / pcmByteRate) * 1000);
    const wavMs = wavDurationMs(wav);

    const timeline: unknown = JSON.parse(await readFile(timelinePath, 'utf8'));
    return {
      wav,
      timeline,
      stderr,
      bridgeMs,
      wineLoadMs,
      windowFirstByteMs,
      buildMs,
      rawCaptureMs,
      wavMs,
    };
  } finally {
    source.abortWindow(); // backstop: stop buffering on the failure path (the source lives on)
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
  const captureCommand = opts.captureCommand ?? DEFAULT_CAPTURE;
  const captureGraceMs = opts.captureGraceMs ?? DEFAULT_CAPTURE_GRACE;
  const captureReadyTimeoutMs = opts.captureReadyTimeoutMs ?? DEFAULT_CAPTURE_READY;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const bridgeTimeoutMs = opts.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT;
  const trim = trimOptionsFromEnv();

  // ONE persistent capture reader for the server's lifetime — no per-request `parec` spawn.
  const source = new CaptureSource({
    command: captureCommand,
    readyTimeoutMs: captureReadyTimeoutMs,
    respawn: opts.captureRespawn,
  });
  source.start();

  // Serialize /tts so capture windows never overlap (one window open at a time). Promise-chain
  // mutex: each call runs after the previous settles (resolve OR reject), and the chain swallows
  // so one failure can't wedge the queue. `runExclusive` returns the actual result/rejection.
  let queue: Promise<unknown> = Promise.resolve();
  const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => {},
      () => {},
    );
    return run as Promise<T>;
  };

  const server = createServer((req, res) => {
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
          // Serialize so only ONE capture window is open at a time (the persistent source is
          // shared); also removes any warmup-vs-first-request race.
          const {
            wav,
            timeline,
            stderr,
            bridgeMs,
            wineLoadMs,
            windowFirstByteMs,
            buildMs,
            rawCaptureMs,
            wavMs,
          } = await runExclusive(() =>
            synthesize(
              source,
              bridgeCommand,
              parsed.text,
              parsed.voice ?? {},
              bridgeTimeoutMs,
              captureGraceMs,
              trim,
            ),
          );
          const mouthTimeline = parseTimeline(timeline);
          const tEncode = Date.now();
          const audioWavBase64 = wav.toString('base64');
          const encodeMs = Date.now() - tEncode;

          // Cycle 10/11: per-request latency breakdown — server stages + the parsed bridge
          // stages — so we can SEE where the time goes (Wine load / engine init / Pass A
          // real-time floor / teardown / window). See timing.ts and the cycle-11 doc.
          const timing: TtsTiming = {
            bridgeMs,
            wineLoadMs,
            windowFirstByteMs,
            buildMs,
            encodeMs,
            totalMs: Date.now() - tReq,
            bridge: parseBridgeTiming(stderr),
          };
          console.log(
            `[tts-timing] ${mouthTimeline.length} events, ${wav.length}B wav | ${formatTtsTiming(timing)}`,
          );
          // Clip diagnostic: the final WAV's audio duration vs the mouth-timeline span. If the opening
          // is clipped, wavMs ≪ timelineMs quantifies how much audio is missing from the capture.
          const timelineMs = mouthTimeline.length
            ? mouthTimeline[mouthTimeline.length - 1]!.timeMs
            : 0;
          console.log(
            `[tts-audio] wavMs=${wavMs} timelineMs=${timelineMs} rawCaptureMs=${rawCaptureMs} trimmedMs=${rawCaptureMs - wavMs}`,
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

  // Tear the persistent reader down with the server (no leaked parec across test runs).
  server.on('close', () => source.stop());

  // Cycle 11: warm the WHOLE pipeline (winepulse playback + engine) by running one serialized
  // synthesis through the persistent source at startup, so the FIRST real Speak isn't cold. It
  // holds the mutex, so the first real request waits behind it. Best-effort. (Tests disable it.)
  if (opts.warmOnStart !== false) {
    void runExclusive(() =>
      synthesize(source, bridgeCommand, 'warm up', {}, bridgeTimeoutMs, captureGraceMs, trim),
    )
      .then(() => console.log('[warmup] done'))
      .catch((err: unknown) =>
        console.warn(
          `[warmup] failed (first real Speak may be colder): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  return server;
}

/**
 * Standalone warmup: prime the WHOLE pipeline once via a throwaway persistent source + one real
 * synthesis — parec connect + null-sink monitor + winepulse playback + trim + the engine. Used by
 * tests / manual runs; `createVoiceServer` self-warms its own source. Best-effort.
 */
export async function warmUp(opts: ServerOptions = {}): Promise<void> {
  const source = new CaptureSource({
    command: opts.captureCommand ?? DEFAULT_CAPTURE,
    readyTimeoutMs: opts.captureReadyTimeoutMs ?? DEFAULT_CAPTURE_READY,
    respawn: false,
  });
  source.start();
  const t0 = Date.now();
  console.log('[warmup] priming capture + engine pipeline…');
  try {
    await synthesize(
      source,
      opts.bridgeCommand ?? DEFAULT_BRIDGE,
      'warm up',
      {},
      opts.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT,
      opts.captureGraceMs ?? DEFAULT_CAPTURE_GRACE,
      trimOptionsFromEnv(),
    );
    console.log(`[warmup] done in ${Date.now() - t0}ms`);
  } catch (err) {
    console.warn(
      `[warmup] failed (first real Speak may be colder): ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    source.stop();
  }
}

export function start(port = Number(process.env.PORT ?? 8080), opts: ServerOptions = {}): Server {
  // createVoiceServer starts the persistent capture source and self-warms in the background.
  const server = createVoiceServer(opts);
  server.listen(port, () => {
    console.log(`vivify voice-server listening on :${port}`);
  });
  return server;
}
