# Cycle 13 — repo shine (banner + README + GitHub metadata)

## Goal
The build is feature-complete (authentic TruVoice voice, dense lip-sync, pose stacking, Docker, disk TTS
cache), but the repo's front door is still a terse dev blurb. Make it **shine for a zero-assumptions
audience** — including non-technical, nostalgia-driven visitors who may never have heard "Microsoft
Agent." **Docs/README/asset only — no code change; CI stays green.**

Voice/structure follow the parked **Vision & docs spec** (the project's north star, kept out of the repo).
Its non-negotiables govern this cycle:

- **Assume nothing**; **simple, then simpler**; **when in doubt, more hand-holding**.
- **Nostalgia is seasoning, never the spine.** Every wink is _deletable_ without losing any instruction,
  and lives only in set-off asides (the `💾 Remember when…` callout), the tagline, and the top hook.
- **Tiered onboarding**, always in this order: _see it → run it yourself (browser voice) → authentic
  TruVoice (opt-in upgrade)_. The Wine/Docker voice path is **never** on the main road.
- Second person, present tense, encouraging.

## Reconciliation: spec sequencing vs reality
The spec was written for a 12-cycle plan where docs/demo assets landed in its "Cycle 4/7." Reality: we're
feature-complete at Cycle 12, but there is **no hosted demo URL, no GIF/screenshot pipeline (Playwright is
a later cycle), npm is unpublished, and the `docs/` explainer pages don't exist yet.** So this cycle keeps
the spec's section **order + voice** and splits each into **build-now** vs **signpost-as-coming** — no
faked badges, no dead demo button, no invented screenshots.

| README section (spec order)   | This cycle                                                            |
| ----------------------------- | --------------------------------------------------------------------- |
| Banner                        | **now** — `assets/banner.svg`                                         |
| Badges                        | **now, minimal** — license · runs-in-browser · status (no npm/CI)     |
| One-liner + nostalgia hook    | **now**                                                               |
| Live demo (hero CTA)          | **adapted** — run MASH locally; hosted demo marked _coming_           |
| Animated GIF                  | **signpost** — _coming_ (Playwright capture is a later cycle)         |
| "What is this?" + MS history  | **now** — the heart of the zero-assumptions ask                       |
| Character gallery             | **now (text list)** — thumbnails _coming_                             |
| Try it in 60 seconds          | **now** — `docker compose up mash` → upload `.acs` → play/talk        |
| Install (3 platform pages)    | **signpost** — `docs/install/{windows,mac,linux}.md` _coming_         |
| Want the real voice?          | **signpost** — `docs/voice/overview.md` _coming_                      |
| For developers                | **now + signpost** — inline API snippet + `docs/developers/*` _coming_|
| FAQ / Troubleshooting / Glossary | **signpost** — _coming_                                            |
| What you supply (IP)          | **now** — friendly, links existing `docs/legal-and-assets.md`         |
| Credits                       | **now** — gracious acknowledgments; `docs/credits.md` _coming_        |
| License                       | **now** — MIT + not-affiliated / no-MS·L&H-IP line                    |

Every _coming_ link points at the spec's **canonical** intended path, so the later docs cycles drop pages
into place with no link churn.

## Deliverable 1 — banner (`assets/banner.svg`)
Original artwork evoking a late-90s desktop window: teal desktop backdrop, raised silver chrome with a
navy→blue gradient title bar (`vivify.exe`), min/max/close buttons, a large `vivify` wordmark + plain-text
tagline, and a generic speech balloon with a talking `•••` and sparkles.

- **Format SVG** — crisp at any size; carries its **own opaque background** so it's legible on GitHub light
  _and_ dark themes.
- **IP rule holds** — no Microsoft/Genie/Clippy imagery, no character pixels, no lamp (too Genie-adjacent);
  only period UI furniture + typography + a generic chat bubble.
- **Font-robust** — decorative sparkles are **drawn shapes**, not Unicode glyphs, so nothing depends on the
  viewer's installed fonts except the plain-Latin wordmark/tagline. Validated as well-formed XML.

### Social-preview PNG (operator step)
The spec wants a **1280×640 PNG** for GitHub's social preview. No SVG rasterizer (`rsvg-convert`,
`inkscape`, ImageMagick, `sharp`, `cairosvg`) is available in the dev sandbox, and a docs-only cycle won't
add a dependency — so this is a quick operator step. Pick whichever tool you have:

```bash
# one of:
rsvg-convert -w 1280 -h 640 assets/banner.svg -o assets/banner-social.png
inkscape assets/banner.svg --export-type=png -w 1280 -h 640 -o assets/banner-social.png
npx --yes svgexport assets/banner.svg assets/banner-social.png 1280:640
```

Then set it in **GitHub → Settings → General → Social preview**. (The banner is 1280×320; exporting at
1280×640 letterboxes it with the teal background, which is fine.)

## Deliverable 2 — README (`README.md`)
Full rewrite to the table above, in the spec's voice. Discipline applied: short sentences; jargon (`.acs`,
lip-sync) defined inline with a _coming_ glossary link; nostalgia confined to the hook, the tagline, and a
single `💾 Remember when…` aside — all deletable without touching an instruction.

## Deliverable 3 — GitHub metadata (paste-ready — operator applies)
I can't set repo settings, so apply these by hand.

**Description** (Settings → General, or the ⚙ by "About"):

> Bring Microsoft Agent characters — Genie, Merlin, Clippy & friends — back to life in any browser. A
> faithful, framework-agnostic revival of the late-90s desktop assistant, voice and all.

**Topics** (the "About" gear → Topics; ≤20):

```
microsoft-agent  msagent  clippy  genie  nostalgia  retrocomputing  90s
typescript  javascript  browser  text-to-speech  tts  sapi4  truvoice
lip-sync  animation  acs  agent-character  vintage-computing  web-speech
```

**Homepage**: leave blank until a live demo is deployed.
**Social preview**: upload `assets/banner-social.png` (see Deliverable 1).

## What is verified where
- **CI (this repo):** `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` stays green — no code
  touched; prettier covers the new/edited Markdown; the banner is valid XML.
- **Operator (eyeball + GitHub):** the README renders with the banner crisp on both light and dark themes;
  every `docs/...` link either resolves to an existing file (`legal-and-assets.md`, `architecture.md`,
  `roadmap.md`) or is clearly marked _coming_; the description + topics are pasted into GitHub; optionally
  the social-preview PNG is exported and uploaded.

## Non-goals (later cycles — signposted only)
The `docs/` explainer pages (getting-started, install/\*, characters, voice/\*, developers/\*, faq,
troubleshooting, glossary, credits); the Playwright screenshot/GIF pipeline + gallery thumbnails; community
files (CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / issue templates); the hosted live-demo deploy. No
code / `@vivify/core` / browser change. See ADR-0025 for the front-door approach.
