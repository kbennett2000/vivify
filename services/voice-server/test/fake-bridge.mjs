// Fake SAPI4 bridge — a TEST DOUBLE for the HTTP layer (NOT the engine). Mimics
// sapi4-mouth.exe's CLI: writes a tiny valid WAV to --wav and a canned non-empty
// mouth timeline to --timeline, then exits 0. Lets CI exercise the full server
// flow (spawn → read → respond) without Wine. It proves plumbing, not the voice.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (key) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
};

const wavPath = arg('--wav');
const timelinePath = arg('--timeline');
if (!wavPath || !timelinePath) {
  process.stderr.write('fake-bridge: missing --wav/--timeline\n');
  process.exit(2);
}

// Minimal valid 16-bit mono 11025 Hz WAV with a few silent samples.
const samples = 16;
const dataLen = samples * 2;
const wav = Buffer.alloc(44 + dataLen);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataLen, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(11025, 24);
wav.writeUInt32LE(11025 * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataLen, 40);
writeFileSync(wavPath, wav);

const timeline = {
  events: [
    { timeMs: 0, shape: 0, phoneme: 0, mouth: { height: 0, width: 0, upturn: 0 } },
    { timeMs: 50, shape: 5, phoneme: 65, mouth: { height: 5, width: 3, upturn: 1 } },
    { timeMs: 120, shape: 2, phoneme: 66, mouth: { height: 2, width: 4, upturn: 0 } },
  ],
};
writeFileSync(timelinePath, JSON.stringify(timeline));

// Cycle 10: emit a representative `[timing]` stderr line (mirrors the real
// sapi4-mouth.cpp output) so the server flow can be exercised end-to-end —
// parseBridgeTiming(stderr) → onTiming. Numbers are arbitrary-but-fixed; the
// server test asserts passA_totalMs=300 and totalMs=400 round-trip through.
process.stderr.write(
  '[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=300 passB_ttfbMs=4 passB_totalMs=80 writeMs=1 totalMs=400\n',
);
process.exit(0);
