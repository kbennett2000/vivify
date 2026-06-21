// Fake SAPI4 bridge that SIMULATES Wine's slow teardown — a TEST DOUBLE for the
// Cycle 11 teardown-skip fix. It does everything fake-bridge.mjs does (writes the
// SAME 3 canned mouth events to --timeline, emits `[boot]` then the SAME single-pass
// `[timing]` line on stderr) BUT THEN, instead of exiting immediately, it SLEEPS
// ~3000ms before exiting — modeling the ~2s of Wine process teardown that happens
// AFTER the bridge prints `[timing]` and after the timeline is written + closed.
//
// The server's fix watches stderr for `[timing]` and SIGKILLs the bridge the moment
// it appears (skipping this dead time). The timeline + stderr are flushed BEFORE the
// sleep, so the server can read the timeline and see `[timing]` even if it never waits
// for this slow close. SIGKILL can't be handled here — which is the whole point: the
// server reaps us instead of waiting out the sleep. Dependency-free.

import { writeFileSync } from 'node:fs';
import { setTimeout as setTimeoutTimer } from 'node:timers';

const args = process.argv.slice(2);
const arg = (key) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
};

const timelinePath = arg('--timeline');
if (!timelinePath) {
  process.stderr.write('fake-bridge-slow-exit: missing --timeline\n');
  process.exit(2);
}

// SAME 3 canned events as fake-bridge.mjs.
const timeline = {
  events: [
    { timeMs: 0, shape: 0, phoneme: 0, mouth: { height: 0, width: 0, upturn: 0 } },
    { timeMs: 50, shape: 5, phoneme: 65, mouth: { height: 5, width: 3, upturn: 1 } },
    { timeMs: 120, shape: 2, phoneme: 66, mouth: { height: 2, width: 4, upturn: 0 } },
  ],
};
// writeFileSync flushes + closes the file before we return, so the timeline is on disk
// and readable the instant the server SIGKILLs us after seeing `[timing]`.
writeFileSync(timelinePath, JSON.stringify(timeline));

// `[boot]` first (the wineLoad marker), then the SAME single-pass `[timing]` line.
// Synchronous writes to stderr flush before the sleep, so the server sees `[timing]`.
process.stderr.write('[boot] fake bridge up\n');
process.stderr.write('[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=300 writeMs=1 totalMs=320\n');

// Simulate Wine's slow teardown: DON'T exit now. If the server's teardown-skip fix is
// working it SIGKILLs us on `[timing]` long before this fires; if the fix regressed, the
// request would block on this slow close — which the server test asserts against.
setTimeoutTimer(() => process.exit(0), 3000);
