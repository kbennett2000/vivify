// Fake null-sink capture that is SLOW to produce its first sample — a TEST DOUBLE
// for a `parec` that takes a while to open the monitor and start streaming. It DELAYS
// the first PCM chunk by DELAY_MS (env var, default ~150ms), then streams the SAME
// leading-silence-then-tone raw s16 PCM as fake-capture.mjs, and exits 0 on SIGTERM.
//
// Drives the Cycle 11 readiness gate's WAITING path: the server must wait for the
// first sample (rather than spawning the bridge immediately) and must NOT fail as long
// as a sample eventually arrives within captureReadyTimeoutMs — proving the gate waits
// for a slow-but-working capture instead of clipping the opening audio.

import process from 'node:process';
import { setTimeout } from 'node:timers';

const delayMs = Number(process.env.DELAY_MS ?? 150);

// 2000 silent frames (4000 bytes of zero) then 4000 frames at amplitude ~8000 —
// identical PCM to fake-capture.mjs, just emitted after a delay.
const silentFrames = 2000;
const toneFrames = 4000;
const buf = Buffer.alloc((silentFrames + toneFrames) * 2);
for (let i = silentFrames; i < silentFrames + toneFrames; i++) {
  buf.writeInt16LE(8000, i * 2);
}

process.on('SIGTERM', () => process.exit(0));

// Stay alive (so stdout flushes and the recorder keeps "running") until killed.
const keepAlive = setInterval(() => {}, 1_000_000);

// Emit nothing until the delay elapses, THEN stream the PCM. The server's readiness
// gate must remain pending across this gap and resolve only on this first chunk.
setTimeout(() => {
  process.stdout.write(buf);
}, delayMs);

// (keepAlive referenced so linters don't flag it; cleared on exit by process teardown.)
void keepAlive;
