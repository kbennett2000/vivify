# ADR-0021: MASH ships as a static nginx SPA container, separate from the voice container
Status: Accepted · Date: 2026-06-21

## Context
Cycle 9 (`docs/cycles/cycle-9-dockerize-demo.md`, branch `cycle-9-dockerize-demo`) packages the MASH demo (`apps/mash`) so the showcase runs as one command instead of a two-terminal build/serve plus a manual voice-URL paste. The cycle's scope is `apps/mash` + repo-root Docker glue only; `@vivify/core`, `services/voice-server`, the SAPI4 bridge, and the Wine prefix are untouched.

Two facts about MASH shape every decision below. First, it is a **static single-page app**: the `@vivify/core` engine runs entirely in the browser, and the only server it talks to — the voice service — is fetched **client-side from the browser**, not container-to-container. Second, the authentic-voice stack (Wine + SAPI4 + L&H TruVoice) is closed Microsoft/L&H IP that the constitution forbids us to bundle (ADR-0006, `docs/legal-and-assets.md`), and it already lives in its own image (ADR-0014, ADR-0019).

## Decision

**1. MASH is a static SPA container served by nginx, with the voice stack in a separate image.**
The MASH image contains the production Vite build served by `nginx:alpine` — **no** Node runtime, **no** app server, and crucially **no** Wine/SAPI4/TruVoice. The authentic-voice service stays in `services/voice-server`, unchanged. The two images are not networked together: each publishes its port to the host, and the browser reaches `localhost:8090` (MASH) and `localhost:8080` (voice) directly. This keeps the MASH image tiny and guarantees that zero Microsoft/L&H IP can enter it — the separation is a hard line in service of the "permissive license, zero bundled IP" non-negotiable, not just a packaging convenience.

**2. Multi-stage, in-image build with the repo root as the build context.**
`apps/mash/Dockerfile` is two stages: stage 1 (`node:20-slim`) runs `pnpm install --frozen-lockfile` then builds the bundle; stage 2 (`nginx:alpine`) serves it. The build context **must** be the repo root — MASH imports `@vivify/core`, `@vivify/acs`, and `@vivify/types` from the pnpm workspace, so the build needs `packages/*` plus the lockfile: `docker build -f apps/mash/Dockerfile -t vivify-mash .`.

A subtlety: a fresh container has only the workspace symlinks, not the dependencies' built `dist/*.d.ts`. So the Dockerfile emits the dependencies' declarations first — `pnpm --filter "mash^..." run typecheck` (each package's `typecheck` script is `tsc --build`, which emits `dist`) — **before** `pnpm --filter mash build`, whose `tsc --noEmit` step resolves `@vivify/core` et al. from those `.d.ts` files. The package name is `mash`, not `@vivify/mash`.

This **diverges from voice-server's host-prebuild model** (ADR-0014, where `dist/` is built on the host before `docker build`). voice-server prebuilds on the host because of its Wine complexity; MASH is simple enough to build fully in-image, which is the better one-command UX. We diverge rather than unify because refactoring voice-server is out of scope and the two have genuinely different constraints.

**3. Internal port fixed at 8090; host port overridden via the standard `-p` flag.**
`nginx.conf` has `listen 8090;` and the Dockerfile `EXPOSE 8090`. We deliberately do **not** make the internal listen port runtime-configurable — host-port mapping (`docker run -p <hostport>:8090`) is the idiomatic Docker mechanism and fully satisfies "use a different port." Nothing hardcodes the host side, so the override cannot break.

**4. The voice-server URL defaults to `http://localhost:8080`, baked at build time but runtime-editable.**
A pure helper `resolveVoiceServerUrl(raw)` returns `raw?.trim() || 'http://localhost:8080'`. On startup the UI pre-fills the voice field from `resolveVoiceServerUrl(import.meta.env.VITE_VOICE_SERVER_URL)`. The default makes sound work out of the box with the voice container up, killing the manual-paste step. The default is overridable at build via `--build-arg VITE_VOICE_SERVER_URL=…`, the field stays editable at runtime for other hosts, and clearing it goes silent (StubTtsProvider).

## Consequences
- The MASH image is small and provably IP-free: no Node, no app server, no Wine/SAPI4 — only static assets behind nginx. The `.dockerignore` (`node_modules`, `**/dist`, `.git`, `services/voice-server/vendor`, Wine prefixes, `*.acs`) both shrinks the context and reinforces the no-IP guarantee.
- The demo collapses to `docker compose up` (or two `docker run` lines): MASH on 8090, voice on 8080, wired by the default URL with no manual paste.
- Because the voice field is no longer blank by default, a failed or unreachable voice fetch is now a **normal** case rather than a misconfiguration. `app.ts` catches `speak()` rejections and surfaces a friendly status that points at the clear-the-field escape hatch, so a running demo with no voice container degrades gracefully instead of looking broken.
- The build is in-image, so the only prerequisite is the repo and Docker — no host prebuild step (unlike voice-server). Trade-off accepted: the Dockerfile carries the two-step `typecheck`-then-`build` sequence to materialize the workspace dependencies' declarations, and the build model now differs between the two images.
- **CI verification stops at the unit gate.** `resolveVoiceServerUrl` is pure-unit-tested (default on undefined/empty/whitespace; honors and trims a real value); the Docker image is **not** built in CI, matching the voice-server model — a full image build is a deployment artifact, not part of the unit gate. The image build and on-screen voice path were validated by the implementer/operator on this branch.

## Related
- ADR-0006 / `docs/legal-and-assets.md` — permissive license, zero bundled IP: the reason the voice stack must stay out of the MASH image.
- ADR-0014 — voice-server's Node-over-Wine architecture and **host-prebuild** Docker model, which decision 2 deliberately diverges from.
- ADR-0019 — the real-time-audio voice container (Wine + PulseAudio null sink) that MASH talks to but never bundles.
- ADR-0013 — MASH is vanilla TS, the SPA that this cycle containerizes.
- `docs/cycles/cycle-9-dockerize-demo.md` — the cycle this ADR records.
