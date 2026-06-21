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

### Fix: captureReady variance (per-request `parec` spawn → persistent windowed source)
With the readiness gate in place, the opening was no longer clipped, but `captureReady` itself
**swung wildly per request** for the same phrase (operator: `608ms` then `1765ms`). Root cause: each
`/tts` **spawned a fresh `parec`** and set up a fresh PulseAudio stream; that per-request process
spawn + stream setup was the variable cost — the remaining variable Speak latency.

Fix (`src/capture.ts`, `src/server.ts`):
- **One persistent capture source.** A new `CaptureSource` runs **ONE** long-lived `parec` reading
  `dummy.monitor` for the container's lifetime. Per `/tts` the server **windows** that stream —
  `beginWindow()` starts buffering incoming PCM, `endWindow()` stops and returns the captured PCM.
  No per-request spawn ⇒ **no spawn/stream-setup variance**, and the capture is always live (the
  original start-race stays solved). PCM is buffered **only** while a window is open, so idle silence
  between requests is discarded and memory stays bounded. If the reader dies it respawns.
- **`/tts` is serialized.** A promise-chain mutex (`runExclusive`) runs requests one at a time so only
  **one** capture window is ever open (the source is shared). It also removes the warmup-vs-first-request
  race.
- **The per-request readiness gate is removed** (superseded — there's no per-request spawn to gate),
  and the **entrypoint keep-warm reader is removed** (superseded — the server now owns the single
  persistent reader). `VIVIFY_CAPTURE` still configures that (now persistent) reader command.
- **Metric.** `captureReady`/`capture`/`captureStop` are gone from `[tts-timing]`; the new field is
  **`windowFirstByteMs`** (`beginWindow` → first buffered chunk). With an always-on reader it's
  consistently **~tens of ms and stable** — that stability *is* the variance fix. An empty window
  (reader dead / never live) → loud **500**.

### Diagnostics
- `[tts-timing]` now also reports `captureStop=` (grace-end → `parec` actually closed) and `build=` (wrap
  the captured PCM into a WAV + trim leading silence). These split the old end-of-request gap so an
  operator can see whether stopping the recorder or building the WAV costs anything (both are expected to
  be ~0).
- A new `[tts-audio] wavMs=… timelineMs=… rawCaptureMs=… trimmedMs=…` line quantifies any clip: the final
  WAV's audio duration (`wavMs`) vs the mouth-timeline span (`timelineMs`). If `wavMs ≪ timelineMs`, the
  capture is **missing opening audio** (the WAV is shorter than the utterance the timeline describes).
  `rawCaptureMs` is the captured PCM duration before trim; `trimmedMs` is what leading-silence trim removed.

### Fix: first-Speak cold capture
The **first** Speak after container start still clipped its opening, even with the readiness gate. Root
cause: the startup warmup primed only the **engine** (it paged in the TruVoice DLLs), so the first real
Speak still cold-started the **capture path** (parec connect, the null-sink monitor, winepulse playback,
the trim). That cold path lost the opening words once. A second, independent cause: each `/tts` spawns a
**fresh** `parec`, and the `dummy.monitor` source cools/idles between requests — so even after the
full-pipeline warmup, the first Speak's per-request `parec` connected to a cold monitor and clipped.

Fix (two parts):
- The server runs a full-pipeline `warmUp()` at startup (`src/server.ts`) — one real synthesis over the
  **exact production path** (parec + null-sink monitor + winepulse + trim + engine) — so the first real
  Speak is warm end-to-end. It runs in the background after `listen()` so `/health` is up immediately; the
  container logs `[warmup] priming…` then `[warmup] done in Nms`. The entrypoint's old bridge-only warmup is
  **removed** (superseded — it left the capture path cold). `warmUp` is best-effort: a failure only means
  the first Speak runs colder, never a crash.
- A **keep-warm persistent monitor reader** runs for the container's lifetime (`entrypoint.sh`:
  `parec -d dummy.monitor >/dev/null &`). It keeps `dummy.monitor` **continuously active** so the
  per-request `parec` always connects to a **hot** monitor (no cold-start clip; smaller `captureReady`).
  Multiple monitor readers fan out, so this doesn't disturb the per-request capture; output is discarded.

### Fix: the warmup was racing the reader (it never actually warmed)
Even after the persistent `CaptureSource` landed, the first Speak still clipped — and the operator log
showed `[warmup] failed … reader not live` printing BEFORE `[capture] … is live`. Found by diff:
`createVoiceServer` fired the warmup synthesis the instant after `source.start()`, with **no wait** for the
persistent `parec` to actually be streaming → the warmup's window was empty → it threw and no-op'd, so the
cold first window was paid by the user's first real Speak.

