# ADR-0010: Preserve mouth overlays verbatim in `MouthOverlay.raw` for Cycle 2
Status: Accepted · Date: 2026-06-20

## Context
Each `.acs` FRAME carries per-frame **mouth overlays** — the lip-sync data: a count followed by N×14-byte entries `{ type, replaceFlag, imageNdx, unknown, rgnFlag, offX, offY, sX, sY }`. Cycle 2's job is the `acs2bundle` converter: parse the *whole* format losslessly and emit a web bundle. The full parser (`packages/acs/src/parse.ts`) must therefore account for these bytes one way or another.

The shared IR's `MouthOverlay` (ADR-0008's `@vivify/types`) is intentionally open — `{ raw?: Record<string, unknown> }` — with the Cycle 0 sketch noting "see Cycle 1/6". The bundle manifest's zod schema mirrors it, and a compile-time guard in `packages/acs/src/bundle.ts` keeps the manifest schema and the IR in lock-step.

Structured lip-sync — mapping overlays to viseme / mouth-height timelines and driving mouth compositing — is Cycle 6 (voice/lip-sync), and depends on the authentic voice timeline from Cycle 5/6. Designing a typed `MouthOverlay` now would be speculative: there is no voice-side consumer yet to design it against, and committing to a shape would churn the IR, the manifest schema, and its type-sync guard before Cycle 6 tells us what the consumer actually needs.

## Decision
Capture mouth overlays **verbatim** into `FrameModel.mouth.raw.overlays` — an array of `{ type, replaceFlag, imageIndex, x, y, rgnFlag, s: [sx, sy] }`, one per entry — and do not introduce a structured/typed mouth model in Cycle 2. No bytes are dropped, so the superset-fidelity rule (ADR-0003) holds. The typed `MouthOverlay` shape (named fields, viseme mapping) is deferred to Cycle 6, designed against the actual lip-sync consumer.

## Consequences
- Full fidelity is retained now: nothing about the mouth/lip-sync data is lost at parse or convert time.
- The IR shape and the bundle schema + type-sync guard stay stable through Cycle 2 — no speculative churn.
- Cycle 6 will formalize `MouthOverlay` and may migrate `raw.overlays` into typed fields once the voice/lip-sync path defines what it needs. This is a known, bounded follow-up, not open-ended drift.
- Relates to ADR-0003 (the superset IR) and ADR-0008 (the shared `@vivify/types` home of `MouthOverlay`).
