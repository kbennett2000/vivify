// Failing test double for the HTTP layer — mimics a bridge that crashes. Writes
// nothing and exits non-zero so the server's non-zero-exit error path (500) can
// be exercised in CI. Not a mock of the code under test; a separate process.

process.stderr.write('fail-bridge: simulated engine failure\n');
process.exit(1);
