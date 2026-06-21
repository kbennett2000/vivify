// Fake PERSISTENT null-sink capture — a TEST DOUBLE for the Cycle-11 long-lived `parec`
// (NOT a mock of the server). Mimics `parec --format=s16le …` running for the container's
// lifetime: it streams RAW little-endian s16 PCM to STDOUT CONTINUOUSLY (a small chunk
// every ~20ms), so a capture WINDOW opened at any moment reliably collects samples. No WAV
// header — exactly what the server expects to wrap itself.
//
// The server windows this stream per request and wraps whatever PCM the window captured
// into a WAV (trimming leading silence). Each emitted chunk is mostly DIGITAL SILENCE with
// a short non-silent burst, so after trimLeadingSilence the WAV still has audible data and
// stays a valid RIFF/WAVE. Frequent small chunks ⇒ windows reliably capture bytes even
// though the server now SERIALIZES + windows. Exits 0 on SIGTERM.

import process from 'node:process';
import { setInterval, clearInterval } from 'node:timers';

// One emitted chunk ≈ 40ms of audio at 44100/mono/16-bit: round(0.040 * 44100) = 1764
// frames = 3528 bytes. Mostly silence with a short tone burst so the server's trim keeps
// real data (and the resulting WAV is non-trivial), without ever being all-silence.
const FRAMES = 1764;
const chunk = Buffer.alloc(FRAMES * 2);
// Tone burst over frames [400, 1400): amplitude ~8000. Leading silence before it exercises
// the trim; trailing silence after keeps the stream's average level low (like a real idle
// monitor) without making any single window all-silence.
for (let i = 400; i < 1400; i++) {
  chunk.writeInt16LE(8000, i * 2);
}

// Emit one chunk IMMEDIATELY on startup (so a window that opens right as the reader comes
// up still captures data, instead of waiting a full interval), then keep streaming a chunk
// every ~10ms — far more often than the server's short capture grace — so a window opened
// at any instant reliably captures at least one full chunk within a short wait.
process.stdout.write(chunk);
const timer = setInterval(() => {
  process.stdout.write(chunk);
}, 10);

process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});
