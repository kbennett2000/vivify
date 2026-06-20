# ADR-0005: Pluggable TTS provider interface
Status: Accepted · Date: 2026-06-20

## Context
We need authentic voice (backend) and a zero-dependency fallback, without the engine knowing the difference.

## Decision
`@vivify/core` depends only on a `TtsProvider` interface: `speak(text, voice): Promise<{ audio, mouthTimeline }>`. Ship `voice-truvoice` (authentic) and `web-speech` (fallback). Third parties can implement their own.

## Consequences
- Clean seam; the engine is testable with a stub provider.
- Lip-sync logic in core consumes `mouthTimeline` uniformly regardless of provider (fallback may return a coarse/empty timeline).
