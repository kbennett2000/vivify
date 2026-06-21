// Fake SAPI4 bridge — a TEST DOUBLE for the HTTP layer (NOT the engine). Mimics
// sapi4-mouth.exe's Cycle 11 single-pass CLI: it no longer produces a WAV (the
// server captures audio from the null-sink monitor). It writes ONLY a canned
// non-empty mouth timeline to --timeline, emits a `[boot]` line then the new
// passB-less `[timing]` line on stderr, and exits 0. `--wav` may still be passed
// but is IGNORED. Proves plumbing, not the voice.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (key) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
};

const timelinePath = arg('--timeline');
if (!timelinePath) {
  process.stderr.write('fake-bridge: missing --timeline\n');
  process.exit(2);
}

// `--wav` is accepted but ignored — single-pass produces no audio here.

const timeline = {
  events: [
    { timeMs: 0, shape: 0, phoneme: 0, mouth: { height: 0, width: 0, upturn: 0 } },
    { timeMs: 50, shape: 5, phoneme: 65, mouth: { height: 5, width: 3, upturn: 1 } },
    { timeMs: 120, shape: 2, phoneme: 66, mouth: { height: 2, width: 4, upturn: 0 } },
  ],
};
writeFileSync(timelinePath, JSON.stringify(timeline));

// `[boot]` first (main()'s first statement → the server's wineLoad marker), then the
// Cycle 11 single-pass `[timing]` line (no passB_*). Numbers are arbitrary-but-fixed;
// the server test asserts passA_totalMs=300 and totalMs=320 round-trip through.
process.stderr.write('[boot] fake bridge up\n');
process.stderr.write('[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=300 writeMs=1 totalMs=320\n');
process.exit(0);
