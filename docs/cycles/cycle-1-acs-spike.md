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
- [ ] We enumerate **all** of Genie's animation names and they match the oracle.
- [ ] For **≥2 named animations** (pick one Showing/Greet-type and one Speaking-state animation), every frame renders **frame-for-frame matching** the decompiler-extracted bitmaps within a tight pixel tolerance.
- [ ] Our decoded **image count** matches the oracle's.
- [ ] Same passes for at least one animation of the secondary fixture (Merlin), proving it isn't Genie-specific luck.

## If we can't hit it
Stop and reassess before building further. Fallback path: rely on **offline conversion** via Lebeau's decompiler (under Wine) to produce intermediate assets, and build Cycles 2+ on that pipeline instead of a native runtime parser. Knowing this escape hatch exists keeps the spike a spike, not a rabbit hole.

## Explicit non-goals
No sprite-sheet packing, no sound playback, no balloon, no voice, no browser runtime, no full-format coverage, no `acs2bundle`. Only: can we read the pixels and the animation structure correctly, proven against ground truth.
