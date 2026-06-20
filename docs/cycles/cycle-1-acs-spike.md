# Cycle 1 — ACS spike: one character's pixels (GO/NO-GO)

## Goal
Prove we can correctly decode a single character's **images** and **animation table** from a raw `.acs`. This is the project's primary technical risk. We resolve it before building anything on top.

## Hard rule on byte layouts
**Do not trust any `.acs` byte offsets from memory — including any in this doc.** Derive the exact structure from the oracle (DoubleAgent's reader source) plus a hexdump of a real `Genie.acs`, and confirm every field against the validation oracle (Lebeau's extracted output). The descriptions below are conceptual scaffolding to orient the work, not authoritative offsets.

## What we know conceptually
- `.acs` is a single binary file (little-endian). A header carries a GUID and **offset+size pointers** to the major sections: character info, an **image list**, an **animation list**, and an **audio/sound list**.
- **Character info**: default width/height, the **palette** (≤256 RGB entries), and the **transparency color index** (color-key). Also balloon and voice config (deferred to Cycle 2 — out of scope here).
- **Images**: each is a bitmap compressed with a **custom RLE** over palette indices. Decode RLE → indexed pixels → map through palette → set the transparent index to alpha 0 → RGBA.
- **Animations**: a list, each with a name and a sequence of **frames**. Each frame references **one or more images** (composited, each with an x/y **offset**), a **duration** (stored in 1/100 s), optional **branches** (probabilistic next-frame), and an optional sound index. (Branching/sounds can be parsed-but-ignored for the spike; we only need them enumerated correctly enough to render straight-through playback of a named animation.)

## Approach
1. A small little-endian `BinaryReader`.
2. Parse the header → locate the image list and animation list.
3. Implement the RLE image decoder. Output each decoded image as a standalone PNG to `scripts/out/genie/img/NNN.png`.
4. Parse the animation table → produce `scripts/out/genie/animations.json`: `[{ name, frames: [{ images:[{imageIndex,x,y}], durationMs }] }]`.
5. A `scripts/spike-dump.ts <file.acs>` that runs 2–4 and also renders composited frames for a chosen animation to `scripts/out/genie/anim/<name>/NN.png`.
6. As you go, write findings (the *actual* byte layout you derived) into `docs/cycles/cycle-1-findings.md` to seed Cycle 2.

## Validation oracle
- Run **Lebeau's MSAgent Decompiler** (under Wine) on the same `Genie.acs` to extract its bitmaps and ACD project.
- Diff our decoded images against the decompiler's extracted bitmaps (pixel-compare; exact indexed pixels should match — allow only for documented color-key edge fringing).
- Cross-check our enumerated **animation names** against the decompiler's project and/or the character running in **DoubleAgent**.

## Fixtures
- Primary: `Genie.acs` (from TMAFE). Secondary sanity check: `Merlin.acs`.
- Stored locally under gitignored `packages/acs/fixtures/raw/`. Commit only golden/expected outputs (e.g. hashes of decoded images, the expected animation-name list), never the source `.acs`.

## Acceptance check (GO/NO-GO)
> Oracle settled during the cycle: graded against **Microsoft's own published animation lists**
> (Microsoft Learn), not a decompiler/reimplementation. Byte-exact image grading moved to Cycle 2
> (see ADR-0009). Result: **GO** — see `docs/cycles/cycle-1-findings.md`.
- [x] We enumerate **all** of Genie's animation names and they match the oracle **exactly** (76/76,
  vs Microsoft's published Genie list).
- [x] **Pixel decode confirmed structurally + visually**: palette (256) + transparency index (10) +
  128×128 dimensions decode correctly; per-image opaque-pixel counts are sane; a multi-frame
  animation (Genie **Greet**) composites coherently (PNGs reviewed locally; gitignored, not committed).
- [→] **Byte-exact unique-image count + per-pixel** matching: **deferred to Cycle 2** (gates
  `acs2bundle`). See ADR-0009.
- [x] Merlin passes the same name-match (73/73, vs Microsoft's published Merlin list), proving it
  isn't Genie-specific luck.

## If we can't hit it
Stop and reassess before building further (do not lower the bar). The name match is the load-bearing
GO/NO-GO signal: if our decoded names ever diverge from Microsoft's published list, stop and report
the diff. (For this cycle they match exactly.)

## Explicit non-goals
No sprite-sheet packing, no sound playback, no balloon, no voice, no browser runtime, no full-format coverage, no `acs2bundle`. Only: can we read the pixels and the animation structure correctly, proven against ground truth.
