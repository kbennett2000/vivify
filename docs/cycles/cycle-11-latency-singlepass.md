# Cycle 11 — voice latency, the real wins (single-pass + close the gap)

## Goal
Cut the ~8s Speak latency toward its real floor. PR #12's instrumentation located the cost; this cycle
removes the two avoidable parts:

1. **Kill Pass B** — the bridge synthesized the whole phrase **twice** (Pass A `CLSID_MMAudioDest` for the
   dense events, Pass B `CLSID_AudioDestFile` for the WAV). Capture the audio from the SAME real-time pass
   that produces the events (record the PulseAudio null-sink monitor during Pass A). One pass → both dense
   events AND audio. Expected saving ≈ Pass B (~2.8s).
2. **Close the ~2170ms gap** — bridge self-time was 5789ms but server total 7960ms. Locate the ~2.2s spent
   outside both synthesis passes, then close the cheap part.

Scope: **`services/voice-server` only** (bridge C++, Node server, pulse config). No `@vivify/core`/browser
change. The user rebuilds + curls/Speaks to measure; the null-sink capture is the
**unverifiable-in-sandbox** part — built honestly, with a loud failure (never a faked silent WAV) if the
capture/format/alignment doesn't hold up.

## The measured starting point (PR #12, steady-state, 26 events)
`[tts-timing] total=7960ms | bridge[init=18 passA=2912 passB=2853 write=0 total=5789]`
- init ~18ms (warm — Cycle 10 did its job), Pass A ~2900ms (the **inherent floor**), Pass B ~2850ms
  (pure overhead), plus a ~2170ms gap (server total − bridge total).

## WIN 1 — single pass via null-sink monitor capture
The engine already plays the full utterance to the `dummy` null sink during Pass A. PulseAudio exposes
`dummy.monitor`; `parec` (pulseaudio-utils, already in the image) records it **concurrently** with Pass A.

- **`bridge/sapi4-mouth.cpp`** — Pass B removed. The bridge is now single-pass: Pass A (`MMAudioDest`) →
  events + real-time playback to the null sink → write the timeline. `--wav` is accepted but ignored (the
  bridge no longer produces audio). The `[timing]` line drops `passB_*`.
- **Server capture (`src/server.ts`)** — a new injectable `captureCommand` (mirrors `bridgeCommand`;
  default `parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1`). Per `/tts`: start
  capture → spawn the single-pass bridge → on bridge exit wait a small grace (~200ms) for the tail → stop
  capture (SIGTERM), collecting **raw PCM** from capture stdout. Raw PCM (not a parec-written WAV) is
  deliberate: no header to finalize, so an abrupt stop still yields valid samples — Node builds the header.
- **`src/wav.ts` (pure, unit-tested)** — `wrapPcmToWav(pcm, {rate, channels, bits})` → valid RIFF/WAVE;
  `trimLeadingSilence(wav, …)` → trims leading near-zero samples (amplitude threshold + N consecutive) so
  WAV[0] ≈ first audible sample ≈ timeline t≈0. This is the alignment mechanism.
- **`pulse-null.pa`** — pin the sink format (`format=s16le rate=44100 channels=1`) so the monitor is
  deterministic and `parec` captures it 1:1 (no resample guesswork).
- **Honest failure:** empty/below-min capture → loud **500** ("null-sink capture produced no audio"); the
  server never returns a silent WAV. The `{audioWavBase64, mouthTimeline}` contract is otherwise identical.

## WIN 2 — locate + close the gap
The gap is wall-time inside the child's lifetime but **outside** `main()`'s self-measured window: Wine
process **load** (spawn→main) and **teardown** (after the timing print → exit: COM/DLL unload, device
close/drain).

- **Locate** — the bridge prints a `[boot]` line as the first statement in `main()`; the server timestamps
  the child's **first stderr byte** ⇒ `wineLoadMs ≈ firstByte − spawn`. With `bridgeMs` (spawn→close) and
  the bridge's own `totalMs`, the gap splits into **load / self / teardown**, all surfaced in
  `[tts-timing]`.
- **Close the cheap part (teardown)** — after writing the timeline + flushing, the bridge does
  `fflush(NULL); _exit(rc)`, skipping `CoUninitialize` + DLL unload + device close/drain (safe for a
  one-shot process; the OS/Wine reclaims everything). Teardown sits *after* the timing print, so this is
  the most likely home of the gap. Single-pass also removes one MMAudioDest open/close cycle.
- **Residual** — if a large `wineLoadMs` remains (the spawn→main prologue), the only further fix is a
  **persistent-engine bridge daemon** — a large rewrite, **out of scope here**, reported with its number.

## Diagnostic (resolved, no rabbit-hole)
"Pass A 1100ms on warmup vs 2900ms steady" is **not** backwards. Pass A is real-time playback, so its
duration ≈ utterance length. The warmup phrase is `"warm"` (entrypoint.sh, ~4 chars); the steady test was
the much longer "This is a test, this is only a test." Different lengths fully explain it.

## Measured results (operator — to be filled from the rebuild)
No Wine/PulseAudio in the dev sandbox, so these come from the user's `docker run` + curl.

| Metric | Before (PR #12) | After (this cycle) | Notes |
|--------|-----------------|--------------------|-------|
| Pass A total | ~2912ms | _tbd_ | the inherent real-time floor (unchanged) |
| Pass B total | ~2853ms | **removed** | killed by single-pass capture |
| gap (load/teardown) | ~2170ms | _tbd_ | `_exit` closes teardown; `wineLoadMs` is the residual |
| **`[tts-timing]` total** | **~7960ms** | _tbd_ | target: toward Pass A floor + small overhead |

## What is verified where
- **CI (this repo, no Wine/PA):** `wrapPcmToWav` + `trimLeadingSilence` unit tests; a server test with an
  injected `captureCommand` (fake-capture emits leading-silence + tone PCM) + timeline-only fake-bridge →
  valid RIFF/WAVE response built from the capture, aligned timeline, and the empty-capture → 500 path.
  `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green.
- **Operator (rebuild + curl/Speak):** `[tts-timing] total` drops substantially toward the ~2900ms floor;
  the WAV is valid RIFF/WAVE and plays; lip-sync stays dense + aligned in MASH. If capture yields no/garbled
  audio or lip-sync drifts → STOP + report (don't paper over it). Numbers fill the table above.

## Non-goals / known limitations
Persistent-engine bridge daemon (report the residual `wineLoadMs`, defer). Forced parallel passes (moot
under single-pass). No Pass-B fallback (the win is removing it — honest failure instead). No
`@vivify/core`/browser change. Alignment is best-effort via leading-silence trim; operator confirms sync.
See ADR-0023.
