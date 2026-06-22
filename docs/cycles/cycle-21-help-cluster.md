# Cycle 21 — the help cluster (getting-started / faq / troubleshooting)

## Goal
Fill the last three empty stubs at their canonical paths so the README/landing "Help" links stop
dead-ending:

- `docs/getting-started.md` — the gentle, universal on-ramp ("zero to a character on your screen, then
  where to go next").
- `docs/faq.md` — the common questions, answered plainly, each routing to the canonical page for depth.
- `docs/troubleshooting.md` — common hiccups + fixes, grouped by symptom, de-scared.

Audience is **zero-assumptions** (possibly non-technical, may never have used a terminal). Voice/tone per
the parked `vision-and-docs-spec.md` (PO pasted it this session): warm, plain, encouraging, more
hand-holding when in doubt; nostalgia only in clearly set-off asides. **Docs only — no code; CI stays
green.**

## No duplication — route, don't re-paste (canonical homes)
| Topic | Canonical home | Help pages |
| --- | --- | --- |
| Per-platform step-by-step (install Docker, drop files, run) | `docs/install/{windows,mac,linux}.md` | link to them |
| Sourcing + IP posture | `docs/legal-and-assets.md` | link to it |
| Authentic-voice concepts | `docs/voice/*` | link to them |
| What Microsoft Agent was | `docs/what-is-this.md` | link to it |

getting-started gives the **shape** of the simplest path and hands off to the per-OS install guide for the
actual hand-holding; faq answers short + links; troubleshooting gives symptom→fix and routes to the
canonical page for the steps. No install steps, no sourcing list, no voice walkthrough is re-pasted.

## Verified facts the pages use (cross-checked against the repo)
- **Tier 1 (browser voice):** `docker compose up mash` → `http://localhost:8090` → upload a `.acs`, type,
  **Speak**. No voice files needed; uses the browser's voice. (`docker-compose.yml`, install pages.)
- **Tier 2 (authentic voice):** `docker compose up` (both services); voice at `http://localhost:8080`,
  pre-filled in MASH; needs the 3 user-supplied files in `services/voice-server/vendor/`.
- **MASH status messages (verbatim, `apps/mash/src/app.ts`):**
  - load failure → `Couldn't load <name>: <error>`; wrong file → `Please choose a .acs character file.`
  - voice unreachable → `Couldn't reach the voice server at <url> (<detail>) — clear the field to speak
    silently.`; no URL set → `Speak failed: <detail>`.
- **Loud build failures (`services/voice-server/Dockerfile`):** missing `speech.h` →
  `FATAL: speech.h missing — drop the user-supplied SAPI4 SDK header at
  services/voice-server/vendor/sdk/include/speech.h (see docs/legal-and-assets.md)…`; also `FATAL: SAPI4
  Speech.dll not installed` / `TruVoice tv_enua.dll not installed` when the runtime `.exe`s weren't
  supplied. → all mean "a supplied file is missing/not in place."
- **First build is slow, then cached** (the voice image compiles its own `dist/` in-image — Cycle 15).
  **First novel utterance may clip slightly; repeats are instant** (disk cache, Cycle 12). The voice
  server returns an **honest 500** (never a faked/silent WAV) if synthesis fails.
- **Privacy:** Tier 1 runs entirely in the browser; Tier 2's `/tts` call goes from your browser to your
  **own** `localhost:8080` helper — nothing is sent to a third party.
- **Linux** may need `sudo docker …` or the docker group (the Linux install page covers the post-install).

## CTA accuracy fixes (these pages become real, so the markers are now stale)
Drop `_(coming soon)_` everywhere it points at these three now-real pages — **same links, no path churn:**
- `README.md` — getting-started (~112), FAQ (~191), Troubleshooting (~193).
- `docs/install/{windows,mac,linux}.md` "Trouble?" footers — Troubleshooting + FAQ `_(coming soon)_`
  (6 markers). `docs/README.md` landing already links them cleanly (no change).

## Pages — shape
- **getting-started.md:** warm "you can do this" intro → the simplest path in 4 plain beats (get Docker +
  the project / run one command / open the page / drop a character and talk) → **pick your OS** for the
  click-by-click (link the 3 install pages) → signposts (real voice → voice/overview; new here →
  what-is-this; developer → developers/overview; characters → characters.md). Short and confidence-building.
- **faq.md:** Q&A, short answers, each links the canonical page: is this legal? (→ legal-and-assets), do I
  need to be a programmer? (no — Tier 1), why no sound / why extra files? (→ voice/overview), which
  characters work? (→ characters), what is this? (→ what-is-this), what platforms?, is my data sent
  anywhere? (no), why is the first line a touch slow/clipped? (latency + cache), can I use it in my own
  app? (→ developers).
- **troubleshooting.md:** grouped by symptom, friendly/de-scary, each with the real behavior + the fix +
  a route: no sound; character won't load; Docker isn't running / port already in use (8090/8080);
  "scary" build messages (the loud `speech.h`/runtime FATALs → the drop path + legal-and-assets);
  first build slow; Linux permission/sudo. A short per-platform note where it differs.

## Acceptance check
- All three pages have real content (no "🚧 Coming soon"), in the spec voice, cross-linking each other +
  the docs landing + the canonical pages.
- No install/sourcing/voice content is re-pasted (route only); troubleshooting matches the **real** error
  behaviors quoted above.
- All `_(coming soon)_` markers pointing at these three pages are cleared (README + install footers);
  every relative link resolves.
- `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green (docs only; Markdown
  prettier-ignored).

## Verification
- `code-reviewer`: no duplication of install/sourcing/voice steps; troubleshooting matches real behaviors;
  links resolve; the stale markers are cleared.
- `grep -rn "coming soon" README.md docs/ | grep -vE 'cycles/|decisions/'` → no hit points at
  getting-started / faq / troubleshooting.

## Non-goals
Expanding `characters.md` / `architecture.md` (optional later polish). No code. No edits to install /
legal / voice page **content** (only the `_(coming soon)_` marker accuracy). No merge — open a PR (base
`main`) and stop.
