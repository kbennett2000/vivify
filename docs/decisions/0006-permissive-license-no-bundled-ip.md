# ADR-0006: MIT license, zero bundled third-party IP
Status: Accepted · Date: 2026-06-20

## Context
The goal is broad developer adoption. GPL would deter integrators. The Microsoft/L&H binaries and the `.acs` character files are proprietary and not redistributable.

## Decision
License the repo MIT. Never commit `.acs` files, SAPI4/TruVoice binaries, the Wine prefix, or extracted Microsoft assets. Users supply them; `.gitignore` enforces it; `docs/legal-and-assets.md` documents sourcing.

## Consequences
- Repo is clean and freely adoptable.
- Tests can't ship source `.acs`; they ship expected-output (hashes/golden manifests) and fetch fixtures locally per the legal doc.
- CI must run without any proprietary asset present (parser unit tests use committed golden data, not raw `.acs`).
