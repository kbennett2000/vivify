# ADR-0009: Defer byte-exact image grading to Cycle 2
Status: Accepted · Date: 2026-06-20

## Context
Cycle 1 is a spike answering one question: did we correctly decode the `.acs` format (images + animation table)? Answering it needs a validation oracle, and the candidates were ruled out one by one: the genuine MS Agent control exposes no pixel/frame data (per Microsoft's object-model docs); Lebeau's MSAgent Decompiler refuses Microsoft's own characters; and no headless Windows/Wine toolchain in the dev environment proved feasible (and would still not grade these characters). The oracle that survived is **Microsoft's own published animation lists** — the Microsoft Learn "Animations for the Genie/Merlin Character" pages.

That oracle gives a strong, independent signal with no per-pixel ground truth: our decoder's animation-name set matches Microsoft's published list **exactly** (Genie 76/76, Merlin 73/73, case- and underscore-exact). An exact match across the full gesture-index → animation/frame parse is only achievable if the header, locators, string decoding, and animation table are all correct, so it validates the decode structurally. Pixel decode is separately confirmed structurally and visually: 256-color palette, transparency index 10, 128×128 frames, sane per-image opaque-pixel counts, and a coherent composited multi-frame "Greet".

What is *not* available here is a truly independent **per-pixel / byte-exact-count** oracle — not without committing Microsoft IP or standing up the Windows/Wine toolchain that proved infeasible.

## Decision
Defer byte-exact validation to **Cycle 2**, where the `acs2bundle` converter is built and "ship the converter" is the bar that genuinely requires byte-exactness. Cycle 2 will:
- Verify the exact decoded **unique-image count** per character.
- Verify **per-pixel** equality of decoded images against a ground truth.
- Settle the open per-pixel questions in `docs/cycles/cycle-1-findings.md`: row orientation (the bottom-up DIB assumption), any uncompressed (`compressed == 0`) images, and the per-image "part 2" region/mask trailing data.
- Choose the Cycle 2 ground-truth source then (e.g. a constitution-compliant extraction the PO runs locally), keeping ADR-0006 (no committed MS IP) intact.

## Consequences
- Cycle 1's GO/NO-GO is gated on the exact name match plus the structural/visual decode (met = GO), not on per-pixel parity.
- Risk accepted: a subtle pixel-level decode bug (wrong row order, an unhandled raw image) could pass Cycle 1 and surface in Cycle 2. Mitigated by the structural/visual checks now, and caught by Cycle 2's byte-exact gate before anything ships.
- Keeps the spike a spike (bounded), and puts the expensive byte-exact validation where it is load-bearing (the converter).
- Relates to ADR-0002 (parser-from-scratch, oracle-validated) and ADR-0006 (no committed third-party IP).
