# ADR-0022: Measure voice latency per stage; warm the engine at container start; keep the two passes serial
Status: Accepted · Date: 2026-06-21

## Context
Cycle 10 (`docs/cycles/cycle-10-latency.md`, branch `cycle-10-latency`) attacks the ~2–3s delay between a `speak()` call and audio. That delay had never actually been measured — it was a guess. The constitution forbids "close enough" shortcuts, and the directive here was measure-first / don't force a risky change: trim only what we can see, and only where the trim is provably safe.

The voice path is the two-pass real-time-audio bridge from ADR-0019: Pass A (`CLSID_MMAudioDest`, real-time) produces dense, accurate viseme timing in roughly utterance-length wall time; Pass B (`CLSID_AudioDestFile`) writes the WAV. The interpolation work that would have softened the lip-sync cost was deferred in ADR-0017, so Pass A's real-time floor stands. The scope of this cycle is the **server + bridge only** (`services/voice-server`); `@vivify/core`, `@vivify/acs`, and the IR are untouched.

## Decision

**1. Per-stage latency instrumentation, bridge → server.**
The bridge (`services/voice-server/bridge/sapi4-mouth.cpp`) emits one machine-readable stderr line per run, using the same `GetTickCount` clock it already uses for viseme timing: `[timing] initMs=… passA_ttfbMs=… passA_totalMs=… passB_ttfbMs=… passB_totalMs=… writeMs=… totalMs=…`. The server (`src/server.ts`) parses it with a new pure helper `parseBridgeTiming` (`src/timing.ts`), times its own stages (bridge child wall time, file read, base64 encode, total handler), and logs a combined `[tts-timing]` breakdown per `/tts` request. An injectable `onTiming(TtsTiming)` hook (mirroring the existing injectable `bridgeCommand`) exposes the breakdown for CI assertions. Why: you can't trim what you can't see, and the breakdown is what separates the inherent floor (Pass A) from the trimmable cold-start.

**2. Warm the engine: persistent Xvfb + wineserver at container start, not per request.**
Previously the server spawned `xvfb-run -a wine sapi4-mouth.exe` for **every** `/tts`, paying a fresh Xvfb spawn plus a wineserver/wineboot cold-start each time. Now `entrypoint.sh` starts ONE Xvfb on `:99`, runs `wineboot` once, keeps `wineserver -p` persistent, and does a best-effort warmup synth (pages in the TruVoice DLLs / fills the OS file cache) before `exec`'ing the server. The default bridge command (`server.ts` `DEFAULT_BRIDGE` and the Dockerfile `ENV VIVIFY_SAPI4_BRIDGE`) drops `xvfb-run -a` to a plain `wine …`; `DISPLAY=:99` is set in the Dockerfile. Cold-start is a per-request cost paid on every Speak; making it a once-per-container cost is low-risk and takes it off the hot path. Tradeoff accepted: the per-request command now depends on the persistent Xvfb being live — if Xvfb fails to come up, requests fail with a clear error (entrypoint logs a WARN). What warming does **not** remove: each per-request bridge process still runs its own COM `CoCreateInstance` / engine `Select` init, now measured as `initMs`. Fully eliminating that needs a persistent-engine bridge daemon, which is deferred (same risk class as the single-pass rewrite).

**3. Keep the two synthesis passes SERIAL — do not force parallelism this cycle.**
Pass A and Pass B still run one after the other. Parallelizing was considered and explicitly **not** done: SAPI4/TruVoice concurrency safety (COM apartment threading plus single-audio-device contention for two simultaneous synthesis sessions) cannot be verified without a real Wine+audio environment, and the directive was measure-first. The measured `passB_totalMs` is recorded as the candidate saving a future cycle could recover; the lower-risk shape noted for that work is two separate bridge **processes** (the file dest needs no audio device) rather than in-process threads.

## Consequences
- The latency budget is now legible and splits three ways:
  - **Inherent (cannot trim here):** Pass A's real-time synthesis (`passA_totalMs`) — the floor for dense, accurate lip-sync, unchanged by ADR-0017's interpolation deferral.
  - **Trimmed this cycle:** the Xvfb spawn + wineserver/wineboot cold-start, moved from per-request to once-per-container by warming.
  - **Left on the table (future cycles):** Pass B (`passB_totalMs`, recoverable via two parallel bridge processes) and the per-request COM/engine init (`initMs`, recoverable via a persistent-engine bridge daemon). A single-pass rewrite remains the larger, riskier prize.
- Verification boundary is honest. The bridge C++ timing and the warm path are **not** runnable in the dev sandbox (no Wine/audio); they are operator-verified on rebuild. The server-side parsing (`parseBridgeTiming` / `formatTtsTiming`) and the `onTiming` flow **are** CI-tested against the fake bridge. The real before/after numbers come from the operator's run and land in the cycle doc's table.
- New per-request dependency on a live persistent Xvfb (decision 2's tradeoff): a container-level failure mode replaces the old per-request spawn, surfaced via a clear error and an entrypoint WARN.

## Related
- ADR-0019 — the two-pass real-time-audio bridge (Pass A `MMAudioDest` / Pass B `AudioDestFile`) this cycle instruments and warms.
- ADR-0017 — the interpolation deferral that leaves Pass A's real-time floor as the inherent latency.
- `docs/cycles/cycle-10-latency.md` — the cycle this ADR records, including the operator's before/after timing table.
