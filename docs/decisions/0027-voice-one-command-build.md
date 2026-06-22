# ADR-0027: authentic voice in one `docker compose up` — compile the server's dist/ inside the image, build from the repo root, keep speech.h user-supplied
Status: Accepted · Date: 2026-06-21

## Context
Running the authentic TruVoice voice secretly required a **host toolchain**. The voice image only `COPY`'d a host-prebuilt `dist/`, so a user had to install Node 20 + pnpm, run `pnpm install`, and run a typecheck to emit `dist/` **before** `docker compose up`. The goal of Cycle 15 was one `docker compose up` once the user drops in their supplied files — **no host Node/pnpm, no manual dist build; Docker as the only host tool**.

This is a code cycle (Dockerfile + compose). It is Tier-2 / authentic-voice context — the zero-bundled-IP rule ([ADR-0006](0006-permissive-license-no-bundled-ip.md)) is binding, and the full Debian + Wine + SAPI4 path cannot run in vivify's sandbox.

## Decision

**1. Compile the server's `dist/` INSIDE the image (multi-stage).**
A `node:20-slim` `build` stage runs corepack (pnpm@9.15.0, pinned in the root `package.json`) + `pnpm install --frozen-lockfile` + `pnpm --filter @vivify/voice-server run build` — a new `"build": "tsc --build"` script that builds the `@vivify/types` project reference first, then emits the server. The Wine/SAPI4 runtime stage then does `COPY --from=build /repo/services/voice-server/dist /opt/vivify/dist/` instead of `COPY dist/`. WHY: this removes the host Node/pnpm + manual-dist prerequisite entirely. `@vivify/types` imports are type-only (`import type`), so nothing from the workspace ships at runtime; and because the build stage is discarded, the final image keeps only the Node **runtime** — no pnpm, no TypeScript toolchain.

**2. The build context becomes the repo root.**
`docker-compose.yml`'s `voice` service uses `context: .` + `dockerfile: services/voice-server/Dockerfile` (mirroring `apps/mash`), and every runtime-stage `COPY` source is prefixed `services/voice-server/` (`vendor/`, `bridge/`, `pulse-null.pa`, `entrypoint.sh`). WHY: the in-image build needs the whole pnpm workspace — the lockfile and `packages/types` — which live **above** the service directory, so the context can no longer be the service dir.

**3. A Dockerfile-specific ignore lets the voice build read `vendor/`, while the root `.dockerignore` keeps `vendor/` out of the MASH image.**
`services/voice-server/Dockerfile.dockerignore` mirrors the root ignore **except** it deliberately allows `services/voice-server/vendor/`; BuildKit uses this per-Dockerfile ignore instead of the root one for the voice build. WHY: both images now build from the repo root. The root ignore must keep excluding `vendor/` so the proprietary engine never enters the **MASH** image (which does `COPY . .`), but the **voice** image legitimately needs `vendor/` at build time to install the SAPI4/TruVoice runtime. This was verified in-sandbox: building the `build` stage showed `vendor/` present in the voice build context (`spchapi.exe`, `tv_enua.exe`, `sdk/include/speech.h`).

**4. `speech.h` stays user-supplied — do NOT auto-fetch it.**
The SAPI4 SDK header carries _"Copyright 1994-1998 Microsoft Corporation. All rights reserved."_ with no redistribution grant. It stays gitignored + user-supplied at `services/voice-server/vendor/sdk/include/speech.h`, and the build **fails loudly** with the exact drop path (and a pointer to `docs/legal-and-assets.md`) if it's missing. WHY: legal safety over convenience. Auto-fetching it — even at build time from a third-party mirror — would make our build reproduce Microsoft IP with no license, violating [ADR-0006](0006-permissive-license-no-bundled-ip.md) / zero-bundled-IP. The PO confirmed this path. The alternative considered and **deferred**: a clean-room minimal SAPI4 header that would remove the IP entirely — substantial, ABI-sensitive, a possible future cycle.

## Consequences
- **New minimal user flow.** Drop **3** user-supplied files into `services/voice-server/vendor/` — `spchapi.exe`, `tv_enua.exe`, `sdk/include/speech.h` (sources in `docs/legal-and-assets.md`) — then `docker compose up`. **Docker is the only host tool.** (Was: install Node + pnpm → `pnpm install` → typecheck to build `dist/` → drop 3 files → `docker compose up`.)
- **Verification boundary (CI/sandbox vs operator).** Verified in-sandbox: the in-image `node` `build` stage was built and emitted `/repo/services/voice-server/dist/main.js` (proving the host needs no toolchain), and the Dockerfile-specific ignore was confirmed to let the build read `services/voice-server/vendor/`. The **operator** validates what the sandbox cannot: the full Debian + Wine + SAPI4 runtime image and end-to-end authentic voice — Wine isn't reproducible in vivify's sandbox, the same boundary as every voice cycle.
- **IP posture preserved.** No binaries, `.acs`, or `speech.h` are committed; `vendor/` stays gitignored; the MASH image still excludes `vendor/` via the unchanged root `.dockerignore`. [ADR-0006](0006-permissive-license-no-bundled-ip.md) is intact.
- **Runtime unchanged.** Ports (MASH 8090 / voice 8080), the TTS cache, and its named volume are untouched by this cycle.

## Related
- [ADR-0006](0006-permissive-license-no-bundled-ip.md) — MIT, zero bundled third-party IP; the binding rule behind decision 4 (and why `vendor/`/`speech.h` stay user-supplied).
- [ADR-0014](0014-voice-server-architecture.md) — the voice-server architecture this cycle repackages (it changes how `dist/` is built, not the Wine/SAPI4 service).
- `docs/cycles/cycle-15-voice-one-command.md` — the cycle this ADR records, with the full Dockerfile/compose detail and the verified-where breakdown.
