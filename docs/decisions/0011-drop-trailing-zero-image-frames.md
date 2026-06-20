# ADR-0011: Playback drops trailing zero-image frames
Status: Accepted · Date: 2026-06-20

## Context
The Cycle 2 verification found that ~70% of animations across Genie/Merlin/Peedy/Robby end with a terminal **zero-image frame** — the source frame genuinely has `imageCount === 0`. It is a return-structure artifact tied to the exit-branch return-to-rest, not a decode bug: the converter preserves it like every other frame (ADR-0009, Cycle 2). But the Cycle 3 browser engine (`@vivify/core`) plays frames straight through, and rendering a zero-image frame clears the canvas — so naively played, the character would flash empty at the end of nearly every animation.

## Decision
Playback **drops a trailing run of zero-image frames** from the playable sequence: `playableLength` = frames length minus the trailing run whose `images.length === 0`. The animation ends holding its last real pose, and the engine returns to rest/idle via the state map. This is **display-time only** — the bundle/IR data is unchanged. The drop is scoped to *trailing* frames: interior zero-image frames (rare) are kept, and the compositor holds the previous pose when it hits one (a zero-image frame does not clear). Branches and `exitFrames` that point into the dropped trailing run resolve to "end". Playback's end-detection uses the trimmed length.

## Consequences
- No end-of-animation blank flash; matches the real MS Agent feel — return to rest, not vanish.
- Purely cosmetic/runtime: re-deriving frames from the bundle still yields the full, faithful set, so superset fidelity is untouched.
- Branch/`exitFrames` resolution into a dropped run now means "end" rather than a target index — a small but explicit rule a future contributor would otherwise trip over.
- Relates to the Cycle 2 verification and ADR-0009 (defer byte-exact image grading). This was the explicitly-required renderer decision for Cycle 3.
