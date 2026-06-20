# ADR-0003: Superset IR and bundle format (not clippy-compatible)
Status: Accepted · Date: 2026-06-20

## Context
clippy.js has an established agent format, but it was built to "show a character and play a named animation." It drops data we need for fidelity.

## Decision
Define our own IR and on-disk bundle as a **superset** that captures everything an `.acs` holds: multi-image frame compositing with per-image offsets, probabilistic frame branching, per-frame embedded sounds, mouth-overlay/lip-sync data, balloon config, SAPI voice config, and the state→animation map. clippy.js interop, if implemented, is a one-way *import* only.

## Consequences
- 100% fidelity is achievable; nothing is thrown away at parse time.
- Slightly larger/more complex format than clippy's. Worth it — fidelity is the whole point.
- We are not bound by clippy's schema decisions.
