# ADR-0023: Single-pass synthesis via null-sink monitor capture; close the teardown gap with a fast exit
Status: Accepted · Date: 2026-06-21

## Context
Cycle 11 (`docs/cycles/cycle-11-latency-singlepass.md`, branch `cycle-11-latency-singlepass`) continues the latency work, scoped to the **server + bridge only** (`services/voice-server`); `@vivify/core`, `@vivify/acs`, and the IR are untouched.

PR #12's per-stage instrumentation (ADR-0022) measured a steady-state Speak at `total=7960ms`: init ~18ms + Pass A ~2900ms + Pass B ~2850ms + a ~2170ms unexplained gap (server total minus bridge self-time). This isolated two avoidable costs on top of the inherent floor:

- **The redundant second pass.** The bridge was two-pass (ADR-0019): Pass A (`CLSID_MMAudioDest`, real-time) for the dense, accurate viseme events, and Pass B (`CLSID_AudioDestFile`) purely to produce the WAV — because `MMAudioDest` cannot tee its rendered PCM (the ADR-0019 finding). Pass B is a full second synthesis (~2.8s) whose only output is audio Pass A already rendered.
- **The ~2170ms gap.** Wall time inside the child process but outside `main()`'s self-measured window: the Wine process LOAD (spawn → `main`) and TEARDOWN (after the timing print → process exit: `CoUninitialize` + DLL unload + device close/drain).

A side diagnostic — "Pass A 1100ms on warmup vs 2900ms steady, looks backwards" — is **resolved, no action**: Pass A is real-time playback, so its duration tracks utterance length; the warmup phrase ("warm") is far shorter than the steady test sentence.

## Decision

**1. Single pass — capture the null-sink monitor instead of synthesizing a second time (kill Pass B).**
The bridge is now single-pass: Pass A (`MMAudioDest`, real-time) only. While Pass A plays in real time, the server records the PulseAudio null sink's `.monitor` source with `parec`, so one real-time pass yields BOTH the dense viseme events AND the audio. The bridge no longer writes a WAV (`--wav` is accepted but ignored). The server orchestrates the capture via a new injectable `captureCommand` (default `parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1`), wraps the captured RAW PCM into a RIFF/WAVE in Node (`src/wav.ts` `wrapPcmToWav`), and trims leading silence (`trimLeadingSilence`) so the WAV's t=0 aligns with the timeline's first viseme. The null sink format is pinned (`pulse-null.pa`: s16le / 44100 / mono) so the monitor capture is deterministic — no resample guesswork. The `{ audioWavBase64, mouthTimeline }` contract is unchanged. Expected saving ≈ Pass B (~2.8s).
- **Why RAW PCM, not a `parec`-written WAV:** there is no WAV header to finalize, so even an abrupt `SIGTERM` stop yields valid samples — Node owns the header.
- **This supersedes ADR-0019's two-pass approach for the WAV source only.** The dense-events requirement (real-time `MMAudioDest`) is unchanged; only the audio source changes — monitor capture instead of a second `AudioDestFile` pass.
- **HONEST FAILURE (a project non-negotiable — no faking):** if the capture yields no audio (empty PCM) or only silence (trims to empty), the server returns a loud 500, NOT a silent or faked WAV. The real capture path is unverifiable in the sandbox (no Wine/PulseAudio in CI); it is operator-verified, and the directive was explicit — if the capture/format/alignment fights, STOP and report rather than fake the audio.

**2. Close the ~2170ms gap: locate it, then fast-exit the bridge.**
To locate the split, the bridge prints a `[boot]` line as `main()`'s first statement and the server timestamps the child's first stderr byte, so `wineLoadMs ≈ firstByte − spawn`. Combined with `bridgeMs` (spawn → close) and the bridge's own `totalMs`, the gap decomposes into load / self / teardown, all surfaced in `[tts-timing]` (`src/timing.ts`: added `wineLoadMs` / `captureMs`, computed teardown). To CLOSE the cheap part, the bridge does `fflush(NULL); _Exit(rc)` after writing the timeline, skipping the graceful COM/DLL/device teardown that sits after the timing print — safe for a one-shot process, since the OS/Wine reclaims everything. Single-pass also removes one `MMAudioDest` open/close cycle.
- **RESIDUAL / future work:** if a large `wineLoadMs` (the spawn → `main` prologue) remains, the only further fix is a persistent-engine bridge daemon (keep the Wine process alive, synthesize on demand) — a large rewrite, deliberately OUT OF SCOPE this cycle and reported with its measured number. This is the remaining structural cost.

