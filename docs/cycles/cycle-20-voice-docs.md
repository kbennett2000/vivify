# Cycle 20 — the voice/\* cluster (authentic-voice docs)

## Goal
Fill the three empty `docs/voice/*` stubs at their canonical paths so the entire "want the real voice?"
CTA chain (README + docs landing + developer pages + glossary) stops dead-ending in a placeholder:

- `docs/voice/overview.md` — what the authentic voice IS and why it needs a helper (the hub).
- `docs/voice/setup.md` — the **conceptual** setup hub (architecture), linking out to the OS steps.
- `docs/voice/sourcing-components.md` — the friendly front door for the three supplied files.

Audience spans curious non-technical users **and** developers. Voice/tone follows the parked
`vision-and-docs-spec.md` (PO pasted it this session): warm, second-person, plain, nostalgia only in
clearly set-off asides. **Docs only — no code; CI stays green.**

## Canonical-home split (the explicit no-duplication / no-contradiction decision)
There are three overlapping things; each gets exactly ONE canonical home, and the voice pages link rather
than re-paste:

| Topic | Canonical home | What the voice pages do |
| --- | --- | --- |
| **Per-platform step-by-step** (install Docker, drop files, run command) | `docs/install/{windows,mac,linux}.md` (Tier 2) — already written | `voice/setup.md` explains the setup **conceptually** and **links** to these; it does NOT re-paste the steps |
| **Detailed sourcing list + IP/legal posture** (the actual places to get the files, ADR-0006/0027) | `docs/legal-and-assets.md` — already canonical | `voice/sourcing-components.md` is the friendly summary that **links into** legal-and-assets §2; it adds **no** direct proprietary download links |
| **What/why the authentic voice is** (conceptual) | NEW: `voice/overview.md` (hub) + `voice/setup.md` (how it fits together) | these are the new canonical conceptual pages |

So: install pages own the *do-it-on-my-OS* steps; legal-and-assets owns the *where-to-get-it* source list +
IP posture; the voice cluster owns the *understand-what-this-is-and-how-it-fits* concepts and routes the
reader to the other two. No step-by-step is duplicated; no sourcing link is duplicated; nothing contradicts
legal-and-assets.

## Verified facts the pages use (cross-checked against the repo)
- **Architecture:** `services/voice-server` = Dockerized **Wine + SAPI4 + L&H TruVoice** behind a thin Node
  HTTP API. `POST /tts {text, voice}` → `{audioWavBase64, mouthTimeline, format}`; `GET /health`. Port
  **8080**. (`services/voice-server/README.md`, ADR-0014.)
- **Why a backend:** the TruVoice voice is closed 1990s Win32 software (SAPI4) that can't run in a browser
  → it runs in the Wine service; the browser calls it. (ADR-0004.)
- **The 3 user-supplied files**, all under `services/voice-server/vendor/`: `spchapi.exe` (SAPI4 runtime),
  `tv_enua.exe` (L&H TruVoice voice), `sdk/include/speech.h` (SAPI4 SDK header, build-time;
  `vendor/sdk/include/speech.h`). Build fails loudly naming the exact `speech.h` path if missing.
- **One command:** `docker compose up` runs MASH (:8090) + voice (:8080); the image compiles its own
  `dist/` in-image, so **Docker is the only host tool** (Cycle 15 / ADR-0027). `docker compose up mash` =
  demo only, silent (no voice binaries needed).
- **How MASH connects:** the voice URL field pre-fills to `http://localhost:8080` (build arg
  `VITE_VOICE_SERVER_URL`); the **browser** makes the call (not container-to-container); clearing the field
  goes silent. (`apps/mash/src/{app,characters}.ts`, `docker-compose.yml`.)
- **Cache:** repeats are instant — disk cache keyed by `hash(text+voice)`, persisted on the
  `vivify-tts-cache` volume (Cycle 12 / ADR-0024).
- **First-utterance note:** the server warms the whole pipeline at startup; a brand-new line may clip its
  very first instant slightly, a repeat won't (a cache hit can't clip).
- **Fallback vs authentic:** `WebSpeechProvider` (browser voice, zero backend) vs `TruVoiceProvider`
  (authentic, needs the server). (`packages/voice-truvoice/src/index.ts`.)

## README accuracy fixes (these pages become real, so two CTAs are now stale)
- `README.md:~125` — "The authentic voice … `_(coming soon)_`" → drop the marker (overview.md is now real).
- `README.md:~182` — "a friendlier consumer guide **is coming in** `voice/sourcing-components.md`" →
  "**is in** …" (the page now exists).
- `docs/README.md` (lines 47–48) already links the three pages cleanly — no change. Glossary + developer
  links already point in without a "coming soon" — no change. (No path churn.)

## Pages — shape
Each page: warm intro → the content below → a "Where to next" nav → `← Back to the documentation home`
footer (matching the existing convention).
- **overview.md** (hub): the two voices and the tradeoff (browser fallback = instant, not original;
  authentic = the real TruVoice + lip-sync, needs the helper); what TruVoice is; why a helper is needed
  (closed Win32, ADR-0004); high-level "what you need" → route to setup + sourcing + install.
- **setup.md** (conceptual): how the pieces fit (MASH in the browser :8090 ↔ voice helper :8080, the call
  happens in the browser, pre-filled URL, clear-to-silence); the 3 files + where they live (concept, link
  sourcing for where-to-get + install for drop-in); one command `docker compose up` (Docker-only, ADR-0027)
  vs `up mash`; the cache (repeats instant); the honest first-utterance clip note; then **hand off** to the
  per-platform install guides for the actual steps.
- **sourcing-components.md** (front door): the 3 files in plain language + why you supply them (IP posture,
  friendly); where they go; **no direct proprietary links** — link to `legal-and-assets.md` §2 for the
  authoritative source list. Cross-link setup + install.

## Acceptance check
- All three pages have real content (no "🚧 Coming soon"), in the spec voice, and cross-link each other +
  the docs landing.
- **No install step-by-step is duplicated** (voice/setup links to install pages for OS steps).
- **No contradiction with `legal-and-assets.md`** and **no direct proprietary download links** anywhere in
  `voice/*` (sourcing summarizes + links).
- Every documented fact matches the repo (ports, file paths, endpoint shape, one-command flow).
- README CTAs no longer say "(coming soon)" / "is coming" for these now-real pages; every relative link
  resolves.
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green (docs only; Markdown
  prettier-ignored).

## Verification
- `code-reviewer`: verifies no install-step duplication, no legal-and-assets contradiction, no proprietary
  links, every fact matches the repo, all links resolve.
- `grep -rn "coming soon" README.md docs/ | grep -vE 'cycles/|decisions/'` → no hit points at a voice page.

## Non-goals
The help cluster (getting-started, faq, troubleshooting) — next cycle. No edits to the install pages or
`legal-and-assets.md` content (only link/reference accuracy in README). No code. No merge — open a PR
(base `main`) and stop.
