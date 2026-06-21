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

### Fix: capture-start race (clipped opening audio)
On-screen, single-pass clipped the **first ~2–3s** of audio, and the returned WAV sizes **varied per
request** for the same phrase. Root cause: the server spawned `parec` and **immediately** spawned the
bridge, so synthesis began before `parec` was actually recording — the opening words played to the null
sink before the recorder had its first sample, and were simply lost.

Fix (`src/server.ts`, `src/wav.ts`):
- **Capture-readiness gate.** Synthesis is now gated on the capture's **first sample**: the server starts
  `parec`, waits until its stdout produces a byte (proof the null-sink monitor is open and flowing), and
  only **then** spawns the bridge. The first sample drives a `captureReady` promise; the elapsed time is
  recorded as `captureReadyMs`.
- **Fast gate, low added latency.** `DEFAULT_CAPTURE` now uses `parec --latency-msec=30` so the first
  fragment flushes in tens of ms, and the null sink never suspends (its monitor streams immediately), so
  the gate resolves quickly rather than adding meaningful latency.
- **`trimLeadingSilence` lead-in guard.** A `leadInMs` option (default **40ms**) keeps a small margin of
  audio *before* the detected onset, so the trim can't shave a soft leading consonant. The lead-in is a
  whole number of frames, preserving alignment; t≈0 still maps to the timeline's first viseme.
- **Honest failure.** If the capture never goes live within `captureReadyTimeoutMs` (default **5000**, env
  `VIVIFY_CAPTURE_READY_MS`) — or `parec` dies before producing a sample — `/tts` returns a loud **500**
  rather than a clipped or faked WAV.
- **Timing.** `[tts-timing]` now includes `captureReady=` (the gate paid before synthesis).

### Fix: first-Speak cold capture
The **first** Speak after container start still clipped its opening, even with the readiness gate. Root
cause: the startup warmup primed only the **engine** (it paged in the TruVoice DLLs), so the first real
Speak still cold-started the **capture path** (parec connect, the null-sink monitor, winepulse playback,
the trim). That cold path lost the opening words once.

Fix: the server now runs a full-pipeline `warmUp()` at startup (`src/server.ts`) — one real synthesis over
the **exact production path** (parec + null-sink monitor + winepulse + trim + engine) — so the first real
Speak is warm end-to-end. It runs in the background after `listen()` so `/health` is up immediately; the
container logs `[warmup] priming…` then `[warmup] done in Nms`. The entrypoint's old bridge-only warmup is
**removed** (superseded — it left the capture path cold). `warmUp` is best-effort: a failure only means the
first Speak runs colder, never a crash.

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

  **Fix: teardown eliminated (SIGKILL on `[timing]`).** Operator measurement showed teardown ≈2000ms
  even with `_Exit` — the bridge's fast exit does **not** skip Wine's process teardown, because that work
  (audio device/DLL unload) is **kernel-/Wine-side and runs after the `[timing]` print**, outside the
  bridge's control. By the time the bridge has printed `[timing]`, the useful work is already done: the
  timeline file is written + closed and all audio has played to the null sink. So the server now
  **SIGKILLs the bridge the moment it sees `[timing]` on stderr** (`src/server.ts`), skipping that ~2s of
  dead teardown. The close handler treats this deliberate kill as **success** (the kill exits by signal,
  i.e. non-zero, but `killedAfterDone` is set); a real failure **before** `[timing]` still 500s. Net:
  teardown → ~0, total → ~4000ms.
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
| gap (load/teardown) | ~2170ms | _tbd_ | teardown was ~2000ms even with `_Exit` (it's kernel-/Wine-side, after `[timing]`); now skipped by SIGKILL-on-`[timing]` → teardown ~0. `wineLoadMs` is the residual |
| capture-start clip | first ~2–3s lost; varying WAV sizes | **fixed** | gate on first captured sample before synthesis; sizes consistent |
| first-Speak cold clip | opening clipped once after container start | **fixed** | full-pipeline `warmUp()` at startup (entrypoint bridge-only warmup removed) |
| **`[tts-timing]` total** | **~7960ms** | _tbd_ | target ~4000ms (Pass A floor + small overhead; teardown skipped) |

`[tts-timing]` now reports `captureReady=` — the readiness gate paid before synthesis starts.
Background measurement that prompted these fixes:
`total=6011ms (captureReady=747 bridgeWall=5055 wineLoad=163 teardown=2000 capture=6004 encode=0) bridge[init=8 passA=2873 write=0 self=2892]` — teardown=2000ms is the dead time now skipped by SIGKILL-on-`[timing]`.

## What is verified where
- **CI (this repo, no Wine/PA):** `wrapPcmToWav` + `trimLeadingSilence` unit tests; a server test with an
  injected `captureCommand` (fake-capture emits leading-silence + tone PCM) + timeline-only fake-bridge →
  valid RIFF/WAVE response built from the capture, aligned timeline, and the empty-capture → 500 path.
  `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green.
- **Operator (rebuild + curl/Speak):** `[tts-timing] total` drops toward ~4000ms (Pass A floor + small
  overhead, teardown skipped); `teardown` reads ~0; the **FIRST Speak's opening is audible** (after the
  container logs `[warmup] done`); the WAV is valid RIFF/WAVE and plays; the **full phrase is audible from
  the first word** (no clipped opening); **WAV sizes are consistent across requests** for the same phrase;
  `captureReady=` appears in `[tts-timing]`; lip-sync stays dense + aligned in MASH. If capture yields
  no/garbled audio, the opening is clipped (first or subsequent Speak), sizes vary, teardown stays ~2s, or
  lip-sync drifts → STOP + report (don't paper over it). Numbers fill the table above.

## Non-goals / known limitations
Persistent-engine bridge daemon (report the residual `wineLoadMs`, defer). Forced parallel passes (moot
under single-pass). No Pass-B fallback (the win is removing it — honest failure instead). No
`@vivify/core`/browser change. Alignment is best-effort via leading-silence trim; operator confirms sync.
See ADR-0023.
