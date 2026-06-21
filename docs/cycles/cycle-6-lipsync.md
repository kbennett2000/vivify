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
   driven by **audio playback time**, composite a mouth-overlay image (from the frame currently on
   screen — `compositor.currentOverlays()` — selected via the authentic `voiceMouthOverlayType(height,
   width)` mapping; see "Lip-sync mapping" below and Follow-up fixes (d)/ADR-0018) and reveal balloon
   words by progress. No audio →
   today's silent heuristic animation. `stop()`/`stopCurrent()` interrupt in-flight synthesis + audio +
   animation immediately (the signal is threaded into the provider).
3. **Structured mouth modeling** (ADR-0010's Cycle 6 part): `MouthOverlay` becomes
   `{ overlays: FrameMouthOverlay[] }`; the parser populates typed fields (was `raw.overlays`).
4. **`services/voice-server`**: permissive CORS so a browser can call `:8080`.
5. **`apps/mash`**: a "Voice server URL" field; when set, speech uses `TruVoiceProvider` → authentic
   audio + lip-sync; Stop cuts it.

## Lip-sync mapping (load-bearing — see ADR)
- The mouth overlay is composited onto **the frame currently on screen** (`compositor.currentOverlays()`),
  not onto a Speaking-state animation. A Speaking animation is still looped when the character has one,
  but lip-sync no longer depends on it — see Follow-up fixes (d) and ADR-0018. At each tick we read the
  audio's current time, interpolate the mouth `{height, width}` from the timeline (`interpolatedMouth()`),
  map that to an `AgentMouthOverlay` type via the authentic `voiceMouthOverlayType(height, width)`
  decision tree (DoubleAgent's `VoiceMouthOverlay`), and select the on-screen frame's overlay whose
  `type` equals it (`overlayForType` / `chooseOverlay`). The compositor draws the base frame + that
  overlay. `activeMouthEvent()` (nearest active `{timeMs, shape}`) remains exported/tested.
- Balloon: the full utterance text is rendered **once and held** for the whole utterance (matching the
  classic Agent balloon). True per-word timing (SAPI4 `WordPosition`) isn't captured by the Cycle 5
  server yet — a later server enhancement. (See Follow-up fixes (a) — an earlier per-word reveal was
  removed.)
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
  - `lipsync` pure helpers: `activeMouthEvent(timeline, t)`, `chooseOverlay(height, width, overlays)`
    (maps via `voiceMouthOverlayType(height, width)` and selects the overlay whose `type` matches — see
    Follow-up fixes (d)/ADR-0018).
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

## Follow-up fixes (post on-screen test)
A real on-screen run surfaced two issues, fixed here. See ADR-0017 for the lip-sync root cause.

**(a) Balloon flicker — render once and hold.** The original ticker called `Balloon.revealFraction(t/duration)`
each tick; on the first tick that blanked the balloon to empty and refilled word-by-word, so the text
visibly showed → vanished → reappeared. Fix: the per-word reveal call was removed from the
`speakWithAudio` ticker (`packages/core/src/agent.ts`); the balloon now shows the full text once and
holds it for the whole utterance. `Balloon.revealFraction` is still exported/tested in
`packages/core/src/balloon.ts` but is no longer called by the engine.

**(b) Sparse mouth timeline — interim interpolation.** A real ~18s utterance returned only ~9 mouth
events (~one shape every ~2s), because the SAPI4 bridge renders to **file** audio (`CLSID_AudioDestFile`)
rather than real-time audio — so the mouth held a single pose for ~2s instead of moving. Verified root
cause (file vs real-time audio output mode), not a capture/parse bug — see ADR-0017. **Interim fix:** the
lip-sync ticker now drives off `interpolatedMouth()` (`packages/core/src/lipsync.ts`), which linearly
interpolates **both** mouth height and width between sparse anchors so the mouth **morphs smoothly**
instead of holding (the mapping tree needs both — see Follow-up fixes (d)). `interpolatedShape()` is
retained as a height-only delegate for callers/tests that only need height. Be explicit: this is **not**
per-phoneme-accurate lip-sync. The authentic fix — a real-time-audio bridge yielding dense per-phoneme
`Visual` events — is **deferred to Cycle 7**. `activeMouthEvent`/`chooseOverlay` are still used/tested.

**(c) Density log.** The voice server (`services/voice-server/src/server.ts`) now logs a per-utterance
line — `[tts] N mouth events, M bytes wav for K chars` — so event density can be verified empirically on
the next run.

**(d) No mouth on screen — wrong overlay source and wrong mapping (the main fix).** Lip-sync produced no
visible mouth on real characters. Two root causes, both fixed; verified against the DoubleAgent oracle.
See ADR-0018.
- **Source.** The old ticker composited onto a **Speaking-state animation**. Real characters like Genie
  have no Speaking state, so the code composited onto an empty animation → no mouth. The overlay is now
  sourced from the frame **currently on screen** (`packages/core/src/compositor.ts` `currentOverlays()`).
  A Speaking animation is still looped when present, but lip-sync no longer depends on it.
- **Mapping.** The old code sorted a frame's overlays by `type` and quantized the mouth height across
  that order. That was wrong: the `AgentMouthOverlay` `type` enum (0..6 = Closed/Wide1/Wide2/Wide3/Wide4/
  Medium/Narrow) is not an ordinal openness scale. The mapping is now DoubleAgent's `VoiceMouthOverlay`
  decision tree verbatim (`packages/core/src/lipsync.ts` `voiceMouthOverlayType(height, width)`), and
  `overlayForType` selects the frame overlay whose `type` equals the result.
- **Width threaded end-to-end.** The tree needs height **and** width. The bridge already emitted
  `mouth.width`; `services/voice-server/src/timeline.ts` now carries it, `@vivify/types` `MouthEvent`
  gained `width?`, and the TruVoice provider passes it through. Width is optional: absent → a mid default
  (`DEFAULT_MOUTH_WIDTH` = 100) so the tree degrades to its height-only branches.

### Verified vs assumed (follow-up)
- **Verified (CI):** the core changes (lipsync mapping tree, overlay selection, the no-Speaking-state
  sourcing regression, speak-lipsync), the width round-trip (server `timeline.ts` + the TruVoice
  provider). Suites green: `@vivify/core` 75, `voice-server` 39, `@vivify/voice-truvoice` 5.
- **Verified (oracle):** the `VoiceMouthOverlay` mapping tree, the `type` enum semantics, and the
  file-vs-real-time-audio root cause, against the DoubleAgent oracle (see ADR-0017, ADR-0018).
- **Operator-confirmed (on screen):** the moving mouth. The core changes need only a browser refresh;
  the server's width-carrying `dist` changed, so **one** Docker rebuild of the voice server is required.
  Honest caveat: authentic shape fidelity depends on TruVoice actually reporting mouth **width** — when
  width is absent the mapping falls back to height-only branches. A per-tick `[vivify:lipsync]`
  diagnostic logs height/width/type so this is checkable on screen.
