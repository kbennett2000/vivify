# @vivify/voice-server — authentic TruVoice voice service (Cycle 5 spike)

Dockerized **Wine + SAPI4 + L&H TruVoice** behind a thin Node HTTP API. `POST /tts`
with `{ text, voice }` returns `{ audioWavBase64, mouthTimeline, format }` — the
authentic character voice **and** a mouth/viseme timeline for lip-sync (Cycle 6).
Full design: `../../docs/cycles/cycle-5-voice.md`.

> **Spike status.** The Node HTTP layer is implemented + unit-tested in CI (against
> a fake bridge). The Wine image + the C++ SAPI4 bridge are written but **NOT built
> or run** in vivify's sandbox (no Wine there). The GO/NO-GO is proven only by
> running the curl test below in a real Docker/Wine environment.

## 1. Supply the proprietary runtime (never committed — gitignored `vendor/`)
Drop into `services/voice-server/vendor/` (see `../../docs/legal-and-assets.md`):
- `spchapi.exe` — Microsoft Speech API 4.0 runtime.
- `tv_enua.exe` — L&H TruVoice American English (Genie's voice).

Also supply the **SAPI4 SDK headers/libs** (to compile the bridge) where the
Dockerfile's `$SAPI4_SDK` expects them. (Sources are listed in legal-and-assets.md;
TETYYS/SAPI4 documents a working Wine install of exactly these.)

## 2. Build dist, then the image
```
pnpm --filter @vivify/voice-server typecheck   # emits dist/ (server is pure Node built-ins at runtime)
docker build -t vivify-voice services/voice-server
```

## 3. Run
```
docker run --rm -p 8080:8080 vivify-voice
curl localhost:8080/health        # -> {"ok":true}
```

## 4. GO/NO-GO test
```
curl -sX POST localhost:8080/tts -H 'content-type: application/json' \
  -d '{"text":"Your wish is my command.","voice":{"speed":157,"pitch":100}}' | \
  python3 -c 'import sys,json,base64; r=json.load(sys.stdin); \
    open("out.wav","wb").write(base64.b64decode(r["audioWavBase64"])); \
    print("wav bytes:", len(base64.b64decode(r["audioWavBase64"])), "events:", len(r["mouthTimeline"]))'
# then play out.wav (authentic TruVoice?) and check mouthTimeline timestamps span the audio.
```
**GO** iff: authentic TruVoice WAV **and** a non-empty `mouthTimeline` aligned to the
audio. WAV-only or empty/garbage timeline = **NO-GO** (report it).

## Latency: warm engine + per-request timing (Cycles 10–11)

**Warm engine (Cycle 10).** The container keeps Xvfb (`:99`) and `wineserver` **persistent**
for its lifetime and runs a best-effort **warmup synth** at startup (`entrypoint.sh`), instead
of cold-starting Wine on every request. The per-request bridge command is therefore a plain
`wine …/sapi4-mouth.exe` (no `xvfb-run -a`), still overridable via `VIVIFY_SAPI4_BRIDGE`.
Practical effect: the **first** Speak after `docker run` is the warmup-affected one;
subsequent Speaks are warm.

**Single pass (Cycle 11).** The bridge used to synthesize each phrase **twice** — Pass A
(`CLSID_MMAudioDest`, real-time playback) for the dense per-phoneme mouth events, then Pass B
(`CLSID_AudioDestFile`) purely to write the WAV. Pass B is gone. The bridge now runs **one**
real-time pass: it plays the utterance to the PulseAudio null sink and emits the mouth
timeline. The server captures the audio by recording that sink's `.monitor` with `parec`
**concurrently** with the pass, so one synthesis produces both the events and the audio.

- `VIVIFY_CAPTURE` (injectable; default
  `parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1`) — the command the
  server starts before spawning the bridge and stops (SIGTERM) after it exits.
- `VIVIFY_CAPTURE_GRACE_MS` (default `200`) — how long after the bridge exits the server keeps
  capturing, so the audio tail isn't clipped.
- The null sink's format is **pinned** (`s16le` / 44100 / mono in `pulse-null.pa`) so the
  monitor stream is deterministic and `parec` records it 1:1 — no resample guesswork. The
  server collects the raw PCM from capture stdout, wraps it into a WAV header, and **trims
  leading silence** so the WAV's first audible sample aligns with timeline `t≈0`.

**Honest failure.** If the capture produces no audio (or only silence below the minimum),
`/tts` returns **500** (`null-sink capture produced no audio`). The server never returns a
faked silent WAV.

**Per-request timing.** Every `POST /tts` logs a `[tts-timing]` line combining the server
stages with the bridge's own per-stage `[timing]` line. Stages:
- `wineLoad` — the Wine process-load prologue: child spawn → the bridge's `[boot]` (its first
  statement in `main()`). This is the residual structural cost; a persistent-engine bridge
  daemon would remove it (future work — not done here).
- `capture` — server-side null-sink capture wall time (`parec` start → stop, incl. the grace
  tail).
- `teardown` — the time after the bridge's timing print until the process exits, now closed by
  the bridge's fast `_Exit` (it skips COM/DLL unload + device drain; the OS reclaims them).
- `bridge[init=… passA=…(ttfb …) write=… self=…]` — the bridge's own sub-parts: engine COM
  init, the single real-time pass (with time-to-first-byte), timeline write, and the bridge's
  self-measured `main()` window. (There is **no** `passB`.)
- `capture` — `parec` wall time (the null-sink recording; runs concurrently with the bridge).
- `encode` — server-side: wrapping the captured PCM into a WAV (+ leading-silence trim) and
  base64-encoding it for the response.
- `total` — whole handler.

The bridge also still emits its `[mmaudio]` / event-count diagnostic lines next to `[timing]`.

**Reading the breakdown.** POST `/tts` a couple of times and compare the `[tts-timing]
total=` values; the first request after container start reflects the warmup. Real before/after
latency numbers are operator-collected (no Wine/PulseAudio in CI) in the cycle doc's table:
`../../docs/cycles/cycle-10-latency.md` (Cycle 10) and
`../../docs/cycles/cycle-11-latency-singlepass.md` (Cycle 11).

## Endpoints
- `GET /health` → `{ "ok": true }`
- `POST /tts` `{ text: string, voice?: VoiceConfig }` →
  `{ audioWavBase64: string, mouthTimeline: { timeMs, shape }[], format: "wav" }`
  (400 on missing/empty `text`; 500 if the bridge fails or times out — the message carries the bridge stderr).

Config (env): `PORT` (default 8080), `VIVIFY_SAPI4_BRIDGE` (the bridge command),
`VIVIFY_SAPI4_TIMEOUT_MS` (kill a hung bridge, default 120000).

## Local dev without Wine
The HTTP layer can be exercised against a fake bridge:
`VIVIFY_SAPI4_BRIDGE="node test/fake-bridge.mjs" node dist/main.js` — returns a canned
WAV + timeline so you can hit `/tts` without the engine. (This proves plumbing, NOT the voice.)
