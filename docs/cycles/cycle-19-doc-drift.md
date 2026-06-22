# Cycle 19 — doc drift + stale-marker correctness pass

## Goal
A quick-win **correctness** pass on the docs: fix content that is now factually wrong because the work it
describes has shipped. No new page bodies — just make the DONE things stop claiming they're "coming." The
audit ([the cycle-18 follow-up](../../README.md) findings) surfaced three stale spots; this cycle fixes
exactly those and nothing else.

**Docs only — no code; CI stays green.** The genuinely-still-stub pages (getting-started, faq,
troubleshooting, voice/overview, voice/setup, voice/sourcing-components) get real content in **later
cycles** and are NOT touched here — their "(coming soon)" signposts are accurate and stay.

## What this cycle fixes

1. **README — stale developer-docs marker.** Lines ~162–165 say the developer docs / quickstart are
   "_(coming soon)_" — **false**: the five `docs/developers/*` pages shipped in Cycle 17 (merged, PR #20).
   Rewrite to point at the live pages (overview, quickstart, api, providers, bundles).

2. **README — hosted-demo line (~19).** "There's no hosted click-to-try demo yet _(coming soon)_" is
   accurate (there is still no hosted demo) but the `_(coming soon)_` tag reads like an unfinished-doc /
   broken-link marker. Reword to state the fact cleanly without the placeholder tag. (No hosted demo is
   being claimed as done — the statement stays true.)

3. **Images on main + the two spare assets.** PR #22 is merged, so all five `assets/…/genie-*` files are
   on main and every doc image ref resolves. Two captured assets were produced-but-unreferenced:
   - `assets/gifs/genie-animation.gif` (the Greet animation) → **wire into `docs/characters.md`** (it
     strengthens that thin page by showing a character actually in motion).
   - `assets/screenshots/genie-speaking.png` (a static mid-speech still) → **remove as redundant**: the
     speaking **GIF** (`genie-speaking.gif`) conveys strictly more and is already used on README,
     what-is-this, and developers/quickstart. (Removing the committed file only; the capture script is not
     touched — out of scope — so a future run still produces it locally.)

4. **`docs/roadmap.md` — the worst drift.** The table stopped at Cycle 12, labelled Cycles 8–11 "in
   progress / not merged" though they are long merged, dropped the stale per-voice-cycle "operator
   validation pending" hedges (the authentic voice + lip-sync is now confirmed working — Cycle 18
   captured real TruVoice Genie speech), and omitted Cycles 13–18 entirely. Rewrite it to the true merged
   history: every cycle 0–18 shown as shipped (with its PR + cycle-doc/ADR refs), plus an honest
   "in progress / planned" section for the remaining doc work (the 6 stub pages + thin-page polish).

## What is explicitly NOT touched (accurate signposts to real stubs)
- README `:112` (getting-started), `:125` (voice/overview), `:181` (voice/sourcing-components),
  `:191–193` (faq, troubleshooting) — all point at genuine stubs; "(coming soon)" is correct.
- The three install pages' footer links to `faq.md` / `troubleshooting.md` `_(coming soon)_` — correct.
- The six stub pages themselves — untouched (content lands in later cycles).

## Acceptance check
- No page that is actually DONE still says "(coming soon)" / "on the way": specifically the README
  developer-docs lines point at the live `docs/developers/*` pages.
- `docs/roadmap.md` reflects the real merged history through Cycle 18 (no cycle mislabelled "not merged";
  13–18 present), and an honest "planned" section for what's left.
- `genie-animation.gif` is referenced (characters.md) and renders; `genie-speaking.png` is removed and no
  doc references it.
- Every relative `.md` link still resolves; every `![](…)` image target exists on main.
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green (docs only; Markdown
  prettier-ignored).

## Verification
- `grep -rn "coming soon" README.md docs/ | grep -vE 'cycles/|decisions/'` → only the accurate
  stub-signposts remain (getting-started, voice/*, faq, troubleshooting); no developer-docs hit.
- `git ls-tree -r main -- assets/` vs the doc image refs → all resolve; `genie-speaking.png` no longer
  referenced.
- Read `roadmap.md` against `git log --merges` (PRs #1–#22) — statuses match.
- `doc-auditor` / `code-reviewer` confirms: roadmap matches merged history, no DONE page claims "coming,"
  links resolve, images render.

## Non-goals
Writing the 6 stub pages (getting-started, faq, troubleshooting, voice/*) — later cycles. Thin-page
expansion (characters gallery beyond the wired GIF, architecture page) — later/optional. No code changes.
No merge — open a PR (base `main`) and stop.
