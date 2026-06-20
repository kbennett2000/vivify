# ADR-0007: Framework-agnostic core
Status: Accepted · Date: 2026-06-20

## Context
"Developers integrate this into anything." Tying the engine to React (or any framework) would cap adoption.

## Decision
`@vivify/core` is vanilla TypeScript with no framework dependency. It renders to a canvas/DOM it owns and exposes an imperative, queue-based API. Framework wrappers (e.g. a React hook) may be added later as separate thin packages.

## Consequences
- Usable from React/Vue/Svelte/vanilla equally.
- No framework reactivity assumptions baked into the engine.
