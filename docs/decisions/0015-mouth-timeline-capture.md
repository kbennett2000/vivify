# ADR-0015: Capture the mouth/viseme timeline from the SAPI4 TTS notify sink
Status: Accepted · Date: 2026-06-20

## Context
Cycle 5 (`cycle-5-voice`) brings up the authentic-voice path: a Dockerized Wine + SAPI4 + L&H TruVoice service. A WAV alone is **not** a sufficient GO for the spike — Cycle 6 lip-sync needs per-phoneme mouth timing aligned to that audio, and producing it is vivify's extension over the WAV-only TETYYS/SAPI4 baseline. Capturing the timeline is half the point of Cycle 5.

The IR (`@vivify/types`, ADR-0008) defines `MouthEvent { timeMs, shape }`, which the engine consumes via the `TtsProvider.speak() → { audio, mouthTimeline }` seam (ADR-0005). Something has to fill that timeline from the real engine.

SAPI4 exposes mouth data through the low-level TTS notify sink: registering an `ITTSNotifySinkW` yields an `AudioStart` callback (the zero point) and a stream of `Visual(qTimeStamp, phoneme, …, TTSMOUTH)` callbacks (mouth height/width/upturn + phoneme). That is the authoritative, audio-relative source for the timeline.

## Decision
Capture the mouth/viseme timeline in the C++ bridge (`services/voice-server/bridge/sapi4-mouth.cpp`) by registering an `ITTSNotifySinkW` and recording each `Visual` callback relative to `AudioStart`. The bridge emits a JSON timeline alongside the WAV:

```
{ events: [ { timeMs, shape, phoneme, mouth: { height, width, upturn } } ] }
```

Contract mapping: the Node `parseTimeline()` reduces this bridge JSON to the IR's `MouthEvent[]`. For Cycle 5, `shape` = the TTSMOUTH mouth-height; the full TTSMOUTH fields + phoneme are preserved verbatim in the bridge JSON for later use. Cycle 5's bar is only that a **non-empty, audio-aligned** timeline comes out of the engine.

**Deferred to Cycle 6:** the exact viseme→Agent-mouth-overlay mapping — joining this timeline to Cycle 2's per-frame overlay data (`frame.mouth.raw.overlays`, ADR-0010) to drive the character's mouth frames. The precise `shape` scale/semantics are expected to change in Cycle 6.

Rejected: deriving visemes from the WAV by post-hoc audio analysis. That throws away the engine's own ground-truth phoneme timing and violates the authenticity rule for the sake of avoiding the sink wiring.

## Consequences
- The timeline shape is **provider-defined** for now and may be refined; downstream code (engine, lip-sync) should treat `shape` as **opaque** until Cycle 6 fixes the mapping.
- Full fidelity is retained: phoneme + complete TTSMOUTH survive in the bridge JSON even though only `shape` reaches the IR today.
- The bridge's `Visual`-callback signature and TTSMOUTH field names are **unverified against the SAPI4 SDK** (marked `CONFIRM` in the source) until built and run under Wine. Treat them as provisional.
- Relates to ADR-0005 (`TtsProvider` seam this fills), ADR-0010 (the overlay data Cycle 6 will join against), and ADR-0014 (Cycle 5 voice-server bring-up).
