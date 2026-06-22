# Cycle 22 — final docs polish (roadmap accuracy, typo, characters gallery)

## Goal
Close out the docs cleanup arc. The final audit came back DONE except three items; this cycle fixes all
three. **Docs + committed image assets only — no app/code change; CI stays green.**

1. **Roadmap drift + kill the self-staling convention.**
2. **One-line typo** in `docs/legal-and-assets.md`.
3. **Expand `docs/characters.md`** so the gallery actually shows the original cast, not just Genie.

## 1. Roadmap — fix the drift AND the root cause

**The instances:**
- `docs/roadmap.md:40` shows **Cycle 19 as "In progress (this PR)"** though it merged (PR #23).
- **Cycles 20** (voice docs, **PR #24**) and **21** (help cluster, **PR #25**) are missing from the
  numbered "Shipped" table and wrongly sit as unnumbered "Planned" rows — they're done.

**The root cause (the recurrence):** the roadmap carried an **"In progress (this PR)" row** for the
in-flight cycle. That row self-stales the moment the PR merges, so every cycle re-introduces drift. The
last two cycles each left it stale.

**The convention change (this is the durable fix):** the roadmap will only contain
- a **Shipped** table — factual, merged history (a row is added when a cycle merges; its status never goes
  stale because "Merged" stays true), and
- a **forward-looking** section ("Ideas / not yet scheduled") that describes possible future work **without
  ever referencing the current in-flight PR**.

No more "In progress (this PR)" row. A cycle's own row is written as part of its PR describing what it
shipped (true the moment it lands and forever after) — never as a status that needs updating on the next
merge. This convention is recorded **here in the cycle doc** (a docs-maintenance convention, not an
architectural decision, so no ADR).

**Concretely:** the Shipped table gains rows for **19 (PR #23)**, **20 (PR #24)**, **21 (PR #25)**, and
**22** (this cycle — final polish; referenced by `cycle-22-final-polish.md`, no self-staling status). The
old "In progress / Planned" table's now-false rows (Help pages / Voice docs "Planned") are removed; a
short, honest "Ideas / not yet scheduled" section replaces it (grounded in real repo signals — e.g. a
hosted live demo, publishing the `@vivify/*` packages to npm — both already acknowledged as not-yet in the
README/developer docs). The existing "Known long tail" section stays.

## 2. Typo — `docs/legal-and-assets.md:6`
The line has a literal unfinished parenthetical: `TMAFE (The Microsoft Agent Fan ... community)`. The repo
does not state what TMAFE expands to, and I will **not invent** an expansion. Fix: reword cleanly to drop
the dangling `...` while keeping the accurate, already-stated fact that TMAFE is the de-facto community
archive. (Result: "TMAFE is the de-facto community archive and is fine to use.")

## 3. Expand `docs/characters.md` — show the real cast
Fixtures present in `packages/acs/fixtures/raw/`: **Genie, Merlin, Peedy, Robby** (all four confirmed).
Genie already has committed assets; this cycle captures the other three with the **existing** capture
tooling (`scripts/capture/capture-docs.ts`), pointed at each fixture, against a live MASH (dev server is
enough — portraits/animation need **no** voice container, so `--no-speak`).

Per character (Merlin, Peedy, Robby):
- `assets/screenshots/<name>-portrait.png` (tight portrait) + `assets/gifs/<name>-animation.gif` (an
  animation playing). **Only the rendered PNG/GIF are committed — never the `.acs`** (ADR-0028, ADR-0006).
- Each image is **viewed** before commit to confirm the character actually rendered (not a blank stage),
  exactly as Genie was validated.
- characters.md gains a short, **factual** entry per character (name + what kind of character it is —
  genie/wizard/parrot/robot — no invented lore), keeping the "any `.acs` works" framing but now showing
  the original four.

If a fixture is missing or a capture genuinely fails on attempt, the cycle doc/PR will say which and why —
**no faked images, no invented characters.**

## Acceptance check
- `docs/roadmap.md`: Shipped table lists every merged cycle 0–22 with correct PR/cycle-doc refs; **no
  "In progress (this PR)" row anywhere**; the forward-looking section references no in-flight PR.
- `docs/legal-and-assets.md`: no dangling `...`; no invented expansion.
- `docs/characters.md`: shows Genie + Merlin + Peedy + Robby, each with a real rendered image and factual
  detail; "any `.acs`" framing intact.
- New assets are PNG/GIF only (no `.acs` committed); every image ref resolves; every link resolves.
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green (docs only; Markdown
  prettier-ignored).

## Verification
- Each committed character image **viewed** to confirm it rendered.
- `git show --stat` lists only `.md` + PNG/GIF (no `.acs`); `grep -rn "coming soon\|In progress (this PR)"`
  shows no stale roadmap row.
- `code-reviewer`: roadmap matches real merged history and the self-stale convention is gone; no invented
  character lore; IP hygiene (no committed `.acs`); images render; links resolve.

## Non-goals
No app/code change. `architecture.md` is already adequate per the audit — not touched. No merge — open a PR
(base `main`) and stop.
