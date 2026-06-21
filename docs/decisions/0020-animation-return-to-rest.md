# ADR-0020: Animations hold their end pose; return to rest only on interrupt or stop
Status: Accepted · Date: 2026-06-21

> Supersedes the earlier draft of this same (unmerged) ADR, which returned to rest at the **end of each gesture action**. That over-corrected: it broke pose-stacking (you could never point and then speak while still pointing) and diverged from the oracle without need. The behavior below realigns with the DoubleAgent interrupt model.

## Context
Cycle 8 (`docs/cycles/cycle-8-return-to-rest.md`) tracked down two related symptoms: some MS Agent animations (e.g. Genie's `DoMagic2`) **end on a non-neutral frame**, the engine froze there, and the next animation **hard-cut** from that frozen pose. Confirmed in code — `packages/core/src/playback.ts` plays frames `0..last` and stops on the last frame. The return machinery already existed but was never invoked: `nextFrameIndex(...exiting...)` already follows each `frame.exitFrame`, and `AnimationModel.returnAnimation` was parsed but unused.

MS Agent animations carry a return path keyed by the `.acs` return-type (our `AnimationModel.transitionType`), validated against the DoubleAgent oracle (GPL — read for format knowledge only, never copied):
- **transitionType 1** = exit-branch walk: follow each frame's `exitFrame` to a terminal/rest frame.
- **transitionType 0** (or other, with a `returnAnimation` name) = play a named return animation.
- **transitionType 2** = none (authored to already end neutral).

Oracle behavior: DoubleAgent plays the return when **interrupting** a running/held animation (then starts the new one), and holds otherwise — it does **not** auto-return at every natural completion. The first draft of this ADR ignored that nuance and returned at the end of every gesture; the resulting always-return-to-rest made pose-stacking impossible. We realign with the oracle's interrupt model.

## Decision
Animations **hold their end pose** on natural completion; return-to-rest fires only on interrupt or explicit stop.

- **Hold on completion.** After playing an animation forward, the engine records the resting pose in `heldAnim` / `heldIndex` (`null` = at rest) and leaves the character on its last frame. This enables **pose-stacking**: play `GestureRight` to point, then `speak()` while still pointing.
- **Return-to-rest happens only here**, both via the pure helper `computeExitPath(frames, fromIndex)` + the named-return path (`returnToRest`):
  - **Before a *different* gesture, when not at rest.** `runGestureAnimation` first walks the previously-held animation back to rest, clears the held state, then plays the new gesture — so the new gesture starts from rest with no hard cut.
  - **On explicit `stop()`.** The MASH "Stop / return to rest" button halts playback, then walks the held pose back to rest.
  - `returnToRest`: **transitionType 1** → render `computeExitPath` frames via the clock loop (`playIndices`); **named return** → play `returnAnimation` forward once (no nesting); **transitionType 2** → nothing. The return path itself is unchanged from the prior draft.
- **`speak()` does not return to rest** — it preserves the held pose (its Speaking loop / mouth overlay composites onto whatever frame is held).
- **`show()` / `hide()` use forward-only playback** (no held tracking) — returning to rest after Hiding would flash the rest pose before the host is hidden.

Mid-play "true interrupt" (truncate the current animation + return from the current frame) remains deferred; current returns walk from the held end frame, which covers the reported symptoms.

## Consequences
- Characters hold their gesture; the next gesture walks the old pose back to rest before starting — no freeze, no hard cut — and `speak()` can layer on top of a held pose. Matches the oracle's interrupt model rather than diverging from it.
- **CI-verifiable** (unlike the voice/bridge work): `computeExitPath` is pure-tested, and engine behavior is tested with synthetic models + `FakeClock` + a fake `Document` recording the rendered frame sequence — hold-on-completion, return-on-next-gesture (transitionType 1/0/2), and return-on-`stop()`. **90 core tests green.**
- Core-only change (a browser refresh, no Docker rebuild); independent of the voice cycles.
- Relates to ADR-0011 (drop trailing zero-image frames): forward play ends on the last *playable* frame, so `computeExitPath` walks `exitFrame` from there — the trimmed length and the exit-branch return are two halves of the same end-of-animation behavior.

## Related cycle-8 decisions (speak/balloon)
These shipped in the same revision and belong with the hold-on-completion behavior above:

- **Overlay base frame for lip-sync.** `speak()` composites the mouth overlay onto the frame on screen. The pose-preserving case (held frame already carries overlays) is untouched. But if the held frame has **no overlays** *and* there is no Speaking-state animation, `speak()` renders an overlay-bearing base frame so lip-sync always has somewhere to composite. `findOverlayFrame` prefers a frame from the Speaking / RestPose / IdlingLevel1 / Showing states, falling back to the first overlay-bearing frame.
- **Balloon shown only when audio starts.** The text is set early (`balloon.setText`), but `balloon.show()` is **deferred until audio actually starts** — until `audio.play` resolves, or the start of the silent-heuristic path. This avoids displaying an empty/early balloon during the ~2–3 s synthesis wait.
