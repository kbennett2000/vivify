# Roadmap

The build was sequenced around two go/no-go spikes — ACS image/animation decode (Cycle 1) and the
authentic voice service (Cycle 5) — front-loaded so the risky answers came first. **Both passed**, and the
engine is now feature-complete: it loads real `.acs` characters, renders and animates them in the browser,
and speaks in the authentic L&H TruVoice voice with dense, audio-aligned lip-sync (confirmed end-to-end in
Cycle 18, which captured real Genie speech from the running stack). Everything from Cycle 13 on is
documentation and packaging polish.

Each row links its build-cycle doc (`docs/cycles/`) and any load-bearing decision (`docs/decisions/`).

## Shipped (all merged to `main`)

| #   | Cycle                          | The point                                                                       | Status                                                                                              |
| --- | ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 0   | Repo + contracts               | Nail the seams before building across them                                      | **Merged** (PR #1). Strict types compile; stub agent loads & no-ops; bundle schema + validator     |
| 1   | **ACS spike** (go/no-go)       | Decode one character's images + animation table from raw `.acs`                 | **Merged — GATE PASSED.** Genie/Merlin animation names match Microsoft's lists exactly (76/76, 73/73); pixel decode confirmed. See `cycle-1-acs-spike.md`, ADR-0009 |
| 2   | Full parser + `acs2bundle`     | Generalize to the whole format; emit web-ready bundles                          | **Merged.** Genie/Merlin/Peedy/Robby → valid bundles (zod-validated); lossless sprite-sheet round-trip (0 mismatches across 2,775 images). `cycle-2-converter.md` |
| 3   | Core renderer (silent)         | The browser engine: compositing, timing, branching, action queue, balloon       | **Merged** (PR #5). Compositing at offsets w/ transparency, frame timing, probabilistic + exit branches, state→animation map, full action queue, styled balloon. Silent (StubTtsProvider). `cycle-3-renderer.md` |
| 4   | MASH demo                      | Showcase + dogfood the public API early                                         | **Merged** (PR #6). Committed browser playground built only on `@vivify/core`'s public API (vanilla TS + Vite). Ships no `.acs`/MS assets. `cycle-4-mash.md`, ADR-0013 |
| 5   | **Voice spike** (go/no-go)     | Authentic voice + mouth timing out of the real engine                           | **Merged — GATE PASSED** (PR #7). `services/voice-server`: Node HTTP → C++ SAPI4 bridge under Wine; `POST /tts` → `{audio, mouthTimeline}`. `cycle-5-voice.md`, ADR-0014/0015 |
| 6   | Lip-sync + audio integration   | Wire the authentic provider; drive mouth from the timeline; Web Speech fallback | **Merged** (PR #8). `@vivify/voice-truvoice` (`TruVoiceProvider` + audible `WebSpeechProvider` fallback); engine plays the WAV and drives lip-sync + word-synced balloon. `cycle-6-lipsync.md`, ADR-0016 |
| 7   | **Authentic mouth density**    | Replace interim interpolation with dense per-phoneme mouth events               | **Merged** (PR #9). Real-time-audio bridge (`CLSID_MMAudioDest`) emits the dense viseme stream; PulseAudio null-sink dummy device under headless Wine. `cycle-7-realtime-audio.md`, ADR-0019 |
| 8   | Animation return-to-rest       | Stop animations freezing on a non-neutral frame / hard-cutting                  | **Merged** (PR #10). Finished gestures hold their end pose (actions stack); transition through rest only on a new animation or `stop()`. `cycle-8-return-to-rest.md`, ADR-0020 |
| 9   | Dockerized demo                | Collapse running MASH to one command — static container + auto-wired voice URL  | **Merged** (PR #11). `apps/mash` ships as an nginx static container on :8090; voice URL pre-filled; repo-root `docker-compose.yml`. `cycle-9-dockerize-demo.md`, ADR-0021 |
| 10  | Voice latency — measure + warm | Find where the Speak delay goes; warm the engine at startup                     | **Merged** (PR #12). Per-stage `[tts-timing]` instrumentation; persistent Xvfb + `wineserver` + startup warmup synth. `cycle-10-latency.md`, ADR-0022 |
| 11  | Voice latency — single-pass    | Kill the duplicate synthesis pass and close the structural gap                  | **Merged** (PR #13). Single real-time pass captured off the null-sink monitor; honest 500 on empty capture; fast `_Exit` closes the teardown gap. `cycle-11-latency-singlepass.md`, ADR-0023 |
| 12  | Disk-persistent TTS cache      | Make every repeated phrase instant                                              | **Merged** (PR #14). Response cache keyed by `hash(text+voice)`, served before the synthesis mutex, persisted on a Docker volume. `cycle-12-tts-cache.md`, ADR-0024 |
| 13  | Repo shine                     | Make the front door shine for a zero-assumptions visitor                        | **Merged** (PR #15). Banner + rewritten README + GitHub metadata. `cycle-13-repo-shine.md`, ADR-0025 |
| 14  | Docs skeleton + landing        | Build the `docs/` page map so front-door links resolve                          | **Merged** (PR #16). `docs/README.md` landing + canonical page map; real no-dependency pages, stubs signposted elsewhere. `cycle-14-docs-skeleton.md`, ADR-0026 |
| 15  | Voice in one `docker compose up` | Authentic voice with a single command (no host Node/pnpm)                      | **Merged** (PR #17). Voice image compiles its own `dist/` in-image from the repo root; `speech.h` stays user-supplied. `cycle-15-voice-one-command.md`, ADR-0027 |
| 16  | Per-platform install pages     | Hand-held Windows / macOS / Linux setup, zero assumptions                       | **Merged** (PR #18). Tier 1 (browser voice) + Tier 2 (authentic voice) per platform. `cycle-16-install-pages.md` |
| 17  | Developer documentation        | Get a competent developer productive fast                                       | **Merged** (PR #20). The five `docs/developers/*` pages: overview, quickstart, API, providers, bundles. `cycle-17-developer-page.md` |
| 18  | Screenshots + GIFs             | Real images of the running app — including Genie talking with the mouth moving  | **Merged** (PRs #21 tooling, #22 assets). Playwright capture tooling + committed screenshots/GIFs of the running app (authentic TruVoice lip-sync captured). `cycle-18-screenshots.md`, ADR-0028 |

## In progress / planned

| #   | Cycle                       | The point                                                              | Status                                                              |
| --- | --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 19  | Doc drift correctness pass  | Fix stale "(coming soon)" markers + bring this roadmap current        | **In progress** (this PR). `cycle-19-doc-drift.md`                  |
| —   | Help pages                  | Write the remaining stubs: getting-started, FAQ, troubleshooting      | Planned                                                            |
| —   | Voice docs                  | Write `voice/overview.md`, `voice/setup.md`, `voice/sourcing-components.md` | Planned (the install pages already cover the Tier-2 walkthrough — consolidate, don't duplicate) |
| —   | Thin-page polish (optional) | Flesh out the characters gallery; round out `architecture.md`         | Optional                                                          |

## Known long tail (not defeatism, just honesty)

"Any old `.acs` runs" is the goal, but expect quirky characters — gestures-at-point, heavy multi-image
frame compositing, unusual branching, non-English voice configs — to need iteration after the common case
works. We track these as fixtures with expected output as we find them.
