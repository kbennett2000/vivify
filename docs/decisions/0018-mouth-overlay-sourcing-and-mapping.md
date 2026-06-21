# ADR-0018: Source mouth overlays from the current frame; map via the authentic height+width decision tree
Status: Accepted · Date: 2026-06-21

## Context
Cycle 6's lip-sync (ADR-0016) produced **no mouth movement at all** for real characters — Genie among them. A character-wide diagnostic scan settled the question of whether the data was the problem: the mouth-overlay data is fully present and correctly parsed. Every animation carries all 7 `AgentMouthOverlay` types (0–6). The data was never missing; two real bugs in the consumer were.

Both were validated against the DoubleAgent oracle (GPL — read for format knowledge only, never copied):

1. **Wrong source.** `speakWithAudio` sourced overlays from a `"Speaking"`-**state** animation's frames. Genie has no Speaking state, so the ticker composited onto an empty 0-frame animation → no overlays, ever. MS Agent does not work this way: it composites the mouth onto **whatever frame is currently on screen**, and the Speaking-state animation is optional. The oracle (`AgentFile.cpp`) looks up the overlay matching the requested mouth type on the **current frame**.

2. **Wrong mapping.** `chooseOverlay` sorted overlays by raw `type` and quantized a height-only openness value across them. But `type` is the `AgentMouthOverlay` enum — `{ Closed=0, Wide1=1, Wide2=2, Wide3=3, Wide4=4, Medium=5, Narrow=6 }` (oracle `AgentFileParts.h:94–105`) — **not** an ordinal openness scale. Treating it as one is meaningless. The authentic selector is DoubleAgent's `VoiceMouthOverlay(height, width)` decision tree (oracle `Sapi4Voice.cpp:1136–1186`), which needs **both** the SAPI4 `TTSMOUTH` mouth height **and** width.

## Decision

1. **Source overlays from the on-screen frame.** `packages/core/src/compositor.ts` gains `currentOverlays()` (the `lastFrame`'s `mouth.overlays`). `speakWithAudio`'s lip-sync ticker in `packages/core/src/agent.ts` reads from it instead of from a captured Speaking-animation frame. A `"Speaking"`-state animation, when present, is still looped for **body motion**, but is no longer required for lip-sync. This matches MS Agent: mouth overlays composite onto the current pose, even a static rest frame.

2. **Map authentically (height + width).** `packages/core/src/lipsync.ts` implements `voiceMouthOverlayType(height, width)` verbatim from `VoiceMouthOverlay` (returns an `AgentMouthOverlay`, 0–6), and `overlayForType(type, overlays)` selects the frame overlay whose `type` equals it (exact match; nearest-by-type fallback). `chooseOverlay(height, width, overlays)` composes the two. The Cycle 6 interpolation (ADR-0017) now interpolates **both** height and width between sparse anchors via `interpolatedMouth`.

3. **Thread mouth width end-to-end** so the tree has real data to branch on. The bridge already emits `mouth.width`; `services/voice-server/src/timeline.ts` now carries it; `@vivify/types` `MouthEvent` gains `width?`; `@vivify/voice-truvoice`'s `normalizeTimeline` passes it through. `width` is **optional** — when absent (fallback providers), `voiceMouthOverlayType` assumes `DEFAULT_MOUTH_WIDTH` (100), degrading to the height-only branches (`Closed`/`Wide1`/`Medium`/`Wide4`) rather than misfiring to `Narrow`.

This **supersedes** ADR-0016's shape→overlay quantization mapping. The type-id-as-openness ordering and `SHAPE_MAX` quantization are retired; `type` is now treated as the enum it is, and the selection goes through the authentic decision tree.

## Consequences
- **Supersedes the ADR-0016 mapping.** The audio-time-driven ticker, the injectable `AudioSink`, the provider-abort contract, and the typed `MouthOverlay` shape from ADR-0016 all stand; only the shape→overlay quantization is replaced.
- ADR-0017's interpolation is **still in effect** — the sparse-timeline interim smoothing now covers both height and width.
- CI verifies the **logic/contract**, not the pixels: the mapping tree branch-by-branch, overlay selection (exact + fallback), the width round-trip through the server and provider, and the no-Speaking-state sourcing regression. The on-screen moving mouth is the operator's confirmation — a browser refresh for core, one Docker rebuild for the server's width-carrying `dist`.
- **Honest caveat:** full fidelity depends on TruVoice actually reporting `bMouthWidth`. If it returns 0 or a constant, the tree collapses toward `Narrow`/height-only behavior. A diagnostic log surfaces height/width/type per run so the operator can check this empirically rather than assume it.
- Relates to ADR-0015 (mouth-timeline capture), ADR-0016 (voice + lip-sync integration — **mapping superseded here**), and ADR-0017 (sparse-timeline interpolation interim — still in effect, now covering height + width).
