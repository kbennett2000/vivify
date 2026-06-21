# Cycle 10 — voice latency: measure + warm

## Goal
Clicking Speak has a ~2–3s delay before audio. This cycle **measures where that time goes** (per-stage
timing in the bridge + server) and **trims the low-risk cost** by warming the engine (persistent Xvfb +
wineserver, paid once at container start instead of per request). It deliberately does **not** do the
risky single-pass rewrite, and does **not** force parallel synthesis — Pass B is measured and reported as
a candidate future saving.

Scope: **`services/voice-server` only** (bridge C++, Node server, Docker entrypoint). No `@vivify/core` /
browser change. The user rebuilds the voice container + curls/Speaks to verify; the real numbers come from
that run (there is no Wine/audio in the dev sandbox — same verify boundary as Cycles 5/7).

## Where the time goes (the model)
Total `/tts` request time ≈ **engine init** + **Pass A** + **Pass B** + **server overhead** (read WAV +
base64 + transfer). The browser can't start audio until the whole request returns.

- **Pass A — `CLSID_MMAudioDest` (real-time):** the engine plays the utterance in real time so it emits the
  dense per-phoneme Visual stream (Cycle 7). Its duration ≈ **utterance length**. This is the **inherent
  floor** — dense lip-sync data only exists during real-time playback, so it can't be beaten without
  losing the mouth animation.
- **Pass B — `CLSID_AudioDestFile`:** a second synthesis pass that writes the WAV (file audio needs no
  device and renders fast). Pure overhead **on top of** the floor — runs serially after Pass A today.
- **Engine cold start:** today the server spawns `xvfb-run -a wine sapi4-mouth.exe` **per request**, so
  every Speak pays a fresh Xvfb spawn + wineserver/wineboot + engine COM init.

## What changes
### 1. Instrumentation — see the breakdown per request
- **`bridge/sapi4-mouth.cpp`** — `GetTickCount` timing (the same clock already used for viseme arrival)
  around: engine init (process start → after `CoInitialize` + voice-mode resolve), Pass A TTFB (synthesize
  start → `AudioStart`) and total, Pass B TTFB and total, timeline write, and grand total. One
  machine-readable stderr line next to the existing `[label] events=…` lines:
  `[timing] initMs=.. passA_ttfbMs=.. passA_totalMs=.. passB_ttfbMs=.. passB_totalMs=.. writeMs=.. totalMs=..`
- **`src/timing.ts`** (new) — pure `parseBridgeTiming(stderr)` → a `BridgeTiming` struct (or `null` if the
  line is absent/garbled). Unit-tested.
- **`src/server.ts`** — times bridge spawn→close (wall), `readFile`, base64 encode, total handler; logs a
  combined `[tts-timing]` breakdown (server stages + parsed bridge stages) per request. An optional
  injectable `onTiming(t)` hook (mirrors the injectable `bridgeCommand`) lets CI assert the captured
  numbers without scraping the console.

### 2. Warm the engine (the low-risk win)
- **`entrypoint.sh`** — after the PulseAudio null sink: start a **persistent Xvfb** on `:99` (`export
  DISPLAY=:99`), `wineboot --init`, start a **persistent `wineserver -p`**, then a **best-effort warmup
  synth** (`|| true`, logged) to page in the TruVoice DLLs / fill the OS file cache, then `exec "$@"`.
- **`src/server.ts`** — `DEFAULT_BRIDGE` drops `xvfb-run -a`: just `wine …/sapi4-mouth.exe` (DISPLAY +
  wineserver already up). `VIVIFY_SAPI4_BRIDGE` env override unchanged.
- **`Dockerfile`** — `ENV DISPLAY=:99`, `ENV VIVIFY_SAPI4_BRIDGE` updated to drop `xvfb-run`.

**What warming does:** removes the per-request Xvfb spawn + wineserver/wineboot cold-start and warms engine
DLL/file caches. **What it does NOT do:** it does not eliminate the per-request bridge process's own COM
`CoCreateInstance`/`Select` engine init — the `[timing] initMs` line now measures exactly that. Fully
removing it needs a **persistent-engine bridge daemon**, which is the same risk class as the deferred
single-pass rewrite → future work, with its measured potential = `initMs`.

### 3. Parallel passes — measured, not forced
Pass A and Pass B stay **serial**. SAPI4/TruVoice concurrency safety (COM apartment threading + single
audio device contention for two simultaneous synthesis sessions) can't be verified in-sandbox, so per the
directive we don't force it. The measured `passB_totalMs` is the candidate saving a future cycle could
recover; the lower-risk shape is two separate bridge *processes* (the file dest needs no audio device), not
in-process threads.

## Measured results (operator — to be filled from the rebuild)
The dev sandbox has no Wine/audio, so these come from the user's `docker run` + curl. Table to fill:

| Stage | Cold (1st Speak) | Warm (subsequent) | Notes |
|-------|------------------|-------------------|-------|
| engine init (`initMs`) | _tbd_ | _tbd_ | per-request COM init (future daemon target) |
| Pass A total (`passA_totalMs`) | _tbd_ | _tbd_ | ≈ utterance length — the **inherent floor** |
| Pass B total (`passB_totalMs`) | _tbd_ | _tbd_ | serial overhead — candidate future saving |
| server overhead | _tbd_ | _tbd_ | read WAV + base64 |
| **total request** | _tbd_ | _tbd_ | warm − cold delta = the trim from this cycle |

**Inherent vs trimmed vs left:** _inherent_ = Pass A (utterance length); _trimmed_ = per-request Xvfb +
wineserver/wineboot cold-start (now paid once at container start); _left_ = Pass B + per-request COM init
→ a future single-pass rewrite and/or persistent-engine daemon.

## What is verified where
- **CI (this repo, no Wine):** `parseBridgeTiming` unit tests (valid line → struct; missing/garbled →
  null; tolerant of extra fields) + a server test driving the fake bridge (which now emits a `[timing]`
  line) asserting `onTiming` receives the parsed bridge stages + server stages. `pnpm -r typecheck && pnpm
  -r test && pnpm lint && pnpm format` green.
- **Operator (rebuild + curl/Speak):** the `[tts-timing]` + bridge `[timing]` breakdown is visible in the
  server log (acceptance 1); first-Speak-after-start vs subsequent, and warm-build vs the old `xvfb-run`
  path, show a measurable total-latency drop (acceptance 2). Numbers go in the table above.

## Non-goals / known limitations
Single-pass rewrite (Pass A only, WAV from the null-sink monitor) — deferred, future cycle. Persistent-
engine bridge daemon — future, same risk class. Forced parallel passes. No `@vivify/core`/browser change.
See ADR-0022.

**Runtime failure mode (warming tradeoff):** the per-request bridge is now a plain `wine …` that depends
on the persistent Xvfb (`:99`) staying alive for the container's lifetime. `entrypoint.sh` checks Xvfb at
startup and logs a loud WARN if it never comes up, but it does **not** supervise/restart Xvfb if it dies
*after* startup — in that case every subsequent `/tts` fails, where the old per-request `xvfb-run -a` was
self-healing. Accepted for this cycle (the container is the unit of recovery — restart it); a supervisor is
possible future hardening.
