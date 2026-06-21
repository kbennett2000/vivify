# Cycle 4 — MASH demo app

## Goal
The committed, deployable **showcase + dogfood** of `@vivify/core`'s public API: a browser MASH
clone in `apps/mash`. It loads a Microsoft Agent character and lets you play its animations and show
a styled speech balloon — **silent** (voice is Cycles 5/6). The point is to prove the engine is
adoptable and framework-agnostic by building a real app on **nothing but the public API**.

## Built only on the public API
`apps/mash` imports **only** from `@vivify/core` — `createAgent` and the `Agent` control + types.
No `@vivify/acs`, no engine internals. This is the integration example: if the demo needs it, it's
public; if it reaches inside, that's a bug in the cycle. One `Agent` at a time (dispose before
loading another).

Public surface used:
- `createAgent(source, mount?)` where `source = ArrayBuffer (raw .acs) | { manifestUrl } (bundle)`.
- `agent.animations()`, `play(name)`, `speak(text)`, `show()`, `hide()`, `stop()`, `dispose()`.

## Framework: vanilla TS + Vite (ADR-0013)
No UI framework. A no-framework showcase is the strongest demonstration of ADR-0007 (the engine
needs no framework — drop it into any page). Keeps deps minimal and matches the scaffold.

## Features
- **Character picker (two paths):**
  - **Upload** (primary): file input + drag/drop → `File.arrayBuffer()` → `createAgent(buf, stage)`.
    Works out-of-the-box with the user's own `.acs`; parsing is internal to the engine.
  - **Built-in bundles** (local-only): on startup, `fetch('/characters/index.json')`; if present,
    list its entries and load via `createAgent({ manifestUrl: '/characters/<id>/manifest.json' })`.
    If absent, the picker shows "no bundled characters — drop a `.acs`".
- **Animation list:** `agent.animations()` → a clickable grid → `play(name)`.
- **Speak box:** type text → `agent.speak(text)` → the engine renders the per-character styled
  balloon (silent — the default `StubTtsProvider`).
- **Controls:** Stop, Hide/Show, Replay (last animation).
- **Graceful errors:** a bad/unreadable `.acs` upload shows a friendly message rather than crashing.

## IP gate (hard — no Microsoft assets in the repo)
The committed repo and the deployed build ship **no** `.acs` files and **no** character assets.
Built-in bundles are **local-only** under gitignored `apps/mash/public/characters/`:

```
# generate a local built-in (your own .acs; never committed):
pnpm --filter @vivify/acs acs2bundle <YourChar.acs> apps/mash/public/characters/<id>
# then add { "id": "<id>", "label": "<Name>" } to apps/mash/public/characters/index.json
```

Vite serves `public/` at the web root, so the app finds `/characters/<id>/manifest.json` when you've
placed it locally. Out-of-the-box (fresh clone / deploy) there are none — the app is fully usable via
**upload**, so it needs no bundled IP to function.

## Running it
```
pnpm --filter mash dev
```
Serves at the printed `http://localhost:5173/`. Build a deployable bundle with
`pnpm --filter mash build` (ships no IP).

## Validation
- The app builds (`vite build`) and serves (`vite`); the dev server starts and prints its URL.
- Pure UI helpers (`characters.ts`: built-in index parse, `.acs` file guard, manifest URL) are
  unit-tested in CI (no DOM/`.acs`). The canvas/`createAgent` integration is confirmed visually in
  the browser (the engine's own logic is covered by `@vivify/core`'s Cycle 3 tests).

## Acceptance
- App runs; load a character (upload or built-in) → animation list → click plays correctly;
  `.acs` upload works; speak shows the styled balloon.
- Built on the public API only; CI green; no IP committed.

## Non-goals
Audio / voice / lip-sync (Cycles 5/6); deploying to a host (the app is deployable, but deploying is
the operator's step); any reach into `@vivify/core` internals or `@vivify/acs`.
