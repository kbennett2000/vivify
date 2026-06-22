# ADR-0026: docs/ skeleton — in-repo Markdown that renders on GitHub, a README.md landing, a canonical page map matching the README signposts exactly, stubs everywhere with only the no-dependency pages written for real
Status: Accepted · Date: 2026-06-21

## Context
Cycle 13 (ADR-0025) polished the README front door and signposted a set of `docs/` pages as _(coming soon)_ — install guides, voice pages, developer docs, glossary, credits, FAQ — but **those targets didn't exist**, so every front-door "coming soon" link 404'd. This cycle builds the `docs/` backbone: the full folder layout + navigation later cycles fill in, plus the docs landing and the zero-assumptions "What is this?" explainer written for real.

The binding voice/structure authority is the parked **Vision & docs spec** (the project's north star, intentionally **not committed** to the repo; pasted in-session when a docs cycle needs it). Its rules carry: assume nothing; nostalgia is _deletable seasoning_, never the spine; tiered onboarding; second person, warm, present tense. **Docs only; no code touched; CI stays green.**

## Decision

**1. `docs/` is in-repo Markdown that renders on GitHub — no site framework, no build step.**
The docs are plain `.md` files committed to the repo and read directly in the GitHub file browser; there is no Docusaurus/MkDocs/static-site layer and no compile/publish step. WHY: zero friction to author and to read — it works in the GitHub file browser today, and it honors the standing "no build step" constraint so a docs cycle never drags in tooling.

**2. The landing page is `docs/README.md` (not `docs/index.md`).**
The docs home is `docs/README.md`. WHY: GitHub auto-renders a folder's `README.md` when you browse to that folder, so `docs/README.md` _is_ the docs home with no tooling — an `index.md` would just be another file the visitor has to click. The spec's "index.md or README in docs/" explicitly allows this, and the README path keeps the no-build-step promise honest.

**3. The page map matches the README's existing signposts EXACTLY — canonical paths, no link churn.**
Every path in the map is the exact path the README already links. Notably the developer page is the **nested `docs/developers/overview.md`** (not a flat `docs/developers.md`), and the voice pages are nested under `docs/voice/` (`overview.md`, `setup.md`, `sourcing-components.md`). WHY: the README (ADR-0025) already links these exact paths; renaming a page later would break the front door it was built to feed. Decided with the PO when the Cycle 14 brief's flat path conflicted with the match-the-README rule — match-the-README wins.

**4. Stub every page in the map now (consistent "coming soon" template); write only the no-dependency pages for real this cycle.**
Written for real now: `docs/README.md` (landing), `docs/what-is-this.md` (zero-assumptions explainer), `docs/glossary.md`, `docs/credits.md`. Everything else — `install/{windows,mac,linux}.md`, `characters.md`, `voice/*`, `developers/*`, `faq.md`, `getting-started.md`, `troubleshooting.md` — ships as a stub (title → `🚧 Coming soon` note → one-line "what it'll cover" → interim pointers → back-link, with depth-correct relative links). WHY: every README "(coming soon)" link resolves immediately — no 404s from the front door — and later cycles fill the bodies in place with zero link churn. Writing the install/dev/voice bodies now would be premature: they need screenshots, the demo, and per-platform testing that don't exist yet.

**5. `what-is-this.md` is a new standalone page added to the spec's map.**
The spec treated "What is this?" as a README _section_; this cycle promotes it to a full page, with the README keeping a teaser + a "read more →" link to it. WHY: the deep zero-knowledge explainer (what Microsoft Agent was, the cast, what happened, what vivify does) is too long to live on the front door but is essential for the zero-assumptions audience — so it gets its own page rather than bloating the README.

**6. Two additive root-README links + accuracy fixes only — no link churn.**
The root README gains a top-level **📖 Documentation** pointer (→ `docs/README.md`) and a **"What is this?"** read-more link (→ `docs/what-is-this.md`), and the `glossary.md`/`credits.md` mentions drop their "_(coming)_" qualifier now that those pages exist (same paths). WHY: discoverability from the front door without renaming or moving any existing link.

## Consequences
- **The front door no longer 404s.** Every README `(docs/…)` signpost now resolves to a real file — a stub or a written page — and later cycles drop bodies into the stubbed paths with zero link churn.
- **This page map is now the canonical contract for later docs cycles.** Cycle 15 (install), Cycle 16 (developers), and Cycle 17 (screenshots/gallery) fill the stubbed pages in place at these exact paths; this ADR is the standing reference for why the layout is what it is and why the developer/voice pages are nested.
- **Verification boundary (CI vs operator).** CI proves `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` stay green with **no code touched** (Markdown is prettier-ignored by design), and a read-only **link-audit script** confirms all 109 relative `.md` links across `README.md` and `docs/**/*.md` resolve to a file that exists — zero broken links, every README signpost now landing. The **operator** verifies what CI cannot: browse to `docs/` on GitHub → the landing renders with a working platform picker + TOC, and click through a few links to confirm navigation works.
- **No third-party IP.** Docs-only Markdown; no `.acs` files, engine binaries, or Wine prefix are added. The repo's IP posture (ADR-0006) is preserved unchanged.

## Related
- ADR-0025 — repo front door; adopted the parked Vision & docs spec as the binding authority and signposted these `docs/` paths as _coming_. This cycle makes those paths real.
- `docs/cycles/cycle-14-docs-skeleton.md` — the cycle this ADR records, including the full page-map table, the stub template, and the verified-where breakdown.
