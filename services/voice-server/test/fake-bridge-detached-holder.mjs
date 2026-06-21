// Fake SAPI4 bridge that replicates WINE'S actual teardown behavior — the test double
// that gives the resolve-on-`[timing]` fix its DETERMINISTIC proof. Unlike
// fake-bridge-slow-exit.mjs (a single Node process whose stderr pipe closes the instant
// SIGKILL lands, so an await-`'close'` server would still return promptly), this one models
// the real failure mode: SIGKILL of the launcher does NOT promptly close the child's stderr
// PIPE, because a surviving detached grandchild still holds that pipe's write end open ~3s.
//
// CRITICAL ORDERING (this is what a previous version got wrong): spawn the holder and WAIT
// for its `'spawn'` event — so it is genuinely alive, in its own session (detached), and
// already holding the inherited stderr fd — BEFORE printing `[timing]`. The server SIGKILLs
// THIS process the instant it sees `[timing]`; `child.kill` targets only this pid, and the
// holder is a session leader (detached), so the SIGKILL can't reach it. Thus the stderr pipe
// stays open ~3s after this process dies. If we printed `[timing]` first (as the buggy
// version did) and then raced `process.exit(0)`/SIGKILL against the holder's fork+exec, the
// holder would not survive and the pipe would close at ~30ms — making the test pass even
// against an await-`'close'` server (validation theater). Order matters.
//
// Net: a server that resolves on the `[timing]` LINE returns in ms; a server that waits for
// the stderr stream to `end`/`'close'` would block ~3s here. The test asserts <1.5s.

import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (key) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
};

const timelinePath = arg('--timeline');
if (!timelinePath) {
  process.stderr.write('fake-bridge-detached-holder: missing --timeline\n');
  process.exit(2);
}

// SAME 3 canned events as fake-bridge.mjs. Flushed + closed before we emit `[timing]`, so the
// server can read it the instant it SIGKILLs us.
const timeline = {
  events: [
    { timeMs: 0, shape: 0, phoneme: 0, mouth: { height: 0, width: 0, upturn: 0 } },
    { timeMs: 50, shape: 5, phoneme: 65, mouth: { height: 5, width: 3, upturn: 1 } },
    { timeMs: 120, shape: 2, phoneme: 66, mouth: { height: 2, width: 4, upturn: 0 } },
  ],
};
writeFileSync(timelinePath, JSON.stringify(timeline));

process.stderr.write('[boot] fake bridge up\n');

// Spawn the DETACHED grandchild that inherits our stderr fd (index 2 = the pipe to the server)
// and lives ~3000ms, and WAIT until it's actually running before continuing. `detached: true`
// puts it in its own session so the server's SIGKILL of THIS process can't reach it. The
// grandchild's setTimeout lives inside a `-e` string (not linted).
const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], {
  detached: true,
  stdio: ['ignore', 'ignore', 2], // inherit our stderr fd → holds the pipe's write end open
});
await new Promise((resolve, reject) => {
  holder.once('spawn', resolve);
  holder.once('error', reject);
});
holder.unref();

// Only NOW emit `[timing]` — the holder is alive and holding the pipe, so the pipe survives
// this process's exit + the server's SIGKILL for ~3s.
process.stderr.write('[timing] initMs=5 passA_ttfbMs=10 passA_totalMs=300 writeMs=1 totalMs=320\n');
process.exit(0);
