# Cycle 8 — animation return-to-rest

## Goal
Stop the hard-cut when one gesture is replaced by another, and give `stop()` a real "relax to rest." A
finished gesture intentionally HOLDS its end pose (so actions can stack — point, then speak while
pointing); the problem was the *transition* out of that pose. Microsoft Agent reaches a rest pose via a
**return path** — an **exit-branch** chain or a named **return animation** — when a pose is displaced. The
vivify engine parsed this data but never used it: `Playback` plays frames 0..last and stops, so e.g.
`DoMagic2` ends mid-gesture and holds (fine), but clicking another animation then hard-cuts from that
frozen pose, and `stop()` left it frozen. This cycle wires the return path into exactly those two moments.

Scope: **`@vivify/core` only** — browser refresh to test, no container rebuild. Voice/bridge unaffected.

## The return model (oracle: DoubleAgent)
Each animation carries a `transitionType` (the `.acs` return-type byte), already parsed into
`AnimationModel`:
- **`1` — exit-branch:** from the current frame, follow each frame's `exitFrame` to a terminal (a frame
  with no `exitFrame`) — that terminal is the rest pose.
- **`0` (or other) — named return:** play the animation named by `AnimationModel.returnAnimation`.
- **`2` — none:** the animation is authored to end neutral; no return.

DoubleAgent plays the return when **interrupting** a running animation — *not* at the natural end of every
gesture. An animation that finishes uninterrupted **holds its end pose**; the return only fires when
something else displaces that pose. We match that: a finished gesture HOLDS its end pose (no auto-return),
which is what enables **pose-stacking** — point with `GestureRight`, then `Speak` while still pointing.
Return-to-rest fires only:
- **(a)** before a *different* gesture starts while not already at rest — the held pose transitions
  *through* rest first, so there's no hard cut into the new gesture; or
- **(b)** on an explicit `stop()` (the MASH "Stop / return to rest" button).

It does **not** fire at the end of each animation. (An earlier draft of this cycle returned at the end of
every gesture; that was an over-correction — it broke pose-stacking and was reverted to this hold-based
model, which matches the oracle's interrupt timing. Recorded in ADR-0020.)

## What changes
- **`packages/core/src/playback.ts`** — new pure `computeExitPath(frames, fromIndex)`: follows `exitFrame`
  from `fromIndex` to its terminal, returning the ordered frame indices to render (cycle/out-of-range
  guarded; `[]` when there's no exit path). Reuses the `exitFrame` semantics already in `nextFrameIndex`.
- **`packages/core/src/agent.ts`** —
  - `playForward(anim, signal)` plays an animation to its natural end (or until aborted), resolving the
    last rendered frame index. Forward-only — no return.
  - `runGestureAnimation(name, signal)` (the body of `play()` and `gestureAt()`): if a previous gesture
    pose is still held, walk THAT back to rest first (case **a**); then `playForward` the new gesture and
    record `heldAnim`/`heldIndex` — it HOLDS, it does not auto-return.
  - `returnToRest(anim, lastIndex, signal)` is the unchanged return path: `transitionType 1` → render
    `computeExitPath(...)` via a clock loop (`playIndices`); named return → play the return animation
    forward once (no nesting); `transitionType 2` → nothing.
  - `stop()` halts the queue and, if a pose is held, enqueues a final `returnToRest` (case **b**).
  - `runState()` (Showing/Hiding) is unchanged. `speak()` PRESERVES the held pose — it does not return to
    rest (see the two sibling fixes below).

Net: a gesture holds its end pose; speaking keeps that pose with lip-sync; the next *different* gesture
transitions through rest (no hard cut); `stop()` relaxes to rest.

## Sibling fixes folded in this round
These shipped together because removing the old auto-return changed what's on screen during speech.

1. **Lip-sync source (`speakWithAudio`).** Lip-sync composites the mouth overlay onto the frame ON SCREEN.
   The pose-preserving case (the held frame already carries overlays) is untouched. But if the held frame
   has no overlays AND the character has no Speaking-state animation, `speak()` first renders an
   overlay-bearing base frame (`findOverlayFrame`: prefer a neutral/Speaking state frame with overlays,
   else the first overlay-bearing frame anywhere; lazily cached) so the mouth always has somewhere to
   composite. This fixes the regression where the old auto-return left a 0-overlay rest frame on screen,
   killing the mouth during speech.
2. **Balloon timing.** The balloon is SHOWN only when audio (or the silent heuristic animation) actually
   starts — not while the provider synthesizes (~2-3s). The text is loaded up front but kept hidden, so
   the balloon, the voice, and the moving mouth all begin together.

## What is verified where
- **CI (this repo): 90 core tests.** `computeExitPath` (pure: chains, terminal, cycle guard,
  out-of-range); engine behavior via synthetic models + `FakeClock` + a fake `Document` — a finished
  gesture HOLDS its end pose (no return frames appended); a *different* queued gesture transitions through
  rest first (`transitionType 1` exit chain ending on the rest frame / `transitionType 0` return animation
  / `transitionType 2` no return); `stop()` enqueues the return from the held pose; abort during a return
  stops it; `speak()` preserves the held pose and, when the held frame has no overlays and there's no
  Speaking state, renders the overlay base; balloon is shown on audio/animation start, not during synthesis.
- **On-screen (operator — browser refresh, no rebuild):** load Genie — `DoMagic2` holds its end pose
  instead of freezing-then-snapping; playing a *different* animation transitions through rest (no hard
  cut); `GestureRight` then `Speak` keeps the character pointing with the mouth lip-syncing; the balloon
  appears together with the audio; the "Stop / return to rest" button relaxes to the rest pose.

## Non-goals / known limitations
Latency (#1 — separate bridge PR). Mid-play *true interrupt* (truncate the current animation and return
from the current frame for snappier response) — not needed for these symptoms; possible later. Return-to-
rest for `moveTo()` — revisit if it freezes. No voice/bridge/Docker change.

Known limitation: `stop()` returns to rest from the **held** pose (after a gesture has completed — the
common "point, speak, then Stop" flow). If `stop()` is pressed *while a gesture is still animating*, the
character halts on that partial frame without walking back (that's the deferred mid-play true-interrupt).
The completed-gesture case — the one the Stop button is for — returns correctly.
