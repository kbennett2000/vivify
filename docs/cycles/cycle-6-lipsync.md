# Cycle 6 — voice + lip-sync integration

## Goal
Wire the proven Cycle 5 voice service into `@vivify/core` so characters **speak in the browser** with
the authentic TruVoice voice, **mouth movement synced to the audio**, and a balloon that **advances
with the words** — while the silent path keeps working with no backend.

## What ships
1. **`@vivify/voice-truvoice` — the real `TtsProvider`.** `TruVoiceProvider({ url })` POSTs to the
   Cycle 5 service (`POST /tts {text, voice}` → `{audioWavBase64, mouthTimeline, format}`), decodes the
   WAV to an `ArrayBuffer`, and returns `{ audio, mouthTimeline }`. Honors an `AbortSignal`. A small
   `WebSpeechProvider` (browser `speechSynthesis`, audible, empty timeline) is the no-backend audible option.
2. **`@vivify/core` — audio + lip-sync.** On `speak(text)`: get `{audio, mouthTimeline}` from the
   provider; if audio is present, **play it** (via an injectable `AudioSink`, default Web Audio) and,
   driven by **audio playback time**, composite a mouth-overlay image (from the active Speaking frame's
   `mouth.overlays`, chosen by the current viseme) and reveal balloon words by progress. No audio →
   today's silent heuristic animation. `stop()`/`stopCurrent()` interrupt in-flight synthesis + audio +
   animation immediately (the signal is threaded into the provider).
3. **Structured mouth modeling** (ADR-0010's Cycle 6 part): `MouthOverlay` becomes
   `{ overlays: FrameMouthOverlay[] }`; the parser populates typed fields (was `raw.overlays`).
4. **`services/voice-server`**: permissive CORS so a browser can call `:8080`.
5. **`apps/mash`**: a "Voice server URL" field; when set, speech uses `TruVoiceProvider` → authentic
   audio + lip-sync; Stop cuts it.

## Lip-sync mapping (load-bearing — see ADR)
- The Speaking animation plays as usual. **In addition**, at each tick we read the audio's current time,
  find the active `MouthEvent` (`{timeMs, shape}`), and pick a mouth overlay from the **current Speaking
  frame's** `mouth.overlays` via a documented, tunable mapping (`shape` = SAPI4 mouth-height, ADR-0015,
  quantized across the frame's ordered overlays). The compositor draws the base frame + that overlay.
- Balloon **word reveal by audio progress** (`floor(progress · wordCount)` words shown). True per-word
  timing (SAPI4 `WordPosition`) isn't captured by the Cycle 5 server yet — a later server enhancement.
- Visual fidelity is the operator's validation step; the mapping is calibratable and may iterate.

## Contracts touched
- `TtsProvider.speak(text, voice, signal?: AbortSignal)` (added optional signal).
- `MouthOverlay { overlays: FrameMouthOverlay[] }`; `FrameMouthOverlay { type, replaceFlag, imageIndex,
  x, y, rgnFlag, scaleX, scaleY }`. The bundle zod schema + IR↔schema `InSync` guards updated in lock-step.
- `@vivify/core` `CreateAgentOptions.audio?: AudioSink` (new, injectable; default Web Audio in browser).

## Validation
- **CI (synthetic fixtures, no `.acs` / no engine / no browser):**
  - `TruVoiceProvider` against a real fake HTTP server (canned `{audioWavBase64, mouthTimeline}`) — decode
    + abort.
  - `lipsync` pure helpers: `activeMouthEvent(timeline, t)`, `chooseOverlay(shape, overlays)`.
  - `speak` integration + **stop-interrupts-synthesis**: synthetic Speaking IR + `FakeClock` + fake
    `AudioSink` + a controllable provider honoring the signal → audio played, overlays set over time,
    balloon advances; `stop()` → audio stopped, provider aborted, balloon hidden, no further overlays.
  - Silent fallback (empty audio) still runs the heuristic path.
- **On-screen (operator):**
  ```
  docker run --rm -p 8080:8080 vivify-voice        # the Cycle 5 service
  pnpm --filter mash dev                            # then open the printed URL
  # paste http://localhost:8080 into "Voice server URL"; upload Genie.acs; type a line; Speak.
  ```

## Acceptance
- Type a line → Genie speaks in the authentic voice, mouth moves in sync, balloon advances with words.
- `stop` cuts audio + animation immediately.
- Silent fallback still works with no server (blank URL).
- CI green on the synthetic-fixture logic tests.

## Non-goals
True per-word SAPI4 timing (server enhancement); non-EN voices; deploying mash/the service; fully
decoding the `.acs` overlay `type` semantics beyond what lip-sync needs (calibrate + iterate).
