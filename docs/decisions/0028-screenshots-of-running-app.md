# ADR-0028: Screenshots and GIFs of the running app are committable documentation

Status: Accepted · Date: 2026-06-21

## Context

[ADR-0006](0006-permissive-license-no-bundled-ip.md) forbids committing third-party IP: no `.acs`
files, no SAPI4/TruVoice binaries, no extracted Microsoft assets. The docs (README, install pages,
what-is-this, the developer pages, the characters page) signpost screenshots and GIFs of vivify
running — and a captured screenshot of the running demo contains **rendered character pixels** (e.g.
Genie), which originate from Microsoft IP. That sits in tension with ADR-0006, so the boundary needs to
be stated, not assumed.

## Decision

Permit committing **screenshots and GIFs of the running application** — the rendered character in the
MASH demo, its animation grid, balloon, and lip-sync — as documentation of what the software does.
These live under `assets/screenshots/` and `assets/gifs/`.

This is distinct from, and does not loosen, ADR-0006's hard rules:

- The **source `.acs` files and engine binaries are still never committed.** The capture script
  (`scripts/capture/`) reads the operator's `.acs` by path only, never writes or bundles it, and bakes
  in no download of any proprietary asset.
- A captured image must show only the **rendered character**, never expose or embed the `.acs` source.
- Images are produced by the operator from their own legally-sourced character file and committed by
  them; CI never has the assets and never generates them.

## Consequences

- The docs can show the real product. A screenshot/GIF of a running app is ordinary product
  documentation (comparable to any project documenting its UI), and is treated as such here.
- This is a deliberate, scoped carve-out — a documentation image of rendered pixels, not redistribution
  of the character file or engine. If a specific character's owner objects, the relevant image can be
  swapped for a different (operator-supplied) character without code changes.
- `.gitignore` continues to enforce `*.acs` and `*.wav`; PNG/GIF under `assets/` are intentionally not
  ignored so the operator can commit them.
- Because the assets are operator-generated, the docs' image references 404 until those files are
  committed — an accepted, temporary state, not a broken build.
