# Cycle 7 — real-time-audio bridge (dense per-phoneme mouth data)

## Goal
Make the SAPI4 bridge emit the **full per-phoneme mouth stream** so lip-sync has real, time-varying data.
Cycle 6 proved the consumer side is correct (overlays parsed, compositor draws, `VoiceMouthOverlay`
mapping authentic) — but on-screen the lip-sync tick logged an identical `h=50 w=160 type=2 imageIndex=…`
**every** tick with `timeMs` never advancing. Root cause (empirically confirmed, and the deferred path in
ADR-0017): in **file-audio mode** (`CLSID_AudioDestFile`) the engine emits flat/sparse mouth data. The fix
is **real-time audio** (`CLSID_MMAudioDest`), which fires the dense Visual/`TTSMOUTH` stream. Scope is the
**bridge + container** only. The as-built design is recorded in **ADR-0019**.

## The contract (unchanged)
`POST /tts {text, voice}` → `{ audioWavBase64, mouthTimeline, format:"wav" }`; `GET /health → {ok:true}`.
Cycle 7 changes only **how** the bridge produces the data — the HTTP contract and the bridge CLI
(`--text-file --wav --timeline [--voice --speed --pitch]`) are identical.

## Why real-time audio needs two passes
The oracle (DoubleAgent `Core/Sapi4Voice.cpp`) creates `CLSID_MMAudioDest`
(`CoCreateInstance(CLSID_MMAudioDest, NULL, CLSCTX_SERVER, IID_IUnknown, …)`) and passes it straight to
`ITTSEnum::Select(modeGuid, &central, audio)` — the same `Select` shape the bridge already uses, just a
different audio object. Crucially, **MMAudioDest exposes no way to tee the rendered PCM** (the oracle
never reads samples back; audio goes to the OS device). So we can't get the WAV "for free" the way
file-audio gave it. The bridge therefore runs **two sequential synthesis passes**:

- **Pass A — events (real-time):** `CLSID_MMAudioDest` → `Select` → register the mouth sink → speak →
  pump messages until `AudioStop`. **Keep these dense events** as the returned `mouthTimeline`.
- **Pass B — WAV (file):** the existing `CLSID_AudioDestFile` → `IAudioFile::Set(wav)` path, unchanged.
  **Keep the WAV**; discard pass B's (sparse, file-mode) events.

Same engine/voice/text ⇒ deterministic duration, so pass A's audio-relative timestamps line up with pass
B's WAV. If pass A's `Select`/MMAudioDest creation fails (the symptom of a missing audio device), the
bridge logs the HRESULT loudly and exits non-zero — it does **not** silently fall back to sparse data.

### Per-viseme timing (real-time mode)
Each event's `timeMs` is the **wall-clock arrival** of its `Visual` callback relative to playback start
(`GetTickCount()` at the callback minus the base set at `AudioStart`, falling back to the first viseme if
`AudioStart` doesn't fire), **not** the callback's `qTimeStamp`. In real-time playback the engine fires
`Visual` as the audio plays, so arrival ≈ audio position and `timeMs` advances 0..~duration. This matches
the oracle, which also ignores `Visual.qTimeStamp` and times visemes by the audio device's play position.
(An earlier attempt using `qTimeStamp - AudioStart` collapsed every event to one large constant — that
value does not advance per viseme in MMAudioDest mode.) Documented fallback if arrival also collapses
(burst delivery): query the audio device position (`IAudio::PosnGet`) per callback. The bridge logs
`[label] events=N timeMs=[first..last]ms rawQ=[min..max] audioStart=yes|no` so the arrival span and the
(constant) raw `qTimeStamp` are both visible — the server forwards this on success as a `[bridge] …` line.

## Dummy audio device under Wine (the new unknown)
`MMAudioDest` opens a `waveOut` device inside `Select()`; a headless Wine container has no sound card.
We provide a **PulseAudio null sink** (the most reliable headless-Wine audio backend; a bare ALSA `null`
PCM is often not enumerated as a device — kept as a documented fallback):
- `pulseaudio` + `pulseaudio-utils` installed; Wine's `winepulse.drv` ships with `wine`.
- A system-mode Pulse config loads `module-null-sink` (default sink) + `module-native-protocol-unix`; an
  `ENTRYPOINT` starts `pulseaudio --system …` (root container) and waits for the socket before `node`.
- Wine is pointed at the Pulse driver; the per-request `xvfb-run -a wine` bridge inherits `PULSE_SERVER`.
- Real-time playback to the null sink runs ≈ utterance-length wall-clock (added latency, within the 120s
  bridge timeout).

This is the **main unverified step** — like Cycle 5's install, it can only be confirmed in a real
Docker+Wine environment. If it fights, the bridge's HRESULT log says so; report rather than fake it.

## What you supply (IP gate — unchanged)
No Microsoft/L&H IP is committed. `services/voice-server/vendor/` (gitignored) still holds `spchapi.exe`,
`tv_enua.exe`, and the SAPI4 SDK `speech.h`. `CLSID_MMAudioDest` must be declared in that `speech.h` (it
is part of the same SAPI4 SDK as `CLSID_AudioDestFile`); if absent the compile fails loudly.

## Build & run
```
pnpm --filter @vivify/voice-server typecheck      # refresh dist/
docker build -t vivify-voice services/voice-server
docker run --rm -p 8080:8080 vivify-voice
curl -s localhost:8080/tts -H 'content-type: application/json' \
  -d '{"text":"Your wish is my command."}' | jq '.mouthTimeline | {n: length, first: .[0], last: .[-1]}'
```

## Acceptance (proven in a real Docker/Wine environment)
PASS iff the `/tts` response's `mouthTimeline` is **dense** — dozens of events, `timeMs` **advancing**
first→last across the utterance, with `shape` (mouth height) **and** `width` **varying** — and
`audioWavBase64` decodes to a valid RIFF/WAVE. The bridge stderr (`events=N, timeMs span=[first..last]ms`)
corroborates. A flat or single-value timeline (the Cycle 6 symptom) is a fail — report it; do not lower
the bar.

## What is verified where
- **CI (no Wine, this repo):** the Node server end-to-end against the **fake bridge** still passes
  (the server contract + CLI args are unchanged). The bridge density itself is **not** CI-testable.
- **Real environment only (operator-run):** the Dockerfile build, the bridge **compiling** against
  `speech.h`, the **PulseAudio null sink** initializing MMAudioDest, and the dense, advancing timeline.
  Same verify boundary as Cycle 5 — the bridge is written from the oracle + real `speech.h` but is
  unverified until compiled + run with the vendor binaries and a working dummy audio device.

## Builds on Cycle 6 (merged)
Cycle 6 (PR #8, now merged to `main`) already carries mouth **width** through the server timeline +
provider and maps `VoiceMouthOverlay(height,width)` → overlay in `@vivify/core`. Cycle 7 supplies the
missing input that made all of it look static: the engine now **emits** dense, time-varying height+width.
With this branch the full path is authentic end-to-end — dense per-phoneme events → width-aware mapping →
the right overlay composited on the current frame, synced to the audio. Nothing else needs to merge.

## Non-goals
Core/types/provider/mash changes (Cycle 6 / PR #8); single-pass PCM-tee (the oracle shows it's
infeasible); performance tuning of the two-pass latency; non-EN-US voices; committing/running any MS/L&H
IP.
