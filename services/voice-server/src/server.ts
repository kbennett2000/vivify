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
import { wrapPcmToWav, trimLeadingSilence, wavDurationMs, DEFAULT_PCM_FORMAT } from './wav.js';

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
  /** Cycle 11 fix: fail if the capture hasn't produced its first sample within this many ms. */
  captureReadyTimeoutMs?: number;
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
// Cycle 11: record the null sink's monitor as raw PCM (s16le/44100/mono — matches the pinned
// null-sink format in pulse-null.pa, so no resampling). `--latency-msec=30` makes parec flush
// small fragments immediately, so its first sample arrives in ~tens of ms and the capture-ready
// gate (below) adds little latency. Overridable via VIVIFY_CAPTURE.
const DEFAULT_CAPTURE =
  process.env.VIVIFY_CAPTURE ??
  'parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1 --latency-msec=30';
const DEFAULT_CAPTURE_GRACE = Number(process.env.VIVIFY_CAPTURE_GRACE_MS ?? 200);
// Cycle 11 fix: synthesis is gated on the capture actually streaming; if parec produces no
// sample within this window the request fails loudly (no clipped/faked audio). Overridable.
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
  /** Capture (parec) spawn → its first PCM sample — the readiness gate paid before synthesis, ms. */
  captureReadyMs: number;
  /** Capture (parec) wall time, ms. */
  captureMs: number;
  /** Stopping the capture (grace-end → parec 'close'), ms. */
  captureStopMs: number;
  /** Building the WAV (wrap + trim leading silence), ms. */
  buildMs: number;
  /** Audio duration of the raw captured PCM (before trim), ms — for the clip diagnostic. */
  rawCaptureMs: number;
  /** Audio duration of the final (trimmed) WAV, ms — compare to the timeline span to detect clipping. */
  wavMs: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One real-time synthesis pass. Starts the capture (records the null-sink monitor → raw PCM on
 * stdout) and WAITS until it's actually streaming before triggering synthesis, so the opening
 * audio can't be clipped by a capture-start race. Then runs the single-pass bridge (which plays
 * the utterance to that sink and writes the dense timeline), stops the capture, and wraps the
 * PCM into an aligned WAV. The capture is always torn down (no leaked recorder), even on failure.
 */