### Amendment 2026-06-21 (fixing Cycle 11 / PR #13): gate synthesis on the capture being live.
On-screen testing of the single-pass path revealed the audio was CLIPPED at the start — the first ~2–3s of speech was missing and WAV sizes varied per request: a classic start race. Root cause: the server spawned `parec` and then immediately spawned the bridge, but **spawning `parec` ≠ `parec` streaming** — `parec` has connect/startup latency, so the engine reached real-time playback before the null-sink monitor was actually being recorded, losing the opening audio.

**3. Wait for the capture's first PCM sample before triggering synthesis.**
The server now blocks on proof that the monitor is open and flowing — the capture's first `stdout` chunk — BEFORE it spawns the bridge. Synthesis is gated on this readiness.
- **Capture-readiness gate:** resolves on the first `stdout` chunk; rejects if no sample arrives within `captureReadyTimeoutMs` (default 5000ms, env `VIVIFY_CAPTURE_READY_MS`) or the capture process dies first. A reject is a loud 500 — NEVER a clipped, silent, or faked WAV (the honest-failure boundary again).
- **Timing-independent by construction:** gating on first-sample makes the result independent of capture-start latency. The leading silence between capture-live and the engine's `AudioStart` is then removed by `trimLeadingSilence` — which is also why WAV sizes now stabilize across requests.
- **Why the gate resolves fast instead of deadlocking:** the null sink never suspends (no `module-suspend-on-idle` loaded), so its `.monitor` streams continuous silence the instant `parec` connects. `parec --latency-msec=30` makes that first sample flush promptly, so the gate resolves in ~tens of ms and adds little to the ~5300ms total.
- **`leadInMs` guard on `trimLeadingSilence`** (default 40ms): keeps a small margin before the detected onset so a soft leading consonant isn't shaved. It aligns the WAV's t≈0 to the timeline's first viseme safely, rather than trimming flush to the first loud sample.

## Consequences
- **Latency budget after this cycle:** Pass A's real-time synthesis remains the inherent floor (unchanged). Pass B (~2.8s) is eliminated by overlapping audio capture with Pass A. The teardown portion of the gap is closed via `_Exit`. `wineLoadMs` is the named residual, addressable only by a persistent-engine daemon (deferred).
- **New failure mode:** capture problems now fail LOUDLY (a 500) rather than silently degrading into a quiet or empty WAV. Fidelity over graceful degradation, per the constitution.
- **Verification boundary is honest.** `src/wav.ts`'s pure functions (`wrapPcmToWav`, `trimLeadingSilence`) and the server orchestration flow with an injected fake capture ARE CI-tested. The real PulseAudio monitor capture and the single-pass bridge (C++) are NOT runnable in the dev sandbox (no Wine/PulseAudio); they are operator-verified on rebuild, with the real numbers landing in the cycle doc.
- **No third-party IP.** No Microsoft/L&H binaries, `.acs` files, or Wine prefix are involved.
- **New assumed dependency (amendment 2026-06-21):** the architecture now ASSUMES the null-sink monitor streams when idle (true with no `module-suspend-on-idle` loaded). If on some host it does not, the readiness gate fails loudly (a 500 with a clear message) rather than clipping the audio — the honest-failure boundary, operator-verified on rebuild (no Wine/PulseAudio in CI). The gate's cost is surfaced as `captureReady=` in the `[tts-timing]` log.

## Related
- ADR-0019 — the two-pass real-time-audio bridge; **superseded for the WAV source** (monitor capture replaces the Pass B `AudioDestFile` synthesis; the real-time `MMAudioDest` events path is unchanged).
- ADR-0022 — per-stage instrumentation + warm engine; the init/cold-start work this cycle builds on, and the PR #12 measurements that motivated it.
- `docs/cycles/cycle-11-latency-singlepass.md` — the cycle this ADR records, including the operator's before/after timing table.
