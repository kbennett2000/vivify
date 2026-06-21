# Cycle 5 — voice spike: authentic TruVoice service (GO/NO-GO)

## Goal
Prove we can get the **authentic character voice** *and* a **mouth/viseme timeline** out of the real
engine — Microsoft SAPI4 + L&H TruVoice running under Wine. This is the project's second concentrated
risk; we resolve it before wiring voice into the browser. Scope is the **service** only — browser
integration, the `voice-truvoice` provider, and lip-sync animation are Cycle 6.

> The mouth timeline is **half the point**. A WAV alone isn't a GO: Cycle 6 lip-sync needs per-phoneme
> mouth timing aligned to the audio. We extend the SAPI4 notify sink to capture it.

## The contract
`POST /tts` with `{ text, voice }` (`voice` = the character's `VoiceConfig` from the IR) →
```json
{ "audioWavBase64": "<WAV bytes, base64>", "mouthTimeline": [ { "timeMs": 0, "shape": 4, ... } ], "format": "wav" }
```
`GET /health` → `{ "ok": true }`. The Cycle 6 `voice-truvoice` provider maps this onto the
`TtsProvider` contract (`{ audio: ArrayBuffer, mouthTimeline: MouthEvent[] }`).

## Architecture — Node HTTP server + C++ SAPI4 Wine bridge
SAPI4 + TruVoice are closed 32-bit Win32 components; they can't run in a browser, which is why the
voice lives in a Wine-based service (ADR-0004). Two pieces:

1. **Node HTTP server** (`src/`, our stack): receives `POST /tts`, validates, maps `VoiceConfig` →
   bridge CLI args, spawns the bridge (writing a WAV + a timeline JSON to temp files), reads + parses
   them, responds. Pure helpers (`voice-args.ts`, `timeline.ts`) are unit-tested; the bridge command
   is injectable via `VIVIFY_SAPI4_BRIDGE` so tests use a fake bridge.
2. **C++ SAPI4 bridge** (`bridge/sapi4-mouth.cpp`, our MIT code): a Windows console program run under
   `xvfb-run -a wine`. It uses the low-level SAPI4 TTS API to (a) select the TruVoice mode (by
   `engineModeId` GUID, else by enumerating modes), (b) set speed/pitch, (c) speak to a **WAV** audio
   sink, and (d) register an **`ITTSNotifySinkW`** whose **`Visual(timestamp, phoneme, …, TTSMOUTH)`**
   callback records a **mouth/viseme timeline**. Output: `out.wav` + `out.json`.
   Approach referenced from **TETYYS/SAPI4** (which is WAV-only); the mouth-capture is our extension.

The bridge runs per request (a `wine` spawn each call) — fine for a spike; perf is a later concern.

## Mouth/viseme timeline (the captured data)
Each `Visual` callback → one event: `timeMs` (audio-relative, from the SAPI timestamp), `shape`
(derived from `TTSMOUTH` mouth height / viseme), with the full `TTSMOUTH` (mouth height/width/upturn,
teeth, …) + phoneme preserved. `MouthEvent { timeMs, shape }` is the engine-facing shape; the exact
**viseme → Agent mouth-overlay** mapping (joining Cycle 2's `frame.mouth.raw.overlays`) is **Cycle 6**.
Cycle 5 only proves a non-empty timeline whose timestamps span the audio.

## What you supply (IP gate — nothing committed)
The repo ships **no** Microsoft/L&H binaries. Drop these into `services/voice-server/vendor/`
(gitignored; see `docs/legal-and-assets.md`):
- `spchapi.exe` — Microsoft Speech API 4.0 runtime.
- `tv_enua.exe` — L&H TruVoice American English (holds Genie's voice).

The Wine prefix, the compiled bridge (`bridge/*.exe`/`*.dll`), and any SAPI4 SDK headers needed to
compile are also user-supplied / gitignored — never committed.

## Build & run (real Docker + Wine)
```
# 1. put spchapi.exe + tv_enua.exe in services/voice-server/vendor/
# 2. build (installs the runtime + voice into a 32-bit Wine prefix; compiles the bridge)
docker build -t vivify-voice services/voice-server
# 3. run
docker run --rm -p 8080:8080 vivify-voice
```

## Acceptance (GO/NO-GO — proven in a real Docker/Wine environment)
```
curl -sX POST localhost:8080/tts -H 'content-type: application/json' \
  -d '{"text":"Your wish is my command.","voice":{"engineModeId":"...Genie...","speed":157,"pitch":100}}'
```
**GO** iff the response carries an **authentic TruVoice WAV** (decodes + plays as Genie's voice) **and**
a **non-empty `mouthTimeline`** whose timestamps span the audio duration. WAV-only, or an empty/garbage
timeline, is **NO-GO** — report it; do not lower the bar.

## What is verified where
- **CI (no Wine, this repo):** the Node server end-to-end against a **fake bridge** (a test double that
  emits a canned WAV + timeline — not an engine-success claim): request validation, `VoiceConfig`→args,
  timeline→`MouthEvent[]` parsing, response shape, `GET /health`, error paths.
- **Real environment only (the GO/NO-GO):** the Dockerfile build, the bridge **compiling**, and the
  authentic audio + real aligned viseme timeline. The bridge is written from the SAPI4 API but is
  **unverified** until compiled + run with the vendor binaries present.

## Non-goals
Browser integration / `voice-truvoice` provider / lip-sync animation (Cycle 6); performance; non-EN-US
voices; committing or running any Microsoft/L&H IP.
