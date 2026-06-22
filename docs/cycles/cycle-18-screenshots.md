# Cycle 18 — screenshots + GIFs of the running app (Playwright capture)

## Goal
Produce real screenshots and animated GIFs of vivify actually running — a character loaded, the
animation grid, the speech balloon, and Genie talking with his mouth moving — and wire them into the
docs pages that currently signpost "images coming." This is the **last planned docs cycle**.

**The hard constraint:** capturing the live app needs the running stack, which only exists on the
operator's machine — Docker for MASH, and (for the talking/lip-sync shots) the Wine + SAPI4 + TruVoice
voice container plus the operator's user-supplied `.acs` and voice files. The CI sandbox has none of
that and cannot run Wine or the authentic voice. So this cycle ships **the capture tooling + the docs
wiring**; the operator runs the script locally and commits the produced image files.

**Docs + capture-script only (tooling, not app code); CI stays green.**

## What CC builds (this PR)
1. **A Playwright capture script** — `scripts/capture/capture-docs.ts` (+ `gif.ts`, `README.md`) that
   drives MASH at a configurable URL (default `http://localhost:8090`), uploads a `.acs` the operator
   supplies, plays an animation, types into the balloon, triggers Speak, and saves stills (PNG) and
   short GIFs (PNG-frame loop → `gifenc`). Parameterized + documented for a clean first local run.
2. **Docs wiring** — replace the "coming soon / images coming" signposts with real `![alt](path)`
   references at the output paths, with good alt text, so the pages render the images once the files
   land.
3. **ADR-0028** — records the load-bearing asset decision (screenshots/GIFs of the running app are
   permitted documentation, distinct from committing source `.acs`/binaries; a deliberate, scoped
   carve-out from [ADR-0006](../decisions/0006-permissive-license-no-bundled-ip.md)).

## What the operator runs (and commits)
1. Bring the stack up: `docker compose up` (MASH on `:8090`; the voice container on `:8080` is needed
   only for the authentic talking/lip-sync shots — Tier 2 from the install pages).
2. Install the browser once: `pnpm capture:setup` (runs `playwright install chromium`).
3. Capture: `pnpm capture -- --acs /path/to/Genie.acs` (defaults: `--url http://localhost:8090`,
   `--name genie`, output to `assets/`). The script writes the five files below.
4. `git add assets/screenshots assets/gifs && git commit` — the operator commits the actual images to
   this branch before merge.

The `.acs` is supplied via `--acs` and **never committed** (`*.acs` is gitignored). The script bakes in
**no** download of any proprietary asset.

## Assets produced (default `--name genie`)
| Path | What it shows | Wired into |
| --- | --- | --- |
| `assets/screenshots/genie-app.png` | The whole MASH window: character on stage + animation grid + controls | install ×3 ("you should see"), docs landing, dev overview, README (60-seconds) |
| `assets/screenshots/genie-portrait.png` | Just the character (the `#stage` element) | characters gallery, README cast |
| `assets/screenshots/genie-speaking.png` | A still mid-speech (balloon up, mouth moving) | — (companion; reserved) |
| `assets/gifs/genie-animation.gif` | A representative animation playing | — (reserved for future) |
| `assets/gifs/genie-speaking.gif` | Genie talking with his mouth moving | README hero ("See it move"), what-is-this, dev quickstart |

Doc paths assume the default `genie` prefix. Capture a different character with `--name <x>` and the
files become `<x>-…`; update the doc paths or stick with `genie` for the wired pages. The gallery grows
by running the script per character.

## Honest boundary (flagged, not hidden)
- CC **cannot** run Wine / the authentic voice, and likely cannot launch a real browser in the sandbox,
  so CC does **not** produce the real images. The PR lands scripts + wiring; the operator generates and
  commits the images.
- Until the operator commits the files, the new `![…]` references **404 on GitHub** — expected. Merge
  only after the images are committed to this branch.
- Playwright can only photograph the **browser** (the running app). The install pages' Docker/terminal
  steps stay as written text; their image is the end-result app screenshot, so the old "screenshots for
  every step" promise is corrected to that honest scope.
- The talking/lip-sync shots (`*-speaking.*`) need the voice container up. The animation GIF and the
  app/portrait stills need only MASH. If Speak can't reach the voice server, the script logs a warning
  and still saves what rendered.

## IP / asset hygiene
- Never commit `.acs` or voice binaries (enforced by `.gitignore`: `*.acs`, `*.wav`). The script reads
  the `.acs` from an operator-supplied path and never writes it anywhere.
- Captured PNG/GIF of the **running app** (rendered character pixels in the demo) are documentation of
  the app — permitted by ADR-0028. The captured images must not embed or expose the `.acs` source —
  they show only the rendered character, which is the intended documentation.
- No proprietary fetch/download is baked into the scripts.

## Tooling notes
- New **root** devDependencies: `playwright`, `tsx`, `pngjs` + `@types/pngjs`, `gifenc`. Root scripts:
  `capture` (`tsx scripts/capture/capture-docs.ts`) and `capture:setup` (`playwright install chromium`).
- `scripts/` is **not** a pnpm workspace (mirrors the existing `packages/acs/scripts/spike-dump.ts`
  tsx pattern); it resolves deps from root `node_modules` and is **not** in the CI `typecheck` graph. It
  is linted by `eslint .` and formatted by Prettier, so it must pass both.
- GIFs are built from a loop of element screenshots → `pngjs` decode → optional nearest-neighbor
  downscale (default max width 480px) → `gifenc` 256-color quantize. No system `ffmpeg` dependency.

## Acceptance check
- `scripts/capture/capture-docs.ts` exists, is parameterized (`--url/--acs/--name/--out/--speak/
  --animation/--smoke`), documented in `scripts/capture/README.md`, and uses the real MASH selectors
  (`#file`, `#stage`, `#animations .anim`, `#speak`, `#speakBtn`, `#voiceUrl`, `#status`).
- Every "images coming" signpost listed above is replaced by a real `![alt](assets/…)` reference with
  descriptive alt text, at the correct relative depth.
- ADR-0028 is written and linked from the cycle doc.
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` is green with the new deps and script.

## Verification
- **CI (CC):** the four checks above pass. Best-effort: `--smoke` mode against a dev MASH to validate
  selectors/plumbing without a `.acs` — reported honestly if the sandbox can't launch a browser.
- **Operator:** run the four steps above; confirm the five files land in `assets/`, open the docs on
  GitHub and see them render. Tell CC if a shot needs a specific character/animation loaded.

## Non-goals
Nothing after this (last planned docs cycle). No app/`@vivify/core` code change. No committing `.acs`
or binaries. No hosted demo. No merge — open a PR (base `main`) and stop.
