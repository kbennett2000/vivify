# @vivify/voice-server — authentic TruVoice voice service (Cycle 5 spike)

Dockerized **Wine + SAPI4 + L&H TruVoice** behind a thin Node HTTP API. `POST /tts`
with `{ text, voice }` returns `{ audioWavBase64, mouthTimeline, format }` — the
authentic character voice **and** a mouth/viseme timeline for lip-sync (Cycle 6).
Full design: `../../docs/cycles/cycle-5-voice.md`.

> **Spike status.** The Node HTTP layer is implemented + unit-tested in CI (against
> a fake bridge). The Wine image + the C++ SAPI4 bridge are written but **NOT built
> or run** in vivify's sandbox (no Wine there). The GO/NO-GO is proven only by
> running the curl test below in a real Docker/Wine environment.

## 1. Drop in the three proprietary files (never committed — gitignored `vendor/`)
Drop into `services/voice-server/vendor/` (sourcing is in `../../docs/legal-and-assets.md`):
- `spchapi.exe` — Microsoft Speech API 4.0 runtime.
- `tv_enua.exe` — L&H TruVoice American English (Genie's voice).
- `sdk/include/speech.h` — the SAPI4 SDK header the bridge compiles against, i.e.
  `services/voice-server/vendor/sdk/include/speech.h`.

`speech.h` stays user-supplied because it's Microsoft-copyrighted ("All rights reserved")
with no redistribution grant, so we never ship it (see ADR-0027 / ADR-0006). The build
**fails loudly** with the exact drop path if it's missing.

That's the only host setup. **Docker is the only host tool** — no Node, no pnpm, no manual
`dist` build. The image compiles the server's `dist/` itself in a `node:20-slim` build stage
(`pnpm install` + `tsc --build`).

## 2. Build the image
The build context is the **repo root** (the build reads the pnpm workspace). From the repo root,
either let compose do it:
```
docker compose up        # compose sets the context (.) and dockerfile
```
or build by hand:
```
docker build -f services/voice-server/Dockerfile -t vivify-voice .
```

## 3. Run
```
docker run --rm -p 8080:8080 vivify-voice
curl localhost:8080/health        # -> {"ok":true}
```
This needs an image built with the three `vendor/` files above (they're baked in at build time).

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
for its lifetime instead of cold-starting Wine on every request. The per-request bridge command
is therefore a plain `wine …/sapi4-mouth.exe` (no `xvfb-run -a`), still overridable via
`VIVIFY_SAPI4_BRIDGE`.

**Full-pipeline warmup (Cycle 11).** At startup the **server** (not the entrypoint) runs one real
synthesis over the whole capture+engine path — `parec` + the null-sink monitor + winepulse playback
+ trim + the engine — via `warmUp` in `src/server.ts`. This warms the **entire** `/tts` path, so the
**first** real Speak after `docker run` isn't cold. The container logs `[warmup] priming…` then
`[warmup] done in Nms`; warmup runs in the background after the port is listening, so `/health` is up
immediately and the first real Speak lands once warmup completes. The entrypoint no longer does its
own bridge-only warmup (Cycle 10's primed only the engine and left the capture path cold, which
clipped the first Speak's opening). Practical effect: subsequent Speaks are warm, and the first one
is too once `[warmup] done` is logged.

**Persistent capture source (Cycle 11).** The server owns **one** long-lived `parec` reading
`dummy.monitor` for the container's lifetime (`CaptureSource` in `src/capture.ts`), and **windows**
its stream per request (`beginWindow`/`endWindow`). There is **no per-request `parec` spawn** — that
per-request spawn + PulseAudio stream setup was the residual variable latency (`captureReady` swung
~600↔1700ms for the same phrase), so removing it removes the variance. The monitor stays continuously
hot, so the first Speak's capture path is never cold. `VIVIFY_CAPTURE` still configures this (now
persistent) reader command. `/tts` is **serialized** so only one capture window is open at a time. The
entrypoint's old shell-level keep-warm reader is **folded into the server** (superseded — removed).

**Single pass (Cycle 11).** The bridge used to synthesize each phrase **twice** — Pass A
(`CLSID_MMAudioDest`, real-time playback) for the dense per-phoneme mouth events, then Pass B
(`CLSID_AudioDestFile`) purely to write the WAV. Pass B is gone. The bridge now runs **one**
real-time pass: it plays the utterance to the PulseAudio null sink and emits the mouth
timeline. The server captures the audio by windowing the persistent monitor reader
**concurrently** with the pass, so one synthesis produces both the events and the audio. Because the
reader is always streaming, the audio is never clipped by a capture-start race (the original race this
replaced gated synthesis on a per-request `parec`'s first sample — no longer needed).

- `VIVIFY_CAPTURE` (injectable; default
  `parec --device=dummy.monitor --format=s16le --rate=44100 --channels=1 --latency-msec=30`) — the
  command for the **persistent** monitor reader the server windows per request.
  `--latency-msec=30` makes `parec` flush fragments fast, so a window's first chunk arrives in ~tens of ms.
- `VIVIFY_CAPTURE_READY_MS` (default `5000`) — how long after (re)starting the persistent reader to
  wait for its first sample before warning that the null sink isn't streaming.
- `VIVIFY_CAPTURE_GRACE_MS` (default `200`) — how long after the bridge exits the server keeps
  capturing, so the audio tail isn't clipped.
- `VIVIFY_TRIM_THRESHOLD` (default `150`) and `VIVIFY_TRIM_LEADIN_MS` (default `80`) — leading-silence
  trim alignment. Dial these if the opening word clips or the audio leads the mouth.
- The null sink's format is **pinned** (`s16le` / 44100 / mono in `pulse-null.pa`) so the
  monitor stream is deterministic and `parec` records it 1:1 — no resample guesswork. The
  server collects the raw PCM from capture stdout, wraps it into a WAV header, and **trims
  leading silence** so the WAV's first audible sample aligns with timeline `t≈0`.

**Disk-persistent cache (Cycle 12).** Every synthesized phrase is cached to disk, keyed by
`hash(text + voice)` (`src/cache.ts`). The cached bytes ARE the `/tts` response payload, so a
**repeat is served from disk in tens of ms with NO Wine, SAPI4, or capture** — a hit reads the
file and writes it to the socket verbatim, and opens no capture window (it doesn't even queue
behind an in-flight synthesis). The `[tts-timing]` line shows `cache=HIT total=Nms (diskRead=…)`
on a hit and appends `cache=miss` on a synthesized request. Because a hit bypasses the live
engine + capture path entirely, it **can't** carry the first-Speak cold-start clip that only
afflicts live capture. Caching is **enabled in the container by default** (the image sets
`VIVIFY_CACHE_DIR`) and **disabled when no cache dir is configured** (the code default — so
`pnpm`-local dev and CI are unchanged). See `../../docs/cycles/cycle-12-tts-cache.md` and
ADR-0024.

**Honest failure.** If the capture produces no audio (or only silence below the minimum),
`/tts` returns **500** (`null-sink capture produced no audio`). The server never returns a
faked silent WAV.

**Per-request timing.** Every `POST /tts` logs a `[tts-timing]` line combining the server
stages with the bridge's own per-stage `[timing]` line. Stages:
- `windowFirstByte` — the persistent capture source's per-window latency: `beginWindow` → the first
  buffered chunk from the always-on monitor reader. Consistently small (~tens of ms) and **stable**,
  since there's no per-request `parec` spawn. Replaces the old `captureReady`/`capture`/`captureStop`
  fields.
- `wineLoad` — the Wine process-load prologue: child spawn → the bridge's `[boot]` (its first
  statement in `main()`). This is the residual structural cost; a persistent-engine bridge
  daemon would remove it (future work — not done here).
- `build` — building the WAV from the captured PCM: wrap into a RIFF/WAVE header + trim leading
  silence. (Base64-encoding the response is counted separately as `encode`.)
- `teardown` — the time after the bridge's `[timing]` print until the process exits. Wine's
  process teardown (audio device/DLL unload) is kernel-/Wine-side and runs *after* `[timing]` (~2s
  of dead time). The server no longer waits for it: it **RESOLVES the request the moment it sees a
  complete `[timing]` line on stderr** — by then the timeline is written + closed and all audio has
  played to the null sink — and **reaps the bridge in the background** (best-effort kill, not
  awaited). It does **not** wait for the process's `'close'`, which lags ~2s under Wine even after a
  kill (killing the `wine` launcher doesn't promptly close the underlying process's stderr pipe).
  `teardown` is therefore now ~0. (A real failure *before* `[timing]` still fails the request via the
  `'close'` path.)
- `bridge[init=… passA=…(ttfb …) write=… self=…]` — the bridge's own sub-parts: engine COM
  init, the single real-time pass (with time-to-first-byte), timeline write, and the bridge's
  self-measured `main()` window. (There is **no** `passB`.)
- `encode` — server-side: wrapping the captured PCM into a WAV (+ leading-silence trim) and
  base64-encoding it for the response.
- `total` — whole handler.

The bridge also still emits its `[mmaudio]` / event-count diagnostic lines next to `[timing]`.

**Clip diagnostic (`[tts-audio]`).** Every `/tts` also logs
`[tts-audio] wavMs=… timelineMs=… rawCaptureMs=… trimmedMs=…`: the final WAV's audio duration
(`wavMs`) vs the mouth-timeline span (`timelineMs`). If `wavMs ≪ timelineMs`, the capture is
**missing opening audio** (the WAV is shorter than the utterance). `rawCaptureMs` is the captured
PCM duration before trim; `trimmedMs` is what leading-silence trim removed. Compare `wavMs` vs
`timelineMs` on the first vs later Speaks to confirm the opening isn't clipped.

**Reading the breakdown.** POST `/tts` a couple of times and compare the `[tts-timing]
total=` values. The startup `warmUp` runs the full path once, so the first request after
`[warmup] done` should already be warm (not cold). Real before/after latency numbers are
operator-collected (no Wine/PulseAudio in CI) in the cycle doc's table:
`../../docs/cycles/cycle-10-latency.md` (Cycle 10) and
`../../docs/cycles/cycle-11-latency-singlepass.md` (Cycle 11).

## Endpoints
- `GET /health` → `{ "ok": true }`
- `POST /tts` `{ text: string, voice?: VoiceConfig }` →
  `{ audioWavBase64: string, mouthTimeline: { timeMs, shape }[], format: "wav" }`
  (400 on missing/empty `text`; 500 if the bridge fails or times out — the message carries the bridge stderr).

Config (env): `PORT` (default 8080), `VIVIFY_SAPI4_BRIDGE` (the bridge command),
`VIVIFY_SAPI4_TIMEOUT_MS` (kill a hung bridge, default 120000).

Cache (env, Cycle 12): `VIVIFY_CACHE_DIR` — the cache directory; the image sets it to
`/var/cache/vivify-tts`, and leaving it **unset disables caching**. `VIVIFY_CACHE_MAX_ENTRIES`
and `VIVIFY_CACHE_MAX_BYTES` — both **default unbounded** ("cache everything"); set either to
evict the oldest entries by mtime on write.

**Cache persistence.** `docker compose` mounts a named volume
(`vivify-tts-cache:/var/cache/vivify-tts`), so the cache survives `docker compose down && up`;
`docker compose down -v` wipes it. For a bare `docker run`, add
`-v vivify-tts-cache:/var/cache/vivify-tts`. On boot the server logs
`[cache] N entries, M on disk`.

## Local dev without Wine
The HTTP layer can be exercised against a fake bridge. Build `dist/` once on the host
(`pnpm --filter @vivify/voice-server run build`), then:
`VIVIFY_SAPI4_BRIDGE="node test/fake-bridge.mjs" node dist/main.js` — returns a canned
WAV + timeline so you can hit `/tts` without the engine. (This proves plumbing, NOT the voice.)
This host build is only for local dev; the Docker image builds its own `dist/` in-image.
