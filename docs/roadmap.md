# Roadmap

Risk is concentrated in two spikes — ACS image/animation decode (Cycle 1) and the authentic voice service (Cycle 5). Both are front-loaded as go/no-go gates. Everything else is comparatively mechanical assembly. Cycles 1 and 5 are deliberately **not** merged into their neighbors: you want the go/no-go answer before building on top of it.

| # | Cycle | The point | Acceptance (go/no-go where noted) |
|---|-------|-----------|-----------------------------------|
| 0 | Repo + contracts | Nail the seams before building across them | Types compile (strict); stub agent loads & no-ops; bundle schema + validator exist |
| 1 | **ACS spike** — one character's pixels | Prove we can correctly decode images + animation table from raw `.acs` | **GO/NO-GO (met):** Genie + Merlin animation names match **Microsoft's published lists exactly** (76/76, 73/73); pixel decode confirmed structurally/visually (palette, transparency, dimensions, composited Greet). Byte-exact unique-image count + per-pixel grading **moved to Cycle 2** (gates `acs2bundle`) — see ADR-0009 |
| 2 | Full parser + sounds + `acs2bundle` | Generalize to the whole format; emit web-ready bundles | **MET (PR stacked on Cycles 0/1):** Genie/Merlin/Peedy/Robby convert to valid bundles (manifests pass the zod validator); exact unique-image count + lossless sprite-sheet round-trip (pixel-for-pixel, 0 mismatches across 2,775 images); synthetic fixtures exercise the full parser in CI |
| 3 | Core renderer (silent) | The browser engine: compositing, timing, branching, queue, authentic **balloon** (text only) | Load Genie, click any animation → plays; balloon styled per character; queue works. (A working silent MASH.) |
| 4 | MASH demo (silent) | Showcase + dogfood the public API early | Character picker (incl. arbitrary `.acs` upload), full animation grid, type-to-balloon; deployed |
| 5 | **Voice spike** — Wine + SAPI4 + TruVoice | Authentic voice + mouth timing out of the real engine | **GO/NO-GO:** `curl` with Genie's voice params → authentic WAV + non-empty mouth timeline that lines up with audio |
| 6 | Lip-sync + audio integration | Wire the authentic provider; drive mouth overlays from the timeline; word-sync the balloon; add Web Speech fallback | Type a sentence → Genie speaks in the real voice, mouth in sync. The "full experience" milestone |
| 7 | Packaging + docs | Make it adoptable | `npm i`, drop component, talking character in <10 lines; README + live demo |

Note: Cycle 4 (demo) is pulled *before* voice so there's a visible, shippable artifact at the halfway mark and the public API gets exercised early. Voice (5/6) then upgrades it from silent to full.

## Known long tail (not defeatism, just honesty)
"Any old `.acs` runs" is the goal, but expect quirky characters — gestures-at-point, heavy multi-image frame compositing, unusual branching, non-English voice configs — to need iteration after the common case works. Track these as fixtures with expected output as we find them.