Fix: `CaptureSource.whenLive(timeoutMs)` resolves once the reader has produced its first PCM sample (or
`false` on timeout). The startup warmup now `await source.whenLive(…)` **inside the serialize mutex** before
synthesizing — so it opens a real, non-empty window, and the first real `/tts` queues behind it. The
ordering is instrumented so the operator can SEE it: `[warmup] awaiting capture reader…` →
`[warmup] reader live after Nms — priming…` → `[warmup tts-audio] wavMs=… rawCaptureMs=…` → `[warmup] done`
(or `[warmup] skipped — reader not live within …ms`). **Honest open question this surfaces:** if the
null-sink monitor only streams *while audio plays* (not when idle), `whenLive` can't resolve before a
playback and the log reads `[warmup] skipped` — which would prove a *priming read/write* (keep the sink
running independent of a request) is the real fix. The instrumentation tells us which, without guessing.

Honest caveat: if a residual clip is **bridge-side** (winepulse playback cold-start on the playback side,
not the capture side), the `[tts-audio]` `wavMs ≪ timelineMs` metric will surface it, and the full-pipeline
`warmUp` covers that side.

### Fix: first-Speak clip was the TRIM, not the capture
A residual first-Speak opening clip remained. The `[tts-audio]` metric **isolated it**: the operator saw
`wavMs=2983 timelineMs=2212 trimmedMs=284` — `wavMs > timelineMs`, i.e. the captured WAV is **longer**
than the utterance, so the capture is **not** missing audio. The clip is the **leading-silence trim
over-shaving** the soft opening consonant, not the capture path.

Fix (`src/wav.ts`, `src/server.ts`):
- **Looser trim defaults.** `trimLeadingSilence` now defaults `threshold` 512→**150** (the old
  ≈−36 dBFS threshold detected the onset late on soft openings), `minRun` 4→**3**, and `leadInMs`
  40→**80** (keep more audio before the detected onset). The null-sink monitor is digital silence
  (zeros) when idle, so a low threshold is safe.
- **Operator env knobs.** `VIVIFY_TRIM_THRESHOLD` and `VIVIFY_TRIM_LEADIN_MS` let an operator dial the
  leading-edge alignment **without a rebuild**: raise the lead-in / lower the threshold if the opening
  word still clips; lower the lead-in if the audio leads the mouth.

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

  **Fix: teardown eliminated (resolve on `[timing]`, reap in background).** Operator measurement showed
  teardown ≈2000ms. The first attempt — "SIGKILL the bridge the moment it sees `[timing]`" — did **not**
  remove it: a warm `--no-cache` rebuild still read `total=5769ms … teardown=2002 …`, **unchanged**. The
  honest finding: that first version still **RESOLVED the request only in the bridge's `'close'` handler**,
  and `'close'` lags ~2s under Wine even after the SIGKILL — killing the `wine` launcher does **not**
  promptly close the underlying Windows process's stderr pipe, so the pipe (and thus `'close'`) stays open
  through Wine's teardown. So the 2s was the **server WAITING for `'close'`** — **not** `parec` stop (now
  measured as `captureStop`, ~0) and **not** Wine being unkillable.

  The real fix: the server now **RESOLVES the request the instant a complete `[timing] …\n` line lands on
  stderr** (its definitive success marker, printed last, after the timeline is written + closed and all
  audio has played to the null sink), then **reaps the bridge in the background** (best-effort SIGKILL +
  `unref`, **not** awaited). The `'close'` handler is only reached on the failure/early-exit path — a real
  failure **before** `[timing]` still 500s. Net: teardown is off the request's critical path → ~0, total →
  ~3500–4000ms.
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
| gap (load/teardown) | ~2170ms | _tbd_ | teardown was 2002ms even after kill-on-`[timing]` (the server still **awaited `'close'`**, which lags ~2s under Wine after the kill); now resolve-on-`[timing]` (reap in background) → teardown ~0. `wineLoadMs` is the residual |
| capture-start clip | first ~2–3s lost; varying WAV sizes | **fixed** | gate on first captured sample before synthesis; sizes consistent |
| captureReady variance | was 608↔1765ms per request (per-request `parec` spawn) | **fixed** | replaced by a persistent windowed source (no per-request spawn) ⇒ `windowFirstByteMs` ~tens of ms, stable; `/tts` serialized; entrypoint keep-warm reader removed (superseded) |
| first-Speak clip | opening clipped once after container start | **fixed** | `[tts-audio]` proved it was the TRIM (`wavMs > timelineMs`), not the capture; trim defaults loosened (threshold 150 / minRun 3 / leadIn 80) + env-tunable (`VIVIFY_TRIM_THRESHOLD` / `VIVIFY_TRIM_LEADIN_MS`) |
| **`[tts-timing]` total** | **~7960ms** | _tbd_ | target ~3500–4000ms (Pass A floor + small overhead; teardown off the critical path) |

