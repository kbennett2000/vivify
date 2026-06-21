// Fake null-sink capture — a TEST DOUBLE for `parec` (NOT a mock of the server).
// Mimics `parec --format=s16le …`: streams RAW little-endian s16 PCM to STDOUT
// (no WAV header — exactly what the server expects to wrap itself), beginning with
// LEADING SILENCE then a loud tone, and keeps running until SIGTERM, then exits 0.
// Lets CI drive the single-pass flow: the server collects this PCM, wraps + trims
// it, and must return a valid RIFF/WAVE whose leading silence has been trimmed.

import process from 'node:process';

// 2000 silent frames (4000 bytes of zero) then 4000 frames at amplitude ~8000.
const silentFrames = 2000;
const toneFrames = 4000;
const buf = Buffer.alloc((silentFrames + toneFrames) * 2);
for (let i = silentFrames; i < silentFrames + toneFrames; i++) {
  buf.writeInt16LE(8000, i * 2);
}

// Emit the PCM, then idle until the server stops us (SIGTERM).
process.stdout.write(buf);

process.on('SIGTERM', () => process.exit(0));

// Stay alive (so stdout flushes and the recorder keeps "running") until killed.
setInterval(() => {}, 1_000_000);
