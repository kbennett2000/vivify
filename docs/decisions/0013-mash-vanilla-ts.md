# ADR-0013: MASH demo is vanilla TS + Vite (no UI framework)
Status: Accepted · Date: 2026-06-20

## Context
Cycle 4 is the committed showcase/dogfood app (`apps/mash`) built on `@vivify/core`'s public API. The cycle let us pick any UI framework but required justifying the choice against ADR-0007 (the engine is framework-agnostic — vanilla TS, renders into a host element it owns, no framework dependency).

## Decision
Build `apps/mash` in vanilla TypeScript + Vite, with no UI framework (React/Vue/Svelte). The app is plain DOM glue around `createAgent` + the `Agent` control, served and bundled by Vite.

Reasoning:
- The strongest demonstration that `@vivify/core` needs no framework is a showcase that uses none — "drop the engine into any page." A framework demo would still work (the engine is agnostic regardless) but would muddy the integration example with framework-specific glue.
- Keeps `apps/mash` dependency-light and matches the existing scaffold (Vite + vanilla TS).
- The engine stays framework-agnostic either way (ADR-0007); this is purely the demo app's own choice and implies nothing about the engine.

## Consequences
- `apps/mash` depends only on `@vivify/core` (+ Vite as a dev/build tool); the app code imports nothing but the public API.
- Future framework-specific examples (a React `<Clippy/>` wrapper, etc.) remain possible as separate adapters without changing the engine — they'd sit alongside, not replace, this vanilla showcase.
- Relates to ADR-0007 (framework-agnostic core) and ADR-0001 (monorepo `apps/*`).
