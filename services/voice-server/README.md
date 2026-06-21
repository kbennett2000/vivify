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
