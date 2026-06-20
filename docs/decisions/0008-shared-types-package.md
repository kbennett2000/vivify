# ADR-0008: Neutral `@vivify/types` package for shared contracts
Status: Accepted · Date: 2026-06-20

## Context
Cycle 0 initially placed the superset IR (`CharacterModel` and its sub-types) in `@vivify/core` and had `@vivify/acs` depend on `@vivify/core` to import them. That dependency is backwards: `@vivify/acs` *produces* the IR (it parses `.acs` → `CharacterModel`), while `@vivify/core` *consumes* it (renders it). Coupling the standalone parser / `acs2bundle` CLI to the rendering engine is wrong — a Node-only "convert `.acs` to a bundle" use would drag in the browser rendering engine, and a bundle-only consumer would drag in the parser. The IR is a shared contract owned by neither side. ADR-0001 implied shared IR types live in core; that needs adjusting.

## Decision
Introduce `@vivify/types` (`packages/types`): a neutral, zero-runtime-dependency, TypeScript-only package that is the canonical home of the shared contracts:
- The superset IR (ADR-0003): `CharacterModel` + sub-types `Rgb`, `CharacterInfo`, `ImageModel`, `AnimationModel`, `FrameModel`, `FrameImage`, `FrameBranch`, `MouthOverlay`, `SoundModel`, `BalloonConfig`, `VoiceConfig`.
- The TTS contract (ADR-0005): `TtsProvider`, `TtsResult`, `MouthEvent`.

Both producer and consumer depend on it: `@vivify/acs → @vivify/types` and `@vivify/core → @vivify/types`. `@vivify/acs`'s dependency on `@vivify/core` is removed. `@vivify/core` keeps its own public engine API types (`Agent`, `AgentEvent`, `SpeakOptions`, `MoveOptions`, `CharacterBundleRef`), `createAgent`, and the runtime `StubTtsProvider` impl (a runtime class cannot live in a types-only package). `@vivify/core` re-exports the `@vivify/types` contracts for consumer convenience, but the canonical home is `@vivify/types`. All cross-package type imports are `import type`, so `@vivify/types` adds zero runtime weight.

## Consequences
- Parser and engine are decoupled: the standalone parser/CLI no longer pulls in the rendering engine, and the dependency direction now matches the data flow (both point at a neutral leaf).
- `@vivify/acs` and `@vivify/core` can build in parallel — both depend only on the `types` leaf — instead of acs waiting on core.
- Refines/supersedes the part of ADR-0001 that implied shared IR types live in core. Relates to ADR-0003 (the superset IR itself) and ADR-0005 (the pluggable TTS contract), which now live in `@vivify/types`.
- The manifest↔IR compile-time type-sync guard in `@vivify/acs` (`packages/acs/src/bundle.ts`) now validates the zod schema against `@vivify/types` and still works across the new package boundary (verified: dropping an optional IR field fails typecheck with TS2344).
