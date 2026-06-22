# Cycle 14 — docs skeleton + landing page

## Goal
Cycle 13 polished the README front door and signposted a set of `docs/` pages as _(coming soon)_ — but
those targets didn't exist, so every front-door "coming soon" link 404'd. This cycle builds the **docs/
backbone**: the full folder layout + navigation that later cycles fill in, plus the docs landing and the
zero-assumptions "What is this?" explainer written for real. In-repo Markdown only — renders on GitHub, no
site framework, no build step. **Docs only; no code; CI stays green.**

Voice/structure follow the parked **`vision-and-docs-spec.md`** (the project's north star, intentionally
not committed): assume nothing; nostalgia is _deletable seasoning_, never the spine; tiered onboarding;
second person, warm, encouraging.

## Page map (this is the reviewable structure)
Landing is **`docs/README.md`** — GitHub auto-renders it when you browse to `docs/`, which is exactly right
for "renders on GitHub, no build step." Every path below matches the README's existing signposts exactly,
so there's **no link churn**.

| Path | This cycle | Notes |
| --- | --- | --- |
| `docs/README.md` | **written** | Landing: orientation + TOC + **platform picker** front-and-center |
| `docs/what-is-this.md` | **written** | Zero-knowledge Microsoft Agent explainer (deep version of the README teaser) |
| `docs/glossary.md` | **written** | Pure content — plain-English terms |
| `docs/credits.md` | **written** | Pure content — gracious acknowledgments (expands the README list) |
| `docs/getting-started.md` | stub | README signposts it; gentle walkthrough lands later |
| `docs/install/windows.md` · `mac.md` · `linux.md` | stub | **Cycle 15** |
| `docs/characters.md` | stub | gallery + how to get `.acs` (**Cycle 17**) |
| `docs/voice/overview.md` · `setup.md` · `sourcing-components.md` | stub | overview + sourcing are README signposts |
| `docs/developers/overview.md` · `quickstart.md` · `api.md` · `providers.md` · `bundles.md` | stub | overview + quickstart are README signposts (**Cycle 16**) |
| `docs/faq.md` | stub | depends on later pages |
| `docs/troubleshooting.md` | stub | README signposts it |
| `docs/architecture.md` · `docs/roadmap.md` · `docs/legal-and-assets.md` | pre-existing | linked, not touched |

After this cycle, **every** README `(docs/…)` link resolves to a real file (a stub or a written page) — no
more 404s from the front door. The `developers/` page is the nested **`docs/developers/overview.md`** (not
a flat `docs/developers.md`) to match the README signpost — decided with the PO.

### Stub template (consistent across all 15 stubs)
Title → a `🚧 Coming soon (Cycle N / a later cycle)` note → a one-line "what it'll cover" → two interim
pointers (What is this? / main README) → a "← Back to the documentation home" link. Relative links are
depth-correct (`../` for nested pages under `install/`, `voice/`, `developers/`).

## Written pages
- **`docs/README.md`** — friendly orientation; a Windows/macOS/Linux **platform picker** up top routing to
  the install pages; then a table of contents grouped by intent (New here? · Get it running · The
  characters · The real voice · For developers · Help · About). All relative `.md` links; one deletable
  nostalgia aside.
- **`docs/what-is-this.md`** — Microsoft Agent from zero: what it was, how people met the characters
  (Clippy & co.), the cast, what happened (removed in Windows 7), and what vivify does. Jargon defined
  inline + linked to the glossary; nostalgia confined to a hook + one aside; ends by routing the reader
  onward.
- **`docs/glossary.md`** — plain-English definitions (Microsoft Agent, `.acs`, animation, frame, sprite
  sheet, balloon, TTS, SAPI/SAPI4, TruVoice, lip-sync/viseme, bundle, provider/fallback, Wine, Docker).
- **`docs/credits.md`** — the MS Agent team; DoubleAgent + Lebeau's decompiler (format references);
  clippy.js (proof of concept); TETYYS/SAPI4 (the voice path); TMAFE (the archive).

## Root README touch-ups (additive — no link churn)
- A top-level **📖 Documentation** pointer (→ `docs/README.md`) and a **"What is this?"** read-more link
  (→ `docs/what-is-this.md`), per the PO.
- Accuracy: the two `glossary.md` mentions and the `credits.md` mention dropped their "_(coming)_"
  qualifier now that those pages exist (same paths — not churn).

## What is verified where
- **CI (this repo):** `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` stays green — no code
  touched; Markdown is prettier-ignored by design.
- **Link audit (load-bearing):** a read-only pass confirms every relative `.md` link in `README.md` and all
  `docs/**/*.md` resolves to a file that exists — zero broken links — and that every README `(docs/…)`
  signpost now resolves. `code-reviewer` re-verifies, plus that the created paths match the README signposts
  exactly.
- **Operator:** browse to `docs/` on GitHub → the landing renders with a working platform picker + TOC;
  click through a few links to confirm navigation.

## Non-goals (later cycles — stubbed only)
Per-platform install steps (Cycle 15); developer page content (Cycle 16); the deeper voice page bodies;
Playwright screenshots/GIFs + gallery thumbnails (Cycle 17). No code / `@vivify/core` / browser change.
See ADR-0026 for the structure decision.
