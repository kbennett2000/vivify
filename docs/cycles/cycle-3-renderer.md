# Cycle 3 — browser engine (silent renderer)

## Goal
The framework-agnostic `@vivify/core` engine that renders a Microsoft Agent character in the browser
from a bundle (or a raw `.acs` via the `parseAcs` runtime path) and drives it through the classic
Agent control API. **Silent** — no audio/voice yet (Cycles 5/6); the `TtsProvider` seam is wired but
defaults to the no-op `StubTtsProvider`. Vanilla TS, no framework dependency (ADR-0007); the engine
renders into a host DOM element it owns. Write this doc first, then implement.

## Public API (Cycle 0 contract — `Agent`)
`show()`, `hide()`, `play(name)`, `animations()`, `speak(text, opts?)`, `moveTo(x,y,opts?)`,
`gestureAt(x,y)`, `stopCurrent()`, `stop()`, `on(event, handler)`, `dispose()`. Every action
**enqueues** and runs in order (classic Agent semantics). `createAgent(source, mount?)` where
`source: ArrayBuffer (raw .acs) | CharacterBundleRef ({ manifestUrl })`.

## Playback (faithful to MS Agent / clippy.js Animator)
Each animation is an ordered `FrameModel[]`. After a frame's `durationMs`, the next frame is chosen:
1. **exiting** and `frame.exitFrame !== undefined` → `exitFrame` (the exit-branch return-to-rest path);
2. else `frame.branches` non-empty → **weighted pick**: `rnd = rng()*100`; for each branch subtract
   `probability`, the first with `rnd <= probability` wins (→ its `frameIndex`); if none, fall through;
3. else → `currentIndex + 1`.
The animation ends when the current frame is the last. Stopping / transitioning sets `exiting = true`
so the exit chain plays out gracefully (return to rest) instead of cutting. Branching is probabilistic
(idle variety); exit branches are the built-in "Return Animation: using Exit branches". The clock and
RNG are injected so this is deterministically unit-tested.

## Trailing zero-image frames (ADR-0011)
~70% of animations end with a terminal zero-image frame (a return-structure artifact; see the Cycle 2
verification). Playback **drops a trailing run of zero-image frames** from the playable sequence so the
character doesn't flash empty at the end — it holds its last real pose and the engine returns to
rest/idle via the state map. Display-time only; the bundle/IR data is unchanged. Interior empty frames
(rare) are kept and the compositor holds the previous pose. Branches/exitFrames pointing into the
dropped trailing run resolve to "end".

## State → animation map
`CharacterModel.states` maps well-known states to animation-name lists: `Showing`, `Hiding`,
`Speaking`, `IdlingLevel1..3`, `MovingLeft/Right/Up/Down`, `GesturingLeft/Right/Up/Down`. The engine
selects an animation for a state (first / rng among the list): `show`→Showing, `hide`→Hiding,
`speak`→Speaking, idle→IdlingLevel*, `moveTo`→Moving<dir>, `gestureAt`→Gesturing<dir>.

## Compositor
A `<canvas>` sized to the character (`info.width × height`). Rendering a frame = clear, then for each
`FrameImage` draw its image at `(x, y)` honoring transparency (alpha 0 = transparent). Per-image
offscreen canvases (built from `ImageModel.rgba` via `ImageData`) are cached and `drawImage`d so
multi-image frames alpha-composite correctly.

## Balloon (text only)
A DOM element styled from `BalloonConfig` (font name/height, fg/bg/border colors, `numLines`,
`charsPerLine`). `speak(text)` word-wraps text to `charsPerLine` (up to `numLines`) and shows the
balloon; it plays the Speaking-state animation for a text-length-derived duration (no audio in this
cycle), then hides the balloon unless `opts.hold`.

## Module layout (pure logic vs DOM)
**Pure (unit-tested in CI with synthetic IR; no DOM):** `clock.ts` (injectable timer), `playback.ts`
(sequencer + next-frame resolver + trailing-empty trim), `queue.ts` (action queue + stop/stopCurrent),
`wrap.ts` (balloon word-wrap), `states.ts` (state→animation + move/gesture direction).
**DOM (validated via the local harness):** `loader.ts` (raw `parseAcs` / bundle fetch+crop →
`CharacterModel`), `compositor.ts` (canvas), `balloon.ts` (DOM), `agent.ts` (`VivifyAgent` wiring it
all + `createAgent`).

`@vivify/core` depends on `@vivify/acs` for `parseAcs` (raw path) and `cropCell` (bundle path) — see
ADR-0012; dependency direction core→acs→types is acyclic.

## Local harness (not committed)
`packages/core/dev/` (gitignored): an `index.html` + `main.ts` that load Genie + Merlin, list their
animations, play any on click, and show a typed balloon. Run with the workspace Vite:
`pnpm exec vite serve packages/core/dev`. For local visual confirmation only — the committed showcase
app is the Cycle 4 MASH demo.

## Acceptance
- Load Genie → click any animation → it plays correctly (composited, timed, branches resolve).
- Greet plays coherently end-to-end; the balloon shows typed text styled per the character.
- The queue works (stacked actions run in order); `stop`/`stopCurrent` behave.
- Merlin works too. CI green on the synthetic-fixture logic tests (timing/queue/branching/wrap/states).

## Non-goals
Audio / voice synthesis / lip-sync animation (Cycles 5/6); the committed MASH demo (Cycle 4);
clippy.js import; structured mouth-overlay modeling (Cycle 6).
