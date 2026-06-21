# ADR-0016: Integrate authentic voice + lip-sync into `@vivify/core`
Status: Accepted (shape→overlay mapping Superseded by ADR-0018) · Date: 2026-06-20

## Context
Cycle 6 (`cycle-6-lipsync`, `docs/cycles/cycle-6-lipsync.md`) joins the pieces the earlier cycles set up into a working talking character: the authentic-voice backend (ADR-0004), the pluggable `TtsProvider` seam (ADR-0005), the per-frame mouth overlays parsed verbatim into `raw.overlays` (ADR-0010), and the audio-aligned mouth timeline the SAPI4 sink now emits (ADR-0015). `@vivify/core` has to consume `speak() → { audio, mouthTimeline }` and produce on-screen lip-sync without acquiring a framework dependency (ADR-0007) and without making the new behavior impossible to test in CI.

ADR-0010 explicitly deferred a typed `MouthOverlay` to Cycle 6, to be designed against the actual lip-sync consumer. That consumer now exists, so the shape can be fixed.

## Decision

**Audio-time-driven lip-sync.** On `speak(text)`, the provider returns `{ audio: WAV, mouthTimeline: MouthEvent[] }`. `agent.ts`'s `speakWithAudio` plays the audio and runs a ticker driven by the **audio's playback `currentTime`** — the source of truth, *not* the engine clock — that, per tick, finds the active `MouthEvent { timeMs, shape }` (`activeMouthEvent` in `lipsync.ts`), chooses a mouth overlay from the **current Speaking frame's** `mouth.overlays`, composites it over the base frame, and reveals balloon words by audio progress. Anchoring to audio time keeps mouth and sound in lock-step regardless of engine-clock drift or scheduling jitter.

**Shape→overlay mapping (a tunable heuristic).** `shape` is the SAPI4 TTSMOUTH mouth-height (ADR-0015), roughly 0..160. `chooseOverlay` orders a frame's overlays by their `type` id (closed→open) and quantizes the clamped openness (`SHAPE_MAX = 160`) across them. This is a documented, calibratable heuristic validated by eye — **not** a fully decoded viseme map — and is expected to be refined as we learn the real overlay semantics.

**Structured `MouthOverlay`** (fulfilling ADR-0010's deferral): `MouthOverlay { overlays: FrameMouthOverlay[] }`, `FrameMouthOverlay { type, replaceFlag, imageIndex, x, y, rgnFlag, scaleX, scaleY }`. The parser now populates typed fields instead of `raw.overlays`; the bundle zod schema and the IR↔schema InSync guards are updated in the same step to stay in lock-step.

**Injectable `AudioSink`** (`packages/core/src/audio.ts`): an `AudioSink` / `AudioHandle` interface, default `WebAudioSink` (Web Audio, for precise `currentTime`), injected via `CreateAgentOptions.audio`. Core stays framework-agnostic, and CI drives a fake sink off the `FakeClock` so the deterministic lip-sync logic is testable without a browser.

**Provider abort.** `TtsProvider.speak(text, voice, signal?: AbortSignal)`. `stop()` / `stopCurrent()` abort the action; the signal is threaded into the provider (`TruVoiceProvider` passes it to `fetch`), so audio and animation stop immediately. This closes the carried-forward "stop must interrupt async synthesis" gap.

**Speaking loop restarts only for multi-frame animations.** A single static pose holds while the mouth overlay carries the motion; restarting a ≤1-playable-frame animation from `onEnd` recurses synchronously and overflows the stack. Found via testing.

**Word-sync by audio progress**, not true per-word timing — the Cycle 5 server does not yet capture SAPI4 `WordPosition`. Noted as a future server enhancement.

**Fallbacks.** `StubTtsProvider` stays the silent default (no backend → today's heuristic animation, fully working); `WebSpeechProvider` (browser `speechSynthesis`) is an audible no-backend option. CORS was added to the voice server so a browser can reach it.

New public API surface: `createAgentFromModel`; `AudioSink` / `AudioHandle` / `WebAudioSink`; `activeMouthEvent` / `chooseOverlay` / `SHAPE_MAX`.

Rejected: driving lip-sync off the engine clock (drifts from audio); a hard-coded viseme→overlay table (we don't yet have the decoded semantics to justify one); core owning a concrete audio implementation (would couple it to the browser and break CI testability).

## Consequences
- Clean, framework-agnostic, testable design: the deterministic lip-sync logic (`activeMouthEvent`, `chooseOverlay`, word reveal) is unit-tested against a fake sink + `FakeClock`.
- Lip-sync **visual fidelity** depends on the character's `.acs` overlay data *and* the mapping heuristic; it is calibrated/iterated and validated by the operator on-screen — **not provable in CI**.
- Audio and on-screen sync **cannot be CI-verified** (needs a real browser + audio); only the deterministic logic is. The audio-driven ticker is the best structural defense against drift, not a proof of it.
- `MouthOverlay` is now typed end-to-end (parser → IR → bundle schema → guards), retiring the `raw.overlays` placeholder from ADR-0010 with no loss of fidelity (ADR-0003).
- Word-sync is approximate until the voice server captures `WordPosition`.
- Relates to ADR-0003 (superset IR), ADR-0004 (authentic voice backend), ADR-0005 (pluggable `TtsProvider`), ADR-0007 (framework-agnostic core), ADR-0010 (mouth overlays in raw → now structured), and ADR-0015 (mouth timeline capture).
