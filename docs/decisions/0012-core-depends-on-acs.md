# ADR-0012: `@vivify/core` depends on `@vivify/acs` for the raw-`.acs` runtime path
Status: Accepted · Date: 2026-06-20

## Context
The Cycle 0 public contract is `createAgent(source: ArrayBuffer | CharacterBundleRef)`. The `ArrayBuffer` case is a raw `.acs` that must be parsed in the browser (CLAUDE.md: "drop a raw `.acs` and it runs"); the bundle case crops a packed sheet. The two functions that do this work — `parseAcs` and the atlas crop `cropCell` — already live in `@vivify/acs`. The question is whether the engine reuses them or whether callers are forced to parse before calling `createAgent`.

## Decision
`@vivify/core` takes a workspace dependency on `@vivify/acs` (which itself depends only on `@vivify/types`). Core's `loader.ts` uses `parseAcs` for the raw path and `cropCell` for the bundle path. The dependency direction is `core → acs → types`, acyclic. `@vivify/acs` is browser-safe: its Node-only CLI is not re-exported from its package entry, so importing it does not pull `fs`/`pngjs` into the engine.

## Consequences
- Honors the Cycle 0 `createAgent` contract without pushing parsing onto callers.
- The engine bundle includes the (pure, small) parser — an accepted cost for the "drop a raw `.acs` and it runs" guarantee.
- Acyclic graph preserved; coupling is limited to `parseAcs`/`cropCell` plus shared types — no reach into the parser's internals.
- Relates to ADR-0008 (shared `@vivify/types`) and ADR-0001 (monorepo). Recorded because it is a load-bearing cross-package edge (engine↔parser) a future contributor would otherwise have to reverse-engineer.
