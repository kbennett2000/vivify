# Cycle 16 — per-platform install pages (Windows / macOS / Linux)

## Goal
Fill the three install stubs the docs landing's platform picker links — at their **canonical paths**
(`docs/install/windows.md`, `mac.md`, `linux.md`; no renames) — so a **zero-assumptions** reader (possibly
non-technical, may never have opened a terminal) can go from nothing → a talking character in the browser.
Voice follows the parked `vision-and-docs-spec.md`: assume nothing; simple, then simpler; when in doubt,
more hand-holding; nostalgia is _deletable seasoning_. **Docs only — no code; CI stays green.**

The authentic-voice path was simplified in Cycle 15 (merged): one `docker compose up`, **no host
Node/pnpm** (the image builds itself). These pages match that exactly.

## Verified facts the pages use (no guessing)
- **Ports:** MASH `http://localhost:8090`, voice `http://localhost:8080` (MASH pre-fills the voice URL).
- **Tier 1** (demo, browser voice): just Docker → `docker compose up mash` → 8090 → upload a `.acs`, type,
  Speak. MASH builds in-image; no vendor files needed.
- **Tier 2** (authentic voice): drop **3** user-supplied files into `services/voice-server/vendor/` —
  `spchapi.exe`, `tv_enua.exe`, `sdk/include/speech.h` — then `docker compose up` (both). Docker is the
  only host tool (first build slower, then cached). First synthesis of a new phrase ~3–4s; repeats instant
  (cache); a novel first utterance may clip slightly (minor). Missing `speech.h` → build fails with the
  exact drop path.
- **Sourcing:** all three files via [`docs/legal-and-assets.md`](../legal-and-assets.md) (§2 lists the
  SAPI4/TruVoice sources + the SAPI4 SDK archive that contains `speech.h`). **No proprietary download
  links** in the install pages; Docker's own official docs links are fine.
- **Official Docker install docs (confirmed current, June 2026):** Desktop overview
  `https://docs.docker.com/desktop/`; Windows
  `https://docs.docker.com/desktop/setup/install/windows-install/`; macOS
  `https://docs.docker.com/desktop/setup/install/mac-install/` (Apple-chip vs Intel builds); Linux Engine
  `https://docs.docker.com/engine/install/`, Compose plugin `https://docs.docker.com/compose/install/linux/`,
  run-without-sudo `https://docs.docker.com/engine/install/linux-postinstall/`.

## Shared page skeleton (all three identical; only platform bits differ)
1. Title + warm intro (names the two tiers).
2. **Tier 1 — See it run** (browser voice, easy on-ramp): install Docker → get the project (clone or
   Download ZIP) + open a terminal + `cd` → `docker compose up mash` → 8090 → upload `.acs`, Speak →
   expectation note (browser voice) → celebrate.
3. **Tier 2 — Authentic TruVoice voice** (opt-in): why files (plain language) → the 3 files into
   `services/voice-server/vendor/` (sourcing → legal-and-assets) → `docker compose up` → authentic Genie →
   notes (Docker-only, first-build/cache, novel-utterance clip).
4. Trouble? → `troubleshooting.md` / `faq.md` / `glossary.md` (stubs, _coming_).
5. Screenshots + GIF **coming in Cycle 17** (no faked images).
6. Footer nav: docs home + the other two platform pages + main README (identical on all three).

**Per-platform differences:** Windows — Docker Desktop (WSL2 backend), PowerShell/Windows Terminal. macOS —
Docker Desktop, **Apple-chip vs Intel** download note, Terminal via Spotlight. Linux — Docker **Engine** +
the **Compose plugin** (`docker compose`, not `docker-compose`) + **run-without-sudo** post-install (docker
group), with `sudo` as the no-setup fallback.

## What is verified where
- **CI (this repo):** `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` stays green (docs
  only; Markdown prettier-ignored). A link-audit script confirms every relative `.md` link resolves; a grep
  confirms **no** proprietary download links in the install pages.
- **Operator:** open `docs/install/*` on GitHub; follow Tier 1 to a character on screen, Tier 2 to the
  authentic voice. (Screenshots that would make this even easier arrive in Cycle 17.)

## Notes / follow-ups
- `docs/legal-and-assets.md` §2 frames the speech files as "two installers" and mentions the SAPI4 SDK
  archive only in passing — it doesn't name `speech.h` explicitly. The install pages point to it as-is
  (no contradiction); a future cycle could update that doc to list `speech.h` as the third supplied file.

## Non-goals
Developer page (next cycle); screenshots/GIFs (Cycle 17 — signposted); the `voice/*` deep pages; editing
`docs/legal-and-assets.md`. No code / `@vivify/core` change.
