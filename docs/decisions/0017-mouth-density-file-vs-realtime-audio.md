# ADR-0017: Sparse mouth timeline is a file-vs-real-time output-mode behavior; interim interpolation, authentic fix deferred
Status: Accepted · Date: 2026-06-20

## Context
During Cycle 6 (`cycle-6-lipsync`) on-screen testing, a real L&H TruVoice utterance of ~18 seconds returned only ~9 mouth-timeline events — roughly one mouth shape every ~2 seconds. With the audio-time-driven ticker and shape→overlay mapping from ADR-0016, that produces an effectively static mouth held for ~2s at a time, not lip-sync.

The root cause was **verified, not assumed**:
- Our SAPI4 bridge (`services/voice-server/bridge/sapi4-mouth.cpp`, ~lines 101–114) captures every `Visual` callback the engine fires with zero filtering or dedup, and `services/voice-server/src/timeline.ts` + `server.ts` pass them all through untouched. So SAPI4 itself emitted only ~9 events — the sparsity is upstream of our capture/parse pipeline.
- Validated against the DoubleAgent oracle (GPL — read for API knowledge only, never copied): DoubleAgent renders TTS to **real-time multimedia audio** via `CLSID_MMAudioDest` and receives dense per-phoneme `Visual` events. Our bridge renders to a **file** via `CLSID_AudioDestFile` (fast offline synthesis), and that output mode coarsens/batches the engine's mouth notifications. (DoubleAgent also advertises `ITTSNotifySink2` + `ITTSBufNotifySink` in `QueryInterface`; our sink advertises only `ITTSNotifySink`.)

Conclusion: the sparse timeline is an engine **output-mode** behavior (file vs real-time audio), not a bug in capture or parsing.

## Decision
1. **Interim, core-side fix only (Cycle 6).** Add linear interpolation of the mouth `shape` between the sparse timeline anchors — `interpolatedShape()` in `packages/core/src/lipsync.ts`, wired into the `speakWithAudio` lip-sync ticker in `packages/core/src/agent.ts`. This yields a **moving** mouth (smooth morph between anchors) instead of a pose held for ~2s. It is explicitly **not** per-phoneme-accurate lip-sync; given dense anchors it degrades to near-inert smoothing. Accepted **only as an interim** — the PO chose "interim now + diagnose."
2. **Diagnostic gate.** A per-utterance mouth-event-count log was added to the voice server (`services/voice-server/src/server.ts`) so the next on-screen run confirms event density empirically rather than by inference.
3. **Authentic fix deferred to Cycle 7.** Rewriting the bridge to `CLSID_MMAudioDest` (real-time audio) + capturing the rendered PCM to WAV + advertising `ITTSNotifySink2`/`ITTSBufNotifySink` is substantial, needs a dummy/null audio device under Wine, and **cannot be validated in the current dev sandbox** (no Wine, no audio device). It warrants a dedicated scoped cycle rather than being grafted onto this fix.

## Consequences
- This sits in tension with the project's **"100% authentic experience"** non-negotiable: interpolation is a knowingly-temporary shortcut, tracked by this ADR and Cycle 7 — not the end state.
- The mouth-event-count log is the diagnostic gate: if Cycle 7's real-time-audio bridge yields dense events, interpolation becomes harmless smoothing; if it does not, the shape→overlay mapping/quantization (ADR-0016) is revisited instead.
- Until Cycle 7 lands, lip-sync visual fidelity remains the calibrated heuristic of ADR-0016 plus this smoothing — validated by the operator on-screen, not provable in CI.
- Relates to ADR-0015 (mouth-timeline capture from the SAPI4 sink) and ADR-0016 (voice + lip-sync integration into `@vivify/core`).
