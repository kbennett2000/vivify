# ADR-0014: `@vivify/voice-server` is a Node HTTP server fronting a C++ SAPI4 bridge under Wine
Status: Accepted · Date: 2026-06-20

## Context
ADR-0004 established that the authentic voice (L&H TruVoice on SAPI4) is a closed 32-bit Win32 component that cannot run in a browser, so it lives in a Dockerized Wine service exposing an HTTP endpoint. ADR-0005 established that the engine reaches any voice through a pluggable `TtsProvider`. Cycle 5 (`docs/cycles/cycle-5-voice.md`, branch `cycle-5-voice`) builds that service. The open question was its internal shape: a single all-in-one web server compiled against Win32 and run wholesale under Wine (as TETYYS/SAPI4 does), or a split where our own stack owns HTTP and only the irreducible COM interaction crosses into Wine.

The HTTP contract is fixed by this cycle: `POST /tts {text, voice}` → `{ audioWavBase64, mouthTimeline, format: "wav" }`, plus `GET /health`. The Cycle 6 `voice-truvoice` provider maps this onto the `TtsProvider` contract from `@vivify/types`.

## Decision
`@vivify/voice-server` is a Node HTTP server that spawns a separate C++ SAPI4 bridge process per request under `xvfb-run -a wine`.

The split:
- **Node (TS)** owns HTTP, request validation, `VoiceConfig`→bridge-args mapping, and response assembly. This is all in-stack and unit-testable in CI without Wine: the bridge command is injectable via `VIVIFY_SAPI4_BRIDGE`, and a fake-bridge test double stands in for the real one.
- **C++ bridge** (`bridge/sapi4-mouth.cpp`) owns only the SAPI4 COM interaction — synthesize audio and capture mouth/viseme timing — and runs per request under Wine.

## Consequences
- The entire HTTP layer is testable in CI with no Wine present (34 tests green against the fake bridge), and stays consistent with the monorepo's TS/Node stack.
- The Wine/COM surface is isolated to one small program, which is therefore swappable without touching the HTTP layer.
- Accepted trade-offs: a `wine` process spawn per request (perf cost — acceptable for a spike; revisit later with a long-lived bridge); two languages in one service; the bridge is the unverified piece, since there is no Wine in the dev sandbox — it must be compiled and run in Docker to prove GO/NO-GO.
- Alternatives rejected: (a) a TETYYS-style single D/C++ web server under Wine — couples HTTP to the Wine process, is less testable, and is off-stack; (b) a long-lived bridge with IPC — more complex, deferred until perf actually matters.
- Relates to ADR-0004 (authentic voice requires a backend) and ADR-0005 (pluggable `TtsProvider`).
