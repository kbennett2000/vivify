// Fake null-sink capture that produces NO audio — a TEST DOUBLE for `parec` when
// the sink never received any samples. Writes nothing to stdout and exits 0 (on
// SIGTERM or immediately). Drives the server's honest-failure path: empty capture
// → 500 ("null-sink capture produced no audio"), never a faked silent WAV.

import process from 'node:process';

process.on('SIGTERM', () => process.exit(0));

// Stay alive (writing nothing) until the server stops us.
setInterval(() => {}, 1_000_000);
