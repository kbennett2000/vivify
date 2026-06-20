# Architecture

## Data flow
```
.acs (ArrayBuffer)
      │
      ▼
@vivify/acs  ──►  CharacterModel (the superset IR)
      │                 │
      │ (Node)          │ (browser, in-memory)
      ▼                 ▼
acs2bundle         @vivify/core ──► canvas compositor ──► frame on screen
  └─ sheet.png                  ├─► balloon renderer
  └─ manifest.json              └─► TtsProvider ──► audio + mouthTimeline ──► lip-sync overlay
  └─ audio/
```
The parser produces the **same IR** whether it's running in Node (to emit a bundle) or in the browser (to play directly). A bundle is just the serialized IR + packed assets for ahead-of-time use and CDN serving.

## Packages
- **`@vivify/acs`** — binary reader, RLE image codec, palette + color-key→alpha, animation/frame/branch parsing, embedded WAV extraction, balloon/voice/mouth metadata. Exposes `parseAcs(buf): CharacterModel` and the `acs2bundle` CLI. Pure, no DOM.
- **`@vivify/core`** — consumes a `CharacterModel` or a bundle. Owns rendering (canvas), the action queue, playback (timing, branching, looping), the balloon, and the lip-sync compositor. Takes a pluggable `TtsProvider`. No framework deps.
- **`@vivify/voice-truvoice`** — a `TtsProvider` implementation that POSTs to the voice server.
- **`services/voice-server`** — Wine prefix with SAPI4 + TruVoice + a thin HTTP server. `POST /tts {text, voice}` → `{ audioWavBase64, mouthTimeline }`. User supplies the engine binaries; we ship the Wine wiring and the SAPI4 notify-sink that captures mouth/viseme events.
- **`apps/mash`** — the demo, built only on the public API.

## Why a superset (not clippy-compatible)
clippy.js's format was built for "show a character and play a named animation." It drops what we need for fidelity: multi-image frame compositing with per-image offsets, probabilistic frame branching, per-frame embedded sounds, mouth-overlay data for real lip-sync, balloon styling, and the SAPI voice config. Our IR models all of it. We can *import* clippy agents one-way for convenience, but we never let their format cap our fidelity. (ADR-0003.)

## The TTS seam
`@vivify/core` never knows how speech is produced. It calls `provider.speak(text, voice)` and gets back `{ audio, mouthTimeline }`. Two providers ship: `voice-truvoice` (authentic, needs the service) and a clearly-labeled `web-speech` fallback (not authentic, zero backend). This is what lets the library stay pure-browser while authenticity is an opt-in. (ADR-0004, ADR-0005.)