async function synthesize(
  bridgeCommand: string,
  captureCommand: string,
  text: string,
  voice: VoiceConfig,
  timeoutMs: number,
  graceMs: number,
  readyMs: number,
): Promise<SynthResult> {
  const dir = await mkdtemp(join(tmpdir(), 'vivify-tts-'));

  // --- start the capture FIRST and gate synthesis on it actually streaming ---
  const capParts = captureCommand.split(/\s+/).filter(Boolean);
  const capProgram = capParts[0];
  if (!capProgram) throw new Error('voice-server: empty capture command');
  const tCapture = Date.now();
  const capture = spawn(capProgram, capParts.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  const pcmChunks: Buffer[] = [];
  let captureErr = '';
  // Resolves on the FIRST captured sample (proof the null-sink monitor is open and flowing);
  // rejects if no sample arrives within `readyMs` or the recorder dies first — a loud, honest
  // failure rather than a clipped/silent WAV. The same handler collects every chunk.
  let markReady: () => void;
  let failReady: (err: Error) => void;
  const captureReady = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  // The real consumer is `await captureReady` below; this no-op handler just prevents an
  // unhandled-rejection warning if it rejects during the async gap before that await.
  void captureReady.catch(() => {});
  let captureLive = false;
  const readyTimer = setTimeout(() => {
    failReady(
      new Error(
        `null-sink capture produced no sample within ${readyMs}ms — is the PulseAudio null sink ` +
          `live and streaming to its monitor? (parec: ${captureErr.trim().slice(0, 200) || 'no stderr'})`,
      ),
    );
  }, readyMs);
  readyTimer.unref?.();
  capture.stdout?.on('data', (chunk: Buffer) => {
    pcmChunks.push(chunk);
    if (!captureLive) {
      captureLive = true;
      clearTimeout(readyTimer);
      markReady();
    }
  });
  capture.stderr?.on('data', (chunk) => {
    captureErr += String(chunk);
  });
  // Resolve on close OR error (spawn ENOENT emits 'error' without 'close'). If the recorder dies
  // before producing a sample, fail the readiness gate too (don't wait out the whole timeout).
  const captureClosed = new Promise<void>((resolve) => {
    const onEnd = (): void => {
      if (!captureLive) {
        clearTimeout(readyTimer);
        failReady(
          new Error(
            `capture process exited before producing audio (parec: ${captureErr.trim().slice(0, 200) || 'no stderr'})`,
          ),
        );
      }
      resolve();
    };
    capture.on('close', onEnd);
    capture.on('error', onEnd);
  });
  let captureStopped = false;
  const stopCapture = async (): Promise<void> => {
    if (!captureStopped) {
      captureStopped = true;
      if (capture.exitCode === null && !capture.killed) {
        capture.kill('SIGTERM');
        // Escalate to SIGKILL if the recorder ignores SIGTERM, so a misbehaving `parec`
        // can't hang the request waiting on `captureClosed`.
        const killTimer = setTimeout(() => {
          if (capture.exitCode === null) capture.kill('SIGKILL');
        }, 2000);
        killTimer.unref?.();
        void captureClosed.then(() => clearTimeout(killTimer));
      }
    }
    await captureClosed;
  };

  try {
    const textPath = join(dir, 'in.txt');
    const timelinePath = join(dir, 'out.json');
    await writeFile(textPath, text, 'utf8');

    // GATE: don't synthesize until the capture is provably streaming, so the opening words
    // can't be lost to a capture-start race. (Throws → 500 if the capture never goes live.)
    await captureReady;
    const captureReadyMs = Date.now() - tCapture;

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

    // Let the null sink flush the audio tail, then stop recording and assemble the WAV. (The bridge
    // is resolved on `[timing]`, after AudioStop — all audio has already played — so the grace only
    // covers the pulse buffer tail; stopping the recorder here loses nothing.)
    await delay(graceMs);
    const tStop = Date.now();
    await stopCapture();
    const captureStopMs = Date.now() - tStop;
    const captureMs = Date.now() - tCapture;

    const pcm = Buffer.concat(pcmChunks);
    if (pcm.length === 0) {
      // Honest failure — never return a silent/faked WAV (see cycle-11 doc).
      throw new Error(
        `null-sink capture produced no audio (parec: ${captureErr.trim().slice(0, 200) || 'no stderr'})`,
      );
    }
    const tBuild = Date.now();
    const wav = trimLeadingSilence(wrapPcmToWav(pcm));
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
      captureReadyMs,
      captureMs,
      captureStopMs,
      buildMs,
      rawCaptureMs,
      wavMs,
    };
  } finally {
    await stopCapture(); // backstop: never leak parec, even on the bridge-failure path
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
          const {
            wav,
            timeline,
            stderr,
            bridgeMs,
            wineLoadMs,
            captureReadyMs,
            captureMs,
            captureStopMs,
            buildMs,
            rawCaptureMs,
            wavMs,
          } = await synthesize(
            bridgeCommand,
            captureCommand,
            parsed.text,
            parsed.voice ?? {},
            bridgeTimeoutMs,
            captureGraceMs,
            captureReadyTimeoutMs,
          );
          const mouthTimeline = parseTimeline(timeline);
          const tEncode = Date.now();
          const audioWavBase64 = wav.toString('base64');
          const encodeMs = Date.now() - tEncode;

          // Cycle 10/11: per-request latency breakdown — server stages + the parsed bridge
          // stages — so we can SEE where the time goes (Wine load / engine init / Pass A
          // real-time floor / teardown / capture). See timing.ts and the cycle-11 doc.
          const timing: TtsTiming = {
            bridgeMs,
            wineLoadMs,
            captureReadyMs,
            captureMs,
            captureStopMs,
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
}

/**
 * Cycle 11 fix: prime the WHOLE capture pipeline once at startup — parec connect + the
 * null-sink monitor + winepulse playback + trim + the engine — by running one real synthesis.
 * The container's engine warmup (entrypoint) primed only the engine, so the FIRST real Speak
 * still cold-started the capture path and clipped its opening; this warms it via the exact
 * production path. Best-effort: failures only mean the first Speak runs colder, never a crash.
 */
export async function warmUp(opts: ServerOptions = {}): Promise<void> {
  const t0 = Date.now();
  console.log('[warmup] priming capture + engine pipeline…');
  try {
    await synthesize(
      opts.bridgeCommand ?? DEFAULT_BRIDGE,
      opts.captureCommand ?? DEFAULT_CAPTURE,
      'warm up',
      {},
      opts.bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT,
      opts.captureGraceMs ?? DEFAULT_CAPTURE_GRACE,
      opts.captureReadyTimeoutMs ?? DEFAULT_CAPTURE_READY,
    );
    console.log(`[warmup] done in ${Date.now() - t0}ms`);
  } catch (err) {
    console.warn(
      `[warmup] failed (first real Speak may be colder): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function start(port = Number(process.env.PORT ?? 8080), opts: ServerOptions = {}): Server {
  const server = createVoiceServer(opts);
  server.listen(port, () => {
    console.log(`vivify voice-server listening on :${port}`);
    // Background so /health is up immediately; the first real Speak lands after this completes.
    void warmUp(opts);
  });
  return server;
}
