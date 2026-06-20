# ADR-0004: Authentic voice requires a backend service
Status: Accepted · Date: 2026-06-20

## Context
The authentic character voices are L&H TruVoice on SAPI4 — closed Win32 binaries. They cannot run natively in a browser. "No substitute voices" is a hard requirement. TETYYS/SAPI4 proves TruVoice runs under Wine behind an HTTP endpoint for arbitrary text.

## Decision
The authentic voice lives in a Dockerized Wine + SAPI4 + TruVoice service that returns `{ audio, mouthTimeline }`. The browser engine reaches it through a `TtsProvider`. There is no pure-browser path to the authentic voice; this is accepted, not worked around.

## Consequences
- The core library stays pure-browser; authenticity is an opt-in companion service (great for self-hosting).
- Developers who want zero backend use the clearly-labeled Web Speech fallback provider (not authentic).
- The service must capture mouth/viseme timing from SAPI4, not just audio — required for lip-sync (couples with Cycle 6).
