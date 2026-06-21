# ADR-0020: Return-to-rest at the end of each gesture action in `@vivify/core`
Status: Accepted · Date: 2026-06-21

## Context
Cycle 8 (`docs/cycles/cycle-8-return-to-rest.md`) tracked down two related symptoms: some MS Agent animations (e.g. Genie's `DoMagic2`) **end on a non-neutral frame**, the engine froze there, and the next animation **hard-cut** from that frozen pose. Confirmed in code — `packages/core/src/playback.ts` plays frames `0..last` and stops on the last frame. The return machinery already existed but was never invoked: `nextFrameIndex(...exiting...)` already follows each `frame.exitFrame`, `Playback.exit()` existed, and `AnimationModel.returnAnimation` was parsed but unused by the engine.

MS Agent animations carry a return path keyed by the `.acs` return-type (our `AnimationModel.transitionType`), validated against the DoubleAgent oracle (GPL — read for format knowledge only, never copied):
- **transitionType 1** = exit-branch walk: follow each frame's `exitFrame` to a terminal/rest frame.
- **transitionType 0** (or other, with a `returnAnimation` name) = play a named return animation.
- **transitionType 2** = none (authored to already end neutral).

Oracle nuance: DoubleAgent plays the return when **interrupting** a running animation (then starts the new one), and uses an Idle/RestPose mechanism otherwise — it does **not** auto-return at every natural completion.

## Decision
Implement return-to-rest in `@vivify/core`.

- New pure helper `computeExitPath(frames, fromIndex)` (`packages/core/src/playback.ts`) follows `exitFrame` to its terminal, returning the ordered indices to render (cycle / out-of-range guarded).
- In `packages/core/src/agent.ts`, `play()` and `gestureAt()` now — after playing the animation forward (`playForward` resolves the last rendered frame index) — call `returnToRest(anim, lastIndex)`:
  - **transitionType 1** → render the `computeExitPath` frames via a clock loop (`playIndices`).
  - **named return** → play the `returnAnimation` forward once (no nesting, to avoid return-cycles).
  - **transitionType 2** → nothing.

**The load-bearing call (adaptation):** we return to rest at the **end of each gesture action** rather than only on interrupt. Our action queue is **serial**, so an action ending at rest means the next queued action starts from rest — this yields smooth transitions and fixes **both** the frozen pose **and** the hard-cut with no separate interrupt/Idle machinery. This is a deliberate, minor divergence from the oracle's interrupt-only timing; it matches the user-observed MS Agent behavior of gestures ending at rest.

**Scope.** Return-to-rest applies to `play()` / `gestureAt()` only. `runState()` (Showing/Hiding) and `speak()` are unchanged — returning to rest after Hiding would flash the rest pose before the host is hidden, and `speak()` manages its own Speaking loop. Mid-play "true interrupt" (truncate the current animation + return from the current frame) is explicitly **deferred** (not needed for the reported symptoms). Return-to-rest for `speak()` / `moveTo()` is also deferred.

## Consequences
- Characters end gestures neutral; subsequent animations start from rest — no freeze, no hard cut.
- **CI-verifiable** (unlike the voice/bridge work): `computeExitPath` is pure-tested, and engine behavior is tested with synthetic models + `FakeClock` + a fake `Document` recording the rendered frame sequence (transitionType 1/0/2, serial-queue ordering, abort). 85 core tests green.
- Core-only change (a browser refresh, no Docker rebuild); independent of the voice cycles.
- Relates to ADR-0011 (drop trailing zero-image frames): forward play already ends on the last *playable* frame, so `computeExitPath` walks `exitFrame` from there — the trimmed length and the exit-branch return-to-rest are the two halves of the same end-of-animation behavior.