`[tts-timing]` now reports `windowFirstByte=` (the persistent source's per-window first-chunk latency —
`captureReady`/`capture`/`captureStop` are gone) and `build=`; a `[tts-audio]` line reports
`wavMs / timelineMs / rawCaptureMs / trimmedMs` (clip diagnostic — `wavMs ≪ timelineMs` ⇒ missing opening
audio; `wavMs > timelineMs` with a clip ⇒ the trim over-shaved, dial `VIVIFY_TRIM_*`). Background
measurement (warm, post-teardown-fix) showed `total=3869 (captureReady=608)` then `5029 (captureReady=1765)`
for the same phrase with `teardown=0` held — the per-request `parec` spawn was the residual variance, now
removed by the persistent windowed source; and `[tts-audio] wavMs=2983 timelineMs=2212 trimmedMs=284`
isolated the first-Speak clip to the trim.

## First-Speak clip — the real root cause (proved by the boot log, not theorized)
The first Speak kept clipping through several rounds (trim loosening, then a `whenLive` warmup gate). The
warmup gate's instrumentation finally PROVED the cause: at boot the log printed `[warmup] failed … null-sink
capture window was empty` BEFORE `[capture] persistent monitor reader is live`. That ordering means the
null-sink `.monitor` emits **no samples until something is actually playing into the sink** — `parec`
connects but stays silent until the warmup's own playback wakes the sink, so the warmup's window was empty
and the first real Speak ate the cold first window. (Not `module-suspend-on-idle` — the config loads none;
a null sink with no active sink-input simply doesn't RUN.) **Fix (entrypoint + pulse only):** `entrypoint.sh`
now keeps a continuous stream of digital silence (`pacat … /dev/zero`) playing into `dummy`, holding the
sink RUNNING so its monitor streams from boot. Zeros add nothing to the mix → captured speech is identical;
`trimLeadingSilence` drops the idle silence. The `whenLive` warmup gate is retained (it now resolves
immediately). No `src/`, latency, or trim change. See ADR-0023 Decision 12. No CI surface (fakes can't
reproduce pulse suspend semantics); operator-verified by the boot-log ordering below.

## What is verified where
- **CI (this repo, no Wine/PA):** `wrapPcmToWav` + `trimLeadingSilence` unit tests; a server test with an
  injected `captureCommand` (fake-capture emits leading-silence + tone PCM) + timeline-only fake-bridge →
  valid RIFF/WAVE response built from the capture, aligned timeline, and the empty-capture → 500 path.
  `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green.
- **Operator (rebuild + curl/Speak):** `[tts-timing] total` is **stable every request** — ~3500–4000ms
  with **no 5s outliers** for the same phrase (the per-request `parec` spawn that caused the 608↔1765ms
  swing is gone); `teardown` reads ~0; `windowFirstByte=` is ~tens of ms and **steady** across requests
  (no per-request variance); the **FIRST Speak's opening word is audible** (after the container logs
  `[warmup] done`); the WAV is valid RIFF/WAVE and plays; the **full phrase is audible from the first
  word** (no clipped opening); **WAV sizes are consistent across requests** for the same phrase;
  `windowFirstByte=`/`build=` appear in `[tts-timing]`; **compare the `[tts-audio]` `wavMs` vs `timelineMs`
  on the first vs later Speaks** (they should track closely on both); lip-sync stays dense + aligned in
  MASH. **If still clipping the opening word or the audio leads the mouth, dial `VIVIFY_TRIM_THRESHOLD` /
  `VIVIFY_TRIM_LEADIN_MS` and re-run.** If `total` still shows 5s outliers, `windowFirstByte` varies wildly,
  capture yields no/garbled audio, sizes vary, teardown stays ~2s, or lip-sync drifts → STOP + report
  (don't paper over it). Numbers fill the table above.

## Non-goals / known limitations
Persistent-engine bridge daemon (report the residual `wineLoadMs`, defer). Forced parallel passes (moot
under single-pass). No Pass-B fallback (the win is removing it — honest failure instead). No
`@vivify/core`/browser change. Alignment is best-effort via leading-silence trim; operator confirms sync.
See ADR-0023.
