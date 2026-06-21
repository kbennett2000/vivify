# Cycle 8 — animation return-to-rest

## Goal
Stop animations from freezing on a non-neutral frame, and stop the hard-cut when the next animation
starts. Microsoft Agent animations walk back to a rest pose on completion via their **return path** — an
**exit-branch** chain or a named **return animation**. The vivify engine parsed this data but never used
it: `Playback` plays frames 0..last and stops on the last frame, so e.g. `DoMagic2` ends mid-gesture and
holds; clicking another animation then hard-cuts from that frozen pose. This cycle wires the return path.

Scope: **`@vivify/core` only** — browser refresh to test, no container rebuild. Voice/bridge unaffected.

## The return model (oracle: DoubleAgent)
Each animation carries a `transitionType` (the `.acs` return-type byte), already parsed into
`AnimationModel`:
- **`1` — exit-branch:** from the current frame, follow each frame's `exitFrame` to a terminal (a frame
  with no `exitFrame`) — that terminal is the rest pose.
- **`0` (or other) — named return:** play the animation named by `AnimationModel.returnAnimation`.
- **`2` — none:** the animation is authored to end neutral; no return.

DoubleAgent plays the return when **interrupting** a running animation, then the new one. We adapt this to
our **serial action queue**: each gesture action returns to rest **at its end**, so the character always
finishes neutral — and because the queue is serial, the next queued action then starts from rest. That
yields smooth transitions with no separate interrupt machinery. (Deliberate, minor divergence from the
oracle's interrupt-only timing — recorded in ADR-0020 — chosen to match the user-observed behavior of
gestures ending at rest.)

## What changes
- **`packages/core/src/playback.ts`** — new pure `computeExitPath(frames, fromIndex)`: follows `exitFrame`
  from `fromIndex` to its terminal, returning the ordered frame indices to render (cycle/out-of-range
  guarded; `[]` when there's no exit path). Reuses the `exitFrame` semantics already in `nextFrameIndex`.
- **`packages/core/src/agent.ts`** — extract `playForward(anim, signal)` (plays to the natural end,
  resolves the last rendered frame index). `play()` and `gestureAt()` now, after the forward play, run
  `returnToRest(anim, lastIndex, signal)`:
  - `transitionType 1` → render `computeExitPath(...)` via a clock loop (`playIndices`);
  - named return → play the return animation forward once (no nesting);
  - `transitionType 2` → nothing.
  `runState()` (Showing/Hiding) and `speak()` are unchanged — returning-to-rest after *Hiding* would flash
  the rest pose before the host hides, and `speak()` manages its own Speaking loop.

Net: after a gesture, the character walks back to a neutral pose; the next animation starts from rest —
no freeze, no hard cut.

## What is verified where
- **CI (this repo):** `computeExitPath` (pure: chains, terminal, cycle guard, out-of-range); and the
  engine behavior via synthetic models + `FakeClock` + a fake `Document` — `transitionType 1` renders the
  exit chain and ends on the rest frame; `transitionType 0` plays the return animation; `transitionType 2`
  adds no frames; a second queued `play` renders only after the first's return (no hard cut); abort during
  the return stops it.
- **On-screen (operator):** load Genie, play `DoMagic2` → it returns to a neutral rest pose instead of
  freezing; the next animation starts smoothly from rest.

## Non-goals
Latency (#1 — separate bridge PR). Mid-play *true interrupt* (truncate the current animation and return
from the current frame for snappier response) — not needed for these symptoms; possible later. Return-to-
rest for `speak()`/`moveTo()` — revisit if they freeze too. No voice/bridge/Docker change.
